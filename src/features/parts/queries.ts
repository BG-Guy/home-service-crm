import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  approvals,
  inventoryLevels,
  invoices,
  jobs,
  lineItems,
  partPurchases,
  pricebookItems,
  stockLocations,
  stockMoves,
  tasks,
  users,
  vehicles,
} from "@/db/schema";
import { getJobForUser } from "@/features/jobs/api";
import { requireAnyPerm, requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { locationForUser } from "./server/inventory";

// Read DAL for /parts, /inventory and the parts slots. Techs see only their own
// purchases and their own truck; approvers/office see everything.

export const seesAllParts = (u: SessionUser) =>
  u.perms.has("parts.approve_reimbursement") || u.baseRole !== "tech";

export interface PurchaseListItem {
  id: string;
  paidBy: string;
  instrument: string | null;
  category: string;
  status: string;
  totalCents: number;
  vendor: string | null;
  purchasedOn: string | null;
  jobId: string | null;
  jobNumber: string | null;
  purchaser: string | null;
  purchaserId: string | null;
  hasReceipt: boolean;
  rejectReason: string | null;
  autoApproved: boolean;
  notes: string | null;
  createdAt: Date;
  approvalId: string | null;
}

async function purchaseRows(
  where: ReturnType<typeof and>,
  limit = 100,
): Promise<PurchaseListItem[]> {
  const rows = await db
    .select({
      p: partPurchases,
      jobNumber: jobs.number,
      purchaser: users.name,
    })
    .from(partPurchases)
    .leftJoin(jobs, eq(jobs.id, partPurchases.jobId))
    .leftJoin(users, eq(users.id, partPurchases.purchaserUserId))
    .where(where)
    .orderBy(desc(partPurchases.createdAt))
    .limit(limit);
  const pendingIds = rows
    .filter((r) => r.p.status === "pending")
    .map((r) => r.p.id);
  const appr = pendingIds.length
    ? await db
        .select({ id: approvals.id, entityId: approvals.entityId })
        .from(approvals)
        .where(
          and(
            eq(approvals.entityType, "part_purchase"),
            eq(approvals.status, "pending"),
            inArray(approvals.entityId, pendingIds),
          ),
        )
    : [];
  return rows.map((r) => ({
    id: r.p.id,
    paidBy: r.p.paidBy,
    instrument: r.p.instrument,
    category: r.p.category,
    status: r.p.status,
    totalCents: r.p.totalCents,
    vendor: r.p.vendor,
    purchasedOn: r.p.purchasedOn,
    jobId: r.p.jobId,
    jobNumber: r.jobNumber,
    purchaser: r.purchaser,
    purchaserId: r.p.purchaserUserId,
    hasReceipt: !!r.p.receiptMediaId,
    rejectReason: r.p.rejectReason,
    autoApproved: r.p.autoApproved,
    notes: r.p.notes,
    createdAt: r.p.createdAt,
    approvalId: appr.find((a) => a.entityId === r.p.id)?.id ?? null,
  }));
}

export const listPurchases = cache(
  async (tab: "mine" | "approvals" | "nonjob") => {
    const user = await requireAnyPerm([
      "parts.add_to_job",
      "parts.submit_receipt",
      "parts.approve_reimbursement",
    ]);
    const all = seesAllParts(user);
    if (tab === "approvals") {
      if (!user.perms.has("parts.approve_reimbursement")) return [];
      return purchaseRows(
        and(
          eq(partPurchases.paidBy, "tech"),
          eq(partPurchases.status, "pending"),
        ),
      );
    }
    if (tab === "nonjob")
      return purchaseRows(
        and(
          isNull(partPurchases.jobId),
          all ? undefined : eq(partPurchases.purchaserUserId, user.id),
        ),
      );
    return purchaseRows(and(eq(partPurchases.purchaserUserId, user.id)));
  },
);

/** Anomaly flags (SPEC M15): unbilled receipts, tech parts with no receipt, stale receipts, parts cost > price. */
export const listPartFlags = cache(async () => {
  await requireAnyPerm(["parts.approve_reimbursement", "parts.view_cost"]);
  const s = await getSettings();
  const billedIds = db
    .select({ id: lineItems.partPurchaseId })
    .from(lineItems)
    .innerJoin(
      invoices,
      and(
        eq(lineItems.parentType, "invoice"),
        eq(invoices.id, lineItems.parentId),
      ),
    )
    .where(
      and(
        isNotNull(lineItems.partPurchaseId),
        sql`${invoices.status} <> 'void'`,
      ),
    );
  const unbilled = await purchaseRows(
    and(
      isNotNull(partPurchases.jobId),
      eq(partPurchases.category, "part"),
      sql`${partPurchases.status} <> 'rejected'`,
      sql`${partPurchases.id} not in ${billedIds}`,
    ),
    50,
  );
  const cardNoJob = await purchaseRows(
    and(
      isNull(partPurchases.jobId),
      eq(partPurchases.instrument, "company_card"),
      eq(partPurchases.category, "part"),
    ),
    20,
  );
  const noReceipt = await db
    .select({
      lineItemId: lineItems.id,
      name: lineItems.name,
      totalCents: lineItems.totalCents,
      jobId: jobs.id,
      jobNumber: jobs.number,
      partPurchaseId: lineItems.partPurchaseId,
    })
    .from(lineItems)
    .innerJoin(
      invoices,
      and(
        eq(lineItems.parentType, "invoice"),
        eq(invoices.id, lineItems.parentId),
      ),
    )
    .innerJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(partPurchases, eq(partPurchases.id, lineItems.partPurchaseId))
    .where(
      and(
        eq(lineItems.partSource, "tech_purchased"),
        sql`${invoices.status} <> 'void'`,
        or(
          isNull(lineItems.partPurchaseId),
          isNull(partPurchases.receiptMediaId),
          eq(partPurchases.status, "rejected"),
        ),
      ),
    )
    .orderBy(desc(lineItems.createdAt))
    .limit(50);
  const stale = await purchaseRows(
    and(
      eq(partPurchases.paidBy, "tech"),
      eq(partPurchases.status, "pending"),
      lt(
        partPurchases.createdAt,
        new Date(Date.now() - s.parts.stale_receipt_days * 86_400_000),
      ),
    ),
    50,
  );
  const lossRows = await db.execute(sql`
    select j.id as job_id, j.number, sum(li.qty * coalesce(li.unit_cost_cents, 0))::bigint as cost,
      sum(li.total_cents)::bigint as price
    from line_items li
    join invoices i on li.parent_type = 'invoice' and i.id = li.parent_id and i.status <> 'void'
    join jobs j on j.id = i.job_id
    where li.type in ('part','material')
    group by j.id, j.number
    having sum(li.qty * coalesce(li.unit_cost_cents, 0)) > sum(li.total_cents)
    order by j.number desc limit 30`);
  const losses = (
    lossRows as unknown as {
      rows: { job_id: string; number: string; cost: string; price: string }[];
    }
  ).rows.map((r) => ({
    jobId: r.job_id,
    jobNumber: r.number,
    costCents: Math.round(Number(r.cost)),
    priceCents: Number(r.price),
  }));
  return {
    unbilled: [...unbilled, ...cardNoJob],
    noReceipt,
    stale,
    losses,
    staleDays: s.parts.stale_receipt_days,
  };
});

// ------------------------------------------------------------------ job panel (S38)

export async function jobParts(jobId: string, user: SessionUser) {
  const job = await getJobForUser(jobId, user);
  if (!job) return null;
  const invs = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      number: invoices.number,
    })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), sql`${invoices.status} <> 'void'`))
    .orderBy(desc(invoices.createdAt));
  const lines = invs.length
    ? await db
        .select()
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "invoice"),
            inArray(
              lineItems.parentId,
              invs.map((i) => i.id),
            ),
            inArray(lineItems.type, ["part", "material"]),
          ),
        )
        .orderBy(asc(lineItems.createdAt))
    : [];
  const purchases = await db
    .select({ p: partPurchases, purchaser: users.name })
    .from(partPurchases)
    .leftJoin(users, eq(users.id, partPurchases.purchaserUserId))
    .where(eq(partPurchases.jobId, jobId))
    .orderBy(asc(partPurchases.createdAt));
  const billed = new Set(lines.map((l) => l.partPurchaseId).filter(Boolean));
  return {
    job,
    draft: invs[0]?.status === "draft" || invs.length === 0,
    invoiceNumber: invs[0]?.number ?? null,
    lines: lines.map((l) => {
      const p = purchases.find((x) => x.p.id === l.partPurchaseId);
      return {
        id: l.id,
        name: l.name,
        qty: Number(l.qty),
        unitPriceCents: l.unitPriceCents,
        unitCostCents: l.unitCostCents,
        totalCents: l.totalCents,
        partSource: l.partSource,
        warrantyMonths: l.manufacturerWarrantyMonths,
        purchase: p
          ? {
              id: p.p.id,
              status: p.p.status,
              hasReceipt: !!p.p.receiptMediaId,
              purchaserId: p.p.purchaserUserId,
              purchaser: p.purchaser,
              totalCents: p.p.totalCents,
              rejectReason: p.p.rejectReason,
            }
          : null,
      };
    }),
    unbilled: purchases
      .filter(
        (p) =>
          !billed.has(p.p.id) &&
          p.p.category === "part" &&
          p.p.status !== "rejected",
      )
      .map((p) => ({
        id: p.p.id,
        vendor: p.p.vendor,
        totalCents: p.p.totalCents,
        purchaser: p.purchaser,
        notes: p.p.notes,
      })),
  };
}

