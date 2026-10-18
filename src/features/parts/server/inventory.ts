import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  inventoryLevels,
  pricebookItems,
  stockLocations,
  stockMoves,
  tasks,
  vehicles,
} from "@/db/schema";
import { settingsOf } from "@/features/payroll/server/util";
import { closeTasksFor, createTask } from "@/features/tasks/api";
import { writeAudit } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/types";
import { nextAvgCost } from "../rules";

// Inventory (SPEC M15, flag `inventory`): warehouse + one location per vehicle,
// on-hand with par (min/max), stock moves and weighted average cost. B6 maintains
// pricebook_items.avg_cost_cents (BUILD_PLAN §11.2 exception).

export type MoveKind =
  | "receive"
  | "transfer"
  | "use_on_job"
  | "adjust"
  | "return"
  | "count";

export const MOVE_LABEL: Record<MoveKind, string> = {
  receive: "Received",
  transfer: "Transfer",
  use_on_job: "Used on job",
  adjust: "Adjustment",
  return: "Returned",
  count: "Count",
};

/** Warehouse plus one location per active vehicle (idempotent). */
export async function ensureLocations(tx: Tx): Promise<void> {
  const locs = await tx.select().from(stockLocations);
  if (!locs.some((l) => l.kind === "warehouse"))
    await tx
      .insert(stockLocations)
      .values({ kind: "warehouse", name: "Warehouse" });
  const vs = await tx
    .select({
      id: vehicles.id,
      nickname: vehicles.nickname,
      status: vehicles.status,
    })
    .from(vehicles);
  for (const v of vs) {
    if (v.status === "retired") continue;
    if (locs.some((l) => l.vehicleId === v.id)) continue;
    await tx
      .insert(stockLocations)
      .values({ kind: "vehicle", name: v.nickname, vehicleId: v.id });
  }
}

/** The stock location of the vehicle assigned to `userId` (null when none). */
export async function locationForUser(
  tx: Tx,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const [r] = await tx
    .select({ id: stockLocations.id, name: stockLocations.name })
    .from(stockLocations)
    .innerJoin(vehicles, eq(vehicles.id, stockLocations.vehicleId))
    .where(
      and(eq(vehicles.assignedUserId, userId), eq(stockLocations.active, true)),
    )
    .limit(1);
  return r ?? null;
}

async function level(tx: Tx, locationId: string, itemId: string) {
  const [l] = await tx
    .select()
    .from(inventoryLevels)
    .where(
      and(
        eq(inventoryLevels.locationId, locationId),
        eq(inventoryLevels.pricebookItemId, itemId),
      ),
    )
    .for("update")
    .limit(1);
  return l ?? null;
}

