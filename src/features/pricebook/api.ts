import "server-only";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db, type Tx } from "@/db";
import { pricebookItems } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import type { Actor } from "@/lib/types";
import type { PricebookPick, PricebookUpsertRow } from "./contracts";
import { type MarkupTier, priceForCost } from "./markup";

// B3 price book API (BUILD_PLAN §6.3). Reads take no tx; writes take tx first and the
// actor last, run in the caller's transaction and never check permissions.

export type * from "./contracts";

type Row = typeof pricebookItems.$inferSelect;

async function tiers(): Promise<MarkupTier[]> {
  return (await getSettings()).parts.markup_tiers;
}

/** Row → pick. A null stored price falls back to the markup matrix over the cost. */
export function toPick(r: Row, t: readonly MarkupTier[]): PricebookPick {
  return {
    id: r.id,
    kind: r.kind as PricebookPick["kind"],
    sku: r.sku,
    name: r.name,
    description: r.description,
    unitPriceCents:
      r.unitPriceCents ??
      (r.unitCostCents != null ? priceForCost(t, r.unitCostCents) : 0),
    unitCostCents: r.unitCostCents,
    taxable: r.taxable,
    isSpecialOrder: r.isSpecialOrder,
    warrantyDays: r.warrantyDays,
    manufacturerWarrantyMonths: r.manufacturerWarrantyMonths,
    category: r.category,
  };
}

/** Escape LIKE wildcards in user input. */
const likeSafe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Active items matching `q` (name prefix or word prefix, SKU prefix, category) —
 * prefix matches use the `lower(name) text_pattern_ops` index. Empty q → A–Z.
 */
export async function searchPricebook(
  q: string,
  opts?: { kinds?: PricebookPick["kind"][]; limit?: number },
): Promise<PricebookPick[]> {
  const conds: SQL[] = [
    eq(pricebookItems.active, true),
    isNull(pricebookItems.deletedAt),
  ];
  const term = likeSafe(q.trim().slice(0, 80));
  if (term)
    conds.push(
      or(
        ilike(pricebookItems.name, `${term}%`),
        ilike(pricebookItems.name, `% ${term}%`),
        ilike(pricebookItems.sku, `${term}%`),
        ilike(pricebookItems.category, `${term}%`),
      ) as SQL,
    );
  if (opts?.kinds?.length) conds.push(inArray(pricebookItems.kind, opts.kinds));
  const [rows, t] = await Promise.all([
    db
      .select()
      .from(pricebookItems)
      .where(and(...conds))
      .orderBy(
        asc(sql`lower(coalesce(${pricebookItems.category}, ''))`),
        asc(sql`lower(${pricebookItems.name})`),
      )
      .limit(Math.min(opts?.limit ?? 40, 200)),
    tiers(),
  ]);
  return rows.map((r) => toPick(r, t));
}

export async function getPricebookItem(
  id: string,
): Promise<PricebookPick | null> {
  const [r] = await db
    .select()
    .from(pricebookItems)
    .where(eq(pricebookItems.id, id))
    .limit(1);
  return r ? toPick(r, await tiers()) : null;
}

/** settings.parts.markup_tiers: the first tier whose `lt` exceeds the cost. */
export async function priceFromMarkup(unitCostCents: number): Promise<number> {
  return priceForCost(await tiers(), unitCostCents);
}

/**
 * Bulk upsert (CSV import, B1 data import). Matches by SKU, else case-insensitive
 * name among non-deleted items. Never touches `avg_cost_cents` (B6). Audited once.
 */
export async function upsertPricebookItems(
  tx: Tx,
  rows: PricebookUpsertRow[],
  actor: Actor,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const [match] = await tx
      .select({ id: pricebookItems.id })
      .from(pricebookItems)
      .where(
        and(
          isNull(pricebookItems.deletedAt),
          r.sku
            ? eq(pricebookItems.sku, r.sku)
            : sql`lower(${pricebookItems.name}) = lower(${r.name})`,
        ),
      )
      .limit(1);
    const values = {
      sku: r.sku ?? null,
      name: r.name.trim().slice(0, 200),
      kind: r.kind,
      category: r.category?.trim() || null,
      unitCostCents: r.unitCostCents ?? null,
      unitPriceCents: r.unitPriceCents ?? null,
      taxable: r.taxable ?? (r.kind === "part" || r.kind === "material"),
      isSpecialOrder: r.isSpecialOrder ?? false,
      vendor: r.vendor ?? null,
      ...(r.description !== undefined ? { description: r.description } : {}),
      ...(r.warrantyDays !== undefined ? { warrantyDays: r.warrantyDays } : {}),
      ...(r.manufacturerWarrantyMonths !== undefined
        ? { manufacturerWarrantyMonths: r.manufacturerWarrantyMonths }
        : {}),
      ...(r.active !== undefined ? { active: r.active } : {}),
    };
    if (match) {
      await tx
        .update(pricebookItems)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(pricebookItems.id, match.id));
      updated++;
    } else {
      await tx.insert(pricebookItems).values(values);
      created++;
    }
  }
  await writeAudit(tx, {
    actor,
    action: "pricebook.imported",
    after: { created, updated },
    full: true,
  });
  return { created, updated };
}