/** S45: tech-paid lines without a receipt today, with the purchase to attach to. */
export async function unreceiptedForUser(
  userId: string,
  date: string,
  tz: string,
) {
  return db
    .select({
      lineItemId: lineItems.id,
      name: lineItems.name,
      totalCents: lineItems.totalCents,
      jobId: jobs.id,
      jobNumber: jobs.number,
      partPurchaseId: lineItems.partPurchaseId,
    })
    .from(lineItems)
    .innerJoin(
      invoices,
      and(
        eq(lineItems.parentType, "invoice"),
        eq(invoices.id, lineItems.parentId),
      ),
    )
    .innerJoin(jobs, eq(jobs.id, invoices.jobId))
    .innerJoin(partPurchases, eq(partPurchases.id, lineItems.partPurchaseId))
    .where(
      and(
        eq(lineItems.partSource, "tech_purchased"),
        sql`${invoices.status} <> 'void'`,
        isNull(partPurchases.receiptMediaId),
        eq(partPurchases.purchaserUserId, userId),
        sql`(${lineItems.createdAt} at time zone ${tz})::date = ${date}::date`,
      ),
    )
    .limit(30);
}

// ------------------------------------------------------------------ inventory

export const getInventory = cache(async (locationId?: string | null) => {
  const user = await requireUser("inventory.view");
  const manage = user.perms.has("inventory.manage");
  const mine = await locationForUser(db, user.id);
  const locs = await db
    .select({
      l: stockLocations,
      vehicle: vehicles.nickname,
      assigned: users.name,
    })
    .from(stockLocations)
    .leftJoin(vehicles, eq(vehicles.id, stockLocations.vehicleId))
    .leftJoin(users, eq(users.id, vehicles.assignedUserId))
    .where(eq(stockLocations.active, true))
    .orderBy(asc(stockLocations.kind), asc(stockLocations.name));
  const visible = manage ? locs : locs.filter((l) => l.l.id === mine?.id);
  const current =
    visible.find((l) => l.l.id === locationId) ??
    visible.find((l) => l.l.id === mine?.id) ??
    visible[0] ??
    null;
  const levels = current
    ? await db
        .select({
          itemId: pricebookItems.id,
          name: pricebookItems.name,
          sku: pricebookItems.sku,
          category: pricebookItems.category,
          onHand: inventoryLevels.onHand,
          min: inventoryLevels.minQty,
          max: inventoryLevels.maxQty,
          avg: pricebookItems.avgCostCents,
          cost: pricebookItems.unitCostCents,
          price: pricebookItems.unitPriceCents,
        })
        .from(inventoryLevels)
        .innerJoin(
          pricebookItems,
          eq(pricebookItems.id, inventoryLevels.pricebookItemId),
        )
        .where(eq(inventoryLevels.locationId, current.l.id))
        .orderBy(asc(pricebookItems.name))
    : [];
  const moves = current
    ? await db
        .select({
          m: stockMoves,
          item: pricebookItems.name,
          actor: users.name,
          jobNumber: jobs.number,
        })
        .from(stockMoves)
        .innerJoin(
          pricebookItems,
          eq(pricebookItems.id, stockMoves.pricebookItemId),
        )
        .leftJoin(users, eq(users.id, stockMoves.actorUserId))
        .leftJoin(jobs, eq(jobs.id, stockMoves.jobId))
        .where(
          or(
            eq(stockMoves.fromLocationId, current.l.id),
            eq(stockMoves.toLocationId, current.l.id),
          ),
        )
        .orderBy(desc(stockMoves.createdAt))
        .limit(40)
    : [];
  const restock = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      body: tasks.body,
      entityId: tasks.entityId,
      createdAt: tasks.createdAt,
      dueAt: tasks.dueAt,
    })
    .from(tasks)
    .where(and(eq(tasks.kind, "restock"), eq(tasks.status, "open")))
    .orderBy(desc(tasks.createdAt));
  const counts = await db
    .select({
      m: stockMoves,
      item: pricebookItems.name,
      loc: stockLocations.name,
    })
    .from(stockMoves)
    .innerJoin(
      pricebookItems,
      eq(pricebookItems.id, stockMoves.pricebookItemId),
    )
    .leftJoin(
      stockLocations,
      eq(
        stockLocations.id,
        sql`coalesce(${stockMoves.toLocationId}, ${stockMoves.fromLocationId})`,
      ),
    )
    .where(
      and(
        eq(stockMoves.kind, "count"),
        sql`${stockMoves.createdAt} > now() - interval '35 days'`,
      ),
    )
    .orderBy(desc(stockMoves.createdAt))
    .limit(60);
  const items = manage
    ? await db
        .select({
          id: pricebookItems.id,
          name: pricebookItems.name,
          sku: pricebookItems.sku,
          cost: pricebookItems.unitCostCents,
        })
        .from(pricebookItems)
        .where(
          and(
            inArray(pricebookItems.kind, ["part", "material"]),
            sql`${pricebookItems.deletedAt} is null`,
          ),
        )
        .orderBy(asc(pricebookItems.name))
    : [];
  return {
    user,
    manage,
    mine,
    locations: visible.map((l) => ({
      id: l.l.id,
      name: l.l.name,
      kind: l.l.kind,
      assigned: l.assigned,
    })),
    current: current
      ? {
          id: current.l.id,
          name: current.l.name,
          kind: current.l.kind,
          assigned: current.assigned,
        }
      : null,
    levels: levels.map((l) => ({
      ...l,
      onHand: Number(l.onHand),
      min: l.min == null ? null : Number(l.min),
      max: l.max == null ? null : Number(l.max),
      costCents: l.avg ?? l.cost ?? null,
    })),
    moves,
    restock: manage ? restock : restock.filter((t) => t.entityId === mine?.id),
    variances: counts.map((c) => ({
      id: c.m.id,
      item: c.item,
      location: c.loc,
      delta: Number(c.m.qty),
      valueCents: Math.round(Number(c.m.qty) * (c.m.unitCostCents ?? 0)),
      at: c.m.createdAt,
    })),
    items,
  };
});