async function bump(tx: Tx, locationId: string, itemId: string, delta: number) {
  const cur = await level(tx, locationId, itemId);
  if (cur) {
    await tx
      .update(inventoryLevels)
      .set({
        onHand: sql`${inventoryLevels.onHand} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLevels.locationId, locationId),
          eq(inventoryLevels.pricebookItemId, itemId),
        ),
      );
    return Number(cur.onHand) + delta;
  }
  await tx
    .insert(inventoryLevels)
    .values({ locationId, pricebookItemId: itemId, onHand: delta });
  return delta;
}

export interface MoveInput {
  kind: MoveKind;
  pricebookItemId: string;
  qty: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  unitCostCents?: number | null;
  jobId?: string | null;
  lineItemId?: string | null;
  note?: string | null;
}

/** Record a stock move and update levels (and the average cost on receive). */
export async function recordMove(
  tx: Tx,
  m: MoveInput,
  actor: Actor,
  opts: { allowNegative?: boolean } = {},
): Promise<{ moveId: string }> {
  if (!Number.isFinite(m.qty) || m.qty === 0)
    throw new ValidationError({ qty: ["Enter a quantity."] });
  const [item] = await tx
    .select({
      id: pricebookItems.id,
      name: pricebookItems.name,
      cost: pricebookItems.unitCostCents,
      avg: pricebookItems.avgCostCents,
    })
    .from(pricebookItems)
    .where(eq(pricebookItems.id, m.pricebookItemId))
    .limit(1);
  if (!item) throw new NotFoundError("Item");
  const qty = Math.abs(m.qty);
  let from = m.fromLocationId ?? null;
  let to = m.toLocationId ?? null;
  switch (m.kind) {
    case "receive":
      if (!to)
        throw new ValidationError({ toLocationId: ["Pick where it goes."] });
      from = null;
      break;
    case "transfer":
      if (!from || !to || from === to)
        throw new ValidationError({
          toLocationId: ["Pick two different locations."],
        });
      break;
    case "use_on_job":
      if (!from)
        throw new ValidationError({ fromLocationId: ["Pick the location."] });
      to = null;
      break;
    case "return":
      // Back into stock (e.g. unused part from a job) when `to` is set; otherwise out to the vendor.
      if (!to && !from)
        throw new ValidationError({ toLocationId: ["Pick the location."] });
      break;
    case "adjust":
    case "count":
      if (!to && !from)
        throw new ValidationError({ toLocationId: ["Pick the location."] });
      break;
  }
  const signed = m.kind === "adjust" || m.kind === "count" ? m.qty : qty;
  // Adjust/count: positive → into `to` (or from), negative → out of it.
  if (m.kind === "adjust" || m.kind === "count") {
    const loc = (to ?? from) as string;
    const next = await bump(tx, loc, item.id, signed);
    if (next < 0 && !opts.allowNegative)
      throw new ConflictError(
        "negative_stock",
        "That would leave negative stock.",
      );
    from = signed < 0 ? loc : null;
    to = signed >= 0 ? loc : null;
  } else {
    if (from) {
      const next = await bump(tx, from, item.id, -qty);
      if (next < 0 && !opts.allowNegative)
        throw new ConflictError(
          "negative_stock",
          `Only ${next + qty} ${item.name} on hand there.`,
        );
    }
    if (to) await bump(tx, to, item.id, qty);
  }
  const unitCost = m.unitCostCents ?? item.avg ?? item.cost ?? null;
  if (m.kind === "receive" && m.unitCostCents != null) {
    const [tot] = await tx
      .select({ n: sql<string>`coalesce(sum(${inventoryLevels.onHand}), 0)` })
      .from(inventoryLevels)
      .where(eq(inventoryLevels.pricebookItemId, item.id));
    const onHandAfter = Number(tot?.n ?? 0);
    const avg = nextAvgCost(
      onHandAfter - qty,
      item.avg ?? item.cost,
      qty,
      m.unitCostCents,
    );
    await tx
      .update(pricebookItems)
      .set({ avgCostCents: avg, updatedAt: new Date() })
      .where(eq(pricebookItems.id, item.id));
  }
  const [mv] = await tx
    .insert(stockMoves)
    .values({
      pricebookItemId: item.id,
      fromLocationId: from,
      toLocationId: to,
      qty: m.kind === "adjust" || m.kind === "count" ? signed : qty,
      unitCostCents: unitCost,
      kind: m.kind,
      jobId: m.jobId ?? null,
      lineItemId: m.lineItemId ?? null,
      note: m.note?.trim() || null,
      actorUserId: actor.userId,
    })
    .returning({ id: stockMoves.id });
  if (!mv) throw new Error("stock move insert failed");
  if (m.kind === "transfer" && to) await closeRestockFor(tx, to, actor);
  return { moveId: mv.id };
}

/** Par levels for one item at one location. */
export async function setPar(
  tx: Tx,
  i: {
    locationId: string;
    pricebookItemId: string;
    minQty: number | null;
    maxQty: number | null;
  },
  actor: Actor,
): Promise<void> {
  if (i.minQty != null && i.maxQty != null && i.maxQty < i.minQty)
    throw new ValidationError({ maxQty: ["Max must be at least the min."] });
  const cur = await level(tx, i.locationId, i.pricebookItemId);
  if (cur)
    await tx
      .update(inventoryLevels)
      .set({ minQty: i.minQty, maxQty: i.maxQty, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryLevels.locationId, i.locationId),
          eq(inventoryLevels.pricebookItemId, i.pricebookItemId),
        ),
      );
  else
    await tx.insert(inventoryLevels).values({
      locationId: i.locationId,
      pricebookItemId: i.pricebookItemId,
      onHand: 0,
      minQty: i.minQty,
      maxQty: i.maxQty,
    });
  await writeAudit(tx, {
    actor,
    action: "inventory.par_set",
    entity: { type: "stock_location", id: i.locationId },
    after: i,
  });
}

/** Cycle count: set on-hand to the counted quantities; variance recorded as `count` moves. */
export async function recordCount(
  tx: Tx,
  locationId: string,
  counts: { pricebookItemId: string; counted: number }[],
  actor: Actor,
): Promise<{ variances: { pricebookItemId: string; delta: number }[] }> {
  const variances: { pricebookItemId: string; delta: number }[] = [];
  for (const c of counts) {
    if (!Number.isFinite(c.counted) || c.counted < 0) continue;
    const cur = await level(tx, locationId, c.pricebookItemId);
    const delta = c.counted - Number(cur?.onHand ?? 0);
    if (delta === 0) continue;
    await recordMove(
      tx,
      {
        kind: "count",
        pricebookItemId: c.pricebookItemId,
        qty: delta,
        toLocationId: locationId,
        note: "Cycle count",
      },
      actor,
      { allowNegative: true },
    );
    variances.push({ pricebookItemId: c.pricebookItemId, delta });
  }
  await closeTasksFor(
    tx,
    { kind: "custom", entity: { type: "stock_location", id: locationId } },
    "done",
    actor,
  );
  return { variances };
}

/** Items below par at a location, with the quantity needed to reach max (or min). */
export async function belowPar(tx: Tx, locationId: string) {
  const rows = await tx
    .select({
      itemId: inventoryLevels.pricebookItemId,
      name: pricebookItems.name,
      sku: pricebookItems.sku,
      onHand: inventoryLevels.onHand,
      min: inventoryLevels.minQty,
      max: inventoryLevels.maxQty,
    })
    .from(inventoryLevels)
    .innerJoin(
      pricebookItems,
      eq(pricebookItems.id, inventoryLevels.pricebookItemId),
    )
    .where(
      and(
        eq(inventoryLevels.locationId, locationId),
        sql`${inventoryLevels.minQty} is not null and ${inventoryLevels.onHand} < ${inventoryLevels.minQty}`,
      ),
    );
  return rows.map((r) => ({
    itemId: r.itemId,
    name: r.name,
    sku: r.sku,
    onHand: Number(r.onHand),
    min: Number(r.min ?? 0),
    need: Math.max(0, Number(r.max ?? r.min ?? 0) - Number(r.onHand)),
  }));
}

/** Tech "Request restock" → one open restock task per location (payload = items + qty). */
export async function requestRestock(
  tx: Tx,
  locationId: string,
  actor: Actor,
  note?: string | null,
): Promise<{ taskId: string | null; items: number }> {
  const [loc] = await tx
    .select()
    .from(stockLocations)
    .where(eq(stockLocations.id, locationId))
    .limit(1);
  if (!loc) throw new NotFoundError("Location");
  const items = await belowPar(tx, locationId);
  if (items.length === 0 && !note?.trim())
    throw new ConflictError(
      "nothing_below_par",
      "Everything on this truck is at par.",
    );
  const [open] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, "restock"),
        eq(tasks.status, "open"),
        eq(tasks.entityType, "stock_location"),
        eq(tasks.entityId, locationId),
      ),
    )
    .limit(1);
  const payload = {
    location_id: locationId,
    items: items.map((i) => ({
      pricebook_item_id: i.itemId,
      name: i.name,
      qty: i.need,
    })),
    note: note?.trim() || null,
  };
  // One open request per truck (tasks belong to B2: never edited here).
  if (open) return { taskId: open.id, items: items.length };
  const s = await settingsOf(tx);
  const { taskId } = await createTask(
    tx,
    {
      kind: "restock",
      title: `Restock ${loc.name} (${items.length} item${items.length === 1 ? "" : "s"})`,
      body: [
        ...items.map((i) => `${i.need} × ${i.name}`),
        ...(note?.trim() ? [note.trim()] : []),
      ].join("\n"),
      payload,
      assigneeUserId: s.inventory.restock_assignee_user_id,
      entity: { type: "stock_location", id: locationId },
      dueAt: new Date(Date.now() + 24 * 3_600_000),
    },
    actor,
  );
  return { taskId, items: items.length };
}

/** A transfer into a location closes its open restock task (SPEC M15). */
export async function closeRestockFor(
  tx: Tx,
  locationId: string,
  actor: Actor,
) {
  return closeTasksFor(
    tx,
    { kind: "restock", entity: { type: "stock_location", id: locationId } },
    "done",
    actor,
  );
}

/** Decrement truck stock when a company_stock part is added to a job (inventory on). */
export async function decrementForJob(
  tx: Tx,
  i: {
    userId: string;
    pricebookItemId: string;
    qty: number;
    jobId: string;
    lineItemId: string;
  },
  actor: Actor,
): Promise<boolean> {
  const s = await settingsOf(tx);
  if (!s.features.inventory || !s.inventory.decrement_on_use) return false;
  const loc = await locationForUser(tx, i.userId);
  const [wh] = loc
    ? [loc]
    : await tx
        .select({ id: stockLocations.id, name: stockLocations.name })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.kind, "warehouse"),
            isNull(stockLocations.vehicleId),
          ),
        )
        .limit(1);
  if (!wh) return false;
  await recordMove(
    tx,
    {
      kind: "use_on_job",
      pricebookItemId: i.pricebookItemId,
      qty: i.qty,
      fromLocationId: wh.id,
      jobId: i.jobId,
      lineItemId: i.lineItemId,
    },
    actor,
    { allowNegative: true },
  );
  return true;
}

/** Undo a use_on_job move when its line is removed from a draft invoice. */
export async function returnFromJob(
  tx: Tx,
  lineItemId: string,
  actor: Actor,
): Promise<void> {
  const moves = await tx
    .select()
    .from(stockMoves)
    .where(
      and(
        eq(stockMoves.lineItemId, lineItemId),
        inArray(stockMoves.kind, ["use_on_job"]),
      ),
    );
  for (const mv of moves) {
    if (!mv.fromLocationId) continue;
    await recordMove(
      tx,
      {
        kind: "return",
        pricebookItemId: mv.pricebookItemId,
        qty: Number(mv.qty),
        toLocationId: mv.fromLocationId,
        jobId: mv.jobId,
        note: "Removed from job",
      },
      actor,
    );
  }
}
