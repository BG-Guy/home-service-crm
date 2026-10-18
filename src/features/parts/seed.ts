// Demo seed fragment for `parts` (BUILD_PLAN §10.3 #20). Owner: B6.
// Write only your own tables; never emit events; use seedId() + onConflictDoNothing().
// Guards on missing rows (jobs/vehicles/price book from earlier fragments).
import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import {
  approvals,
  inventoryLevels,
  jobs,
  partPurchases,
  pricebookItems,
  stockLocations,
  stockMoves,
  tasks,
  vehicles,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import { demoJob, demoUser, type TechKey } from "@/db/seed/demo-plan";
import { seedPlaceholderMedia } from "@/db/seed/helpers";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createApproval } from "@/features/approvals/api";
import { insertPostings } from "@/features/payroll/server/ledger";
import { createTask } from "@/features/tasks/api";
import { dateKey } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";

async function existing<T extends { id: string }>(
  rows: Promise<T[]>,
): Promise<Set<string>> {
  return new Set((await rows).map((r) => r.id));
}

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const uid = (k: TechKey | "admin" | "office") => demoUser(k).id;
  const admin = uid("admin");
  const plan = ctx.plan;
  // Vendors, stock list and purchase notes come from the trade profile.
  const copy = ctx.profile.parts;
  const VENDORS = copy.vendors;
  const STOCK_ITEMS = copy.stockItems;
  const nickname = (k: "v1" | "v2" | "v3") =>
    plan.vehicles.find((v) => v.key === k)?.nickname ??
    (k === "v1" ? "Van 1" : k === "v2" ? "Van 2" : "Truck");
  const itemName = (k: string) =>
    plan.pricebook.find((p) => p.key === k)?.name ?? k;

  const jobIds = await existing(
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        inArray(
          jobs.id,
          plan.jobs.map((j) => j.id),
        ),
      ),
  );
  const vehicleIds = await existing(
    db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        inArray(vehicles.id, [
          seedId("vehicle", "v1"),
          seedId("vehicle", "v2"),
          seedId("vehicle", "v3"),
        ]),
      ),
  );

  // ---------------------------------------------------------------- receipts
  const receipt = async (
    key: string,
    label: string,
    at: Date,
    entityId: string,
    jobId: string | null,
  ) =>
    seedPlaceholderMedia(db, {
      id: seedId("media", `receipt-${key}`),
      kind: "receipt",
      tag: "receipt",
      entity: { type: "part_purchase", id: entityId },
      jobId,
      uploaderId: null,
      label,
      color: "#F2F2F7",
      capturedAt: at,
    });

  type Row = typeof partPurchases.$inferInsert;
  const rows: Row[] = [];
  const mediaJobs: {
    key: string;
    label: string;
    at: Date;
    id: string;
    jobId: string | null;
  }[] = [];

  // 10 tech-paid, approved purchases backing the tech_purchased invoice lines (J2, J8 … J56).
  let v = 0;
  for (const j of plan.jobs) {
    const techLines = j.lines.filter((l) => l.partSource === "tech_purchased");
    if (techLines.length === 0 || j.n > 60 || !j.tech || !jobIds.has(j.id))
      continue;
    const id = seedId("part_purchase", `j${j.n}`);
    const at = ctx.at(j.dayOffset ?? -1, "08:10");
    const total = techLines.reduce(
      (a, l) => a + Math.round((l.unitCostCents ?? 0) * l.qty),
      0,
    );
    if (total <= 0) continue;
    const vendor = VENDORS[v++ % VENDORS.length] as string;
    rows.push({
      id,
      paidBy: "tech",
      instrument: "personal",
      purchaserUserId: uid(j.tech),
      category: "part",
      jobId: j.id,
      vendor,
      purchasedOn: dateKey(at, ctx.tz),
      totalCents: total,
      receiptMediaId: seedId("media", `receipt-j${j.n}`),
      aiStatus: "skipped",
      status: "approved",
      decidedBy: admin,
      decidedAt: new Date(at.getTime() + 6 * 3_600_000),
      autoApproved: total < 5000,
      notes: techLines.map((l) => `${l.qty} × ${l.name}`).join(", "),
      createdAt: at,
      updatedAt: at,
    });
    mediaJobs.push({
      key: `j${j.n}`,
      label: `${vendor} ${(total / 100).toFixed(2)}`,
      at,
      id,
      jobId: j.id,
    });
  }

  // 3 company-card purchases (receipt required, no ledger line). One was never billed
  // (shows on the "unbilled part" anomaly flag).
  const card = [
    { key: "card-1", job: 70, tech: "tech1" as const, ...copy.card[0] },
    { key: "card-2", job: 73, tech: "tech2" as const, ...copy.card[1] },
    { key: "card-3", job: 41, tech: "tech3" as const, ...copy.card[2] },
  ];
  for (const c of card) {
    const j = demoJob(c.job);
    const jobId = jobIds.has(j.id) ? j.id : null;
    const at = ctx.at(Math.min(j.dayOffset ?? 0, 0), "09:40");
    const id = seedId("part_purchase", c.key);
    rows.push({
      id,
      paidBy: "company",
      instrument: "company_card",
      purchaserUserId: uid(c.tech),
      category: "part",
      jobId,
      vendor: c.vendor,
      purchasedOn: dateKey(at, ctx.tz),
      totalCents: c.total,
      receiptMediaId: seedId("media", `receipt-${c.key}`),
      aiStatus: "skipped",
      status: "approved",
      autoApproved: true,
      decidedAt: at,
      notes: c.note,
      createdAt: at,
      updatedAt: at,
    });
    mediaJobs.push({ key: c.key, label: `${c.vendor} card`, at, id, jobId });
  }

  // 4 tech3 fuel receipts (tech-owned truck) → reimbursement_expense.
  const fuel = [-26, -19, -12, -5];
  const tacoma = vehicleIds.has(seedId("vehicle", "v3"))
    ? seedId("vehicle", "v3")
    : null;
  for (const [i, d] of fuel.entries()) {
    const at = ctx.at(d, "07:25");
    const id = seedId("part_purchase", `fuel-tech3-${i + 1}`);
    const total = 5480 + i * 317;
    rows.push({
      id,
      paidBy: "tech",
      instrument: "personal",
      purchaserUserId: uid("tech3"),
      category: "fuel",
      vehicleId: tacoma,
      vendor: copy.fuelVendors[i % 2] as string,
      purchasedOn: dateKey(at, ctx.tz),
      totalCents: total,
      receiptMediaId: seedId("media", `receipt-fuel-tech3-${i + 1}`),
      aiStatus: "skipped",
      status: "approved",
      decidedBy: admin,
      decidedAt: new Date(at.getTime() + 3_600_000),
      autoApproved: false,
      notes: `${(14.2 + i).toFixed(1)} gal · ${nickname("v3")}`,
      createdAt: at,
      updatedAt: at,
    });
    mediaJobs.push({
      key: `fuel-tech3-${i + 1}`,
      label: `Fuel ${(total / 100).toFixed(2)}`,
      at,
      id,
      jobId: null,
    });
  }

  // 2 pending (approvals queue) and 1 rejected.
  const today70 = demoJob(70);
  const pend = [
    {
      key: "pending-1",
      tech: "tech1" as const,
      jobId: jobIds.has(today70.id) ? today70.id : null,
      total: copy.pending[0].total,
      vendor: copy.pending[0].vendor,
      cat: "part",
      note: copy.pending[0].note,
      flags: ["over_limit"],
      clean: true,
      receipt: true,
      d: 0,
    },
    {
      key: "pending-2",
      tech: "tech2" as const,
      jobId: null,
      total: copy.pending[1].total,
      vendor: copy.pending[1].vendor,
      cat: "supplies",
      note: copy.pending[1].note,
      flags: ["no_receipt"],
      clean: false,
      receipt: false,
      d: -1,
    },
  ];
  for (const p of pend) {
    const at = ctx.at(p.d, "11:05");
    const id = seedId("part_purchase", p.key);
    rows.push({
      id,
      paidBy: "tech",
      instrument: "personal",
      purchaserUserId: uid(p.tech),
      category: p.cat,
      jobId: p.jobId,
      vendor: p.vendor,
      purchasedOn: dateKey(at, ctx.tz),
      totalCents: p.total,
      receiptMediaId: p.receipt ? seedId("media", `receipt-${p.key}`) : null,
      aiStatus: p.receipt ? "skipped" : null,
      status: "pending",
      notes: p.note,
      createdAt: at,
      updatedAt: at,
    });
    if (p.receipt)
      mediaJobs.push({
        key: p.key,
        label: `${p.vendor} ${(p.total / 100).toFixed(2)}`,
        at,
        id,
        jobId: p.jobId,
      });
  }
  {
    const at = ctx.at(-9, "15:30");
    const id = seedId("part_purchase", "rejected-1");
    rows.push({
      id,
      paidBy: "tech",
      instrument: "personal",
      purchaserUserId: uid("tech2"),
      category: "tool",
      vendor: copy.rejected.vendor,
      purchasedOn: dateKey(at, ctx.tz),
      totalCents: copy.rejected.total,
      receiptMediaId: seedId("media", "receipt-rejected-1"),
      aiStatus: "skipped",
      status: "rejected",
      decidedBy: admin,
      decidedAt: new Date(at.getTime() + 20 * 3_600_000),
      rejectReason:
        "Personal tool purchase: not reimbursable under the tool policy.",
      notes: copy.rejected.note,
      createdAt: at,
      updatedAt: at,
    });
    mediaJobs.push({
      key: "rejected-1",
      label: `${copy.rejected.vendor} ${(copy.rejected.total / 100).toFixed(2)}`,
      at,
      id,
      jobId: null,
    });
  }

  const already = await existing(
    db
      .select({ id: partPurchases.id })
      .from(partPurchases)
      .where(
        inArray(
          partPurchases.id,
          rows.map((r) => r.id as string),
        ),
      ),
  );
  for (const m of mediaJobs) {
    if (already.has(m.id)) continue;
    await receipt(m.key, m.label, m.at, m.id, m.jobId).catch(() => null);
  }
  if (rows.length)
    await db.insert(partPurchases).values(rows).onConflictDoNothing();

  // Ledger: fuel reimbursements (non-job → reimbursement_expense, wage_class reimbursement).
  for (const r of rows.filter(
    (x) => x.category === "fuel" && !already.has(x.id as string),
  )) {
    const [ledgerId] = await insertPostings(
      db,
      [
        {
          userId: r.purchaserUserId as string,
          type: "reimbursement_expense",
          amountCents: r.totalCents,
          wageClass: "reimbursement",
          memo: `Fuel reimbursement · ${r.vendor}`,
        },
      ],
      {
        effectiveDate: r.purchasedOn as string,
        refTable: "part_purchases",
        refId: r.id as string,
        actorUserId: admin,
        today: dateKey(ctx.now, ctx.tz),
      },
    );
    if (ledgerId)
      await db
        .update(partPurchases)
        .set({ ledgerEntryId: ledgerId })
        .where(eq(partPurchases.id, r.id as string));
  }

  // Approvals for the pending receipts.
  for (const p of pend) {
    const id = seedId("part_purchase", p.key);
    const [a] = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(eq(approvals.entityId, id))
      .limit(1);
    if (a) continue;
    await createApproval(
      db,
      {
        entityType: "part_purchase",
        entityId: id,
        policy: "always_review",
        requestedBy: uid(p.tech),
        evidence: {
          typed: {
            vendor: p.vendor,
            total_cents: p.total,
            purchased_on: dateKey(ctx.at(p.d, "11:05"), ctx.tz),
          },
          ai: null,
          ai_status: p.receipt ? "skipped" : null,
          awaiting_ai: false,
          flags: p.flags,
          clean: p.clean,
          receipt_media_id: p.receipt
            ? seedId("media", `receipt-${p.key}`)
            : null,
          job_id: p.jobId,
          category: p.cat,
        },
      },
      SYSTEM_ACTOR,
    );
  }

  // ---------------------------------------------------------------- inventory
  const items = await db
    .select({ id: pricebookItems.id, cost: pricebookItems.unitCostCents })
    .from(pricebookItems)
    .where(
      inArray(
        pricebookItems.id,
        STOCK_ITEMS.map((k) => seedId("pricebook", k)),
      ),
    );
  const costOf = new Map(items.map((i) => [i.id, i.cost ?? 0]));
  const wh = seedId("stock_location", "warehouse");
  const locs = [
    {
      id: wh,
      kind: "warehouse",
      name: "Warehouse",
      vehicleId: null as string | null,
    },
    ...(["v1", "v2"] as const)
      .filter((k) => vehicleIds.has(seedId("vehicle", k)))
      .map((k) => ({
        id: seedId("stock_location", k),
        kind: "vehicle",
        name: nickname(k),
        vehicleId: seedId("vehicle", k),
      })),
  ];
  await db.insert(stockLocations).values(locs).onConflictDoNothing();
  const [hasLevels] = await db
    .select({ id: inventoryLevels.locationId })
    .from(inventoryLevels)
    .where(eq(inventoryLevels.locationId, wh))
    .limit(1);
  if (!hasLevels && items.length) {
    const levels: (typeof inventoryLevels.$inferInsert)[] = [];
    const moves: (typeof stockMoves.$inferInsert)[] = [];
    const received = ctx.at(-45, "10:00");
    const transferred = ctx.at(-44, "07:30");
    STOCK_ITEMS.forEach((k, i) => {
      const itemId = seedId("pricebook", k);
      if (!costOf.has(itemId)) return;
      const big = copy.bigItems.includes(k);
      const whQty = big ? 4 : 20 + (i % 4) * 5;
      const truck = big ? 1 : 6 + (i % 3) * 2;
      // Three items below par on Van 1 (restock request).
      const low = (copy.lowItems as readonly string[]).includes(k);
      levels.push({
        locationId: wh,
        pricebookItemId: itemId,
        onHand: whQty,
        minQty: big ? 2 : 10,
        maxQty: big ? 6 : 40,
      });
      moves.push({
        pricebookItemId: itemId,
        toLocationId: wh,
        qty: whQty + 2 * truck,
        unitCostCents: costOf.get(itemId) ?? 0,
        kind: "receive",
        note: "Opening stock",
        actorUserId: uid("office"),
        createdAt: received,
      });
      for (const loc of locs.filter((l) => l.kind === "vehicle")) {
        const onHand =
          low && loc.id === seedId("stock_location", "v1") ? 1 : truck;
        levels.push({
          locationId: loc.id,
          pricebookItemId: itemId,
          onHand,
          minQty: big ? 1 : 4,
          maxQty: big ? 2 : 10,
        });
        moves.push({
          pricebookItemId: itemId,
          fromLocationId: wh,
          toLocationId: loc.id,
          qty: truck,
          unitCostCents: costOf.get(itemId) ?? 0,
          kind: "transfer",
          note: "Truck stock",
          actorUserId: uid("office"),
          createdAt: transferred,
        });
        if (onHand < truck)
          moves.push({
            pricebookItemId: itemId,
            fromLocationId: loc.id,
            qty: truck - onHand,
            unitCostCents: costOf.get(itemId) ?? 0,
            kind: "use_on_job",
            note: "Used on jobs",
            actorUserId: uid("tech1"),
            createdAt: ctx.at(-3, "14:00"),
          });
      }
    });
    if (levels.length)
      await db.insert(inventoryLevels).values(levels).onConflictDoNothing();
    if (moves.length) await db.insert(stockMoves).values(moves);
    for (const [id, cost] of costOf)
      await db
        .update(pricebookItems)
        .set({ avgCostCents: cost })
        .where(eq(pricebookItems.id, id));
  }

  // Open restock request for Van 1 (task kind restock, closed by a transfer).
  const v1Loc = seedId("stock_location", "v1");
  if (locs.some((l) => l.id === v1Loc)) {
    const [open] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.entityId, v1Loc))
      .limit(1);
    if (!open)
      await createTask(
        db,
        {
          kind: "restock",
          title: `Restock ${nickname("v1")} (${copy.lowItems.length} items)`,
          body: copy.lowItems.map((k) => `9 × ${itemName(k)}`).join("\n"),
          payload: {
            location_id: v1Loc,
            items: copy.lowItems.map((k) => ({
              pricebook_item_id: seedId("pricebook", k),
              qty: 9,
            })),
          },
          assigneeUserId: null,
          entity: { type: "stock_location", id: v1Loc },
          dueAt: ctx.at(1, "09:00"),
        },
        { kind: "user", userId: uid("tech1") },
        { quiet: true },
      );
  }
  ctx.log(`parts: ${rows.length} purchases, ${locs.length} stock locations`);
}