/** Job and vehicle choices for the New receipt sheet (own recent jobs; all for office). */
export async function receiptPickers(user: SessionUser) {
  const all = seesAllParts(user);
  const since = new Date(Date.now() - 21 * 86_400_000);
  const rows = await db.execute(sql`
    select j.id, j.number, j.title from jobs j
    where (j.completed_at is null or j.completed_at > ${since.toISOString()}::timestamptz)
      and j.status not in ('cancelled')
      ${all ? sql`` : sql`and exists (select 1 from job_assignments a where a.job_id = j.id and a.user_id = ${user.id}::uuid)`}
    order by coalesce(j.scheduled_start, j.created_at) desc limit 40`);
  const vs = await db
    .select({
      id: vehicles.id,
      nickname: vehicles.nickname,
      assigned: vehicles.assignedUserId,
    })
    .from(vehicles)
    .where(sql`${vehicles.status} <> 'retired'`)
    .orderBy(asc(vehicles.nickname));
  const mine = vs.filter((v) => v.assigned === user.id);
  return {
    jobs: (
      rows as unknown as {
        rows: { id: string; number: string; title: string }[];
      }
    ).rows.map((r) => ({
      id: r.id,
      label: `${r.number} · ${r.title}`,
    })),
    vehicles: (all ? vs : mine.length ? mine : vs).map((v) => ({
      id: v.id,
      label: v.nickname,
    })),
  };
}
