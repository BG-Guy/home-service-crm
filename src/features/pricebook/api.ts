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
import { db, execRows, type Tx } from "@/db";
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
  opts?: {
    kinds?: PricebookPick["kind"][];
    limit?: number;
    /** One category (case-insensitive), e.g. a picker chip. */
    category?: string | null;
  },
): Promise<PricebookPick[]> {
  const conds: SQL[] = [
    eq(pricebookItems.active, true),
    isNull(pricebookItems.deletedAt),
  ];
  const cat = opts?.category?.trim().slice(0, 80);
  if (cat)
    conds.push(
      sql`lower(trim(${pricebookItems.category})) = lower(${cat})` as SQL,
    );
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

/** Distinct categories of active items (the picker's chips), A–Z. */
export async function pricebookCategories(
  kinds?: PricebookPick["kind"][],
): Promise<string[]> {
  const kindSql = kinds?.length
    ? sql`and kind in (${sql.join(
        kinds.map((k) => sql`${k}`),
        sql`, `,
      )})`
    : sql``;
  const rows = await execRows<{ c: string }>(sql`
    select min(trim(category)) as c from pricebook_items
    where active and deleted_at is null and coalesce(trim(category), '') <> '' ${kindSql}
    group by lower(trim(category)) order by lower(trim(category)) limit 40`);
  return rows.map((r) => r.c);
}

/**
 * "Recent" in the picker: price-book items this user put on their own estimates
 * and invoices in the last 90 days, newest first (no table of its own: the
 * estimates' and invoices' `created_by` and the line's parent index).
 */
export async function recentPricebookItems(
  userId: string,
  opts?: { kinds?: PricebookPick["kind"][]; limit?: number },
): Promise<PricebookPick[]> {
  const rows = await execRows<{ id: string }>(sql`
    select li.pricebook_item_id as id, max(li.created_at) as last
    from line_items li
    where li.pricebook_item_id is not null
      and li.created_at > now() - interval '90 days'
      and (
        (li.parent_type = 'estimate_option' and li.parent_id in (
          select o.id from estimate_options o join estimates e on e.id = o.estimate_id
          where e.created_by = ${userId} and e.created_at > now() - interval '90 days'))
        or (li.parent_type = 'invoice' and li.parent_id in (
          select i.id from invoices i
          where i.created_by = ${userId} and i.created_at > now() - interval '90 days'))
      )
    group by li.pricebook_item_id
    order by last desc
    limit ${Math.min(opts?.limit ?? 12, 40)}`);
  if (rows.length === 0) return [];
  const conds: SQL[] = [
    inArray(
      pricebookItems.id,
      rows.map((r) => r.id),
    ),
    eq(pricebookItems.active, true),
    isNull(pricebookItems.deletedAt),
  ];
  if (opts?.kinds?.length) conds.push(inArray(pricebookItems.kind, opts.kinds));
  const [items, t] = await Promise.all([
    db
      .select()
      .from(pricebookItems)
      .where(and(...conds)),
    tiers(),
  ]);
  const byId = new Map(items.map((r) => [r.id, r]));
  return rows
    .map((r) => byId.get(r.id))
    .filter((r): r is Row => !!r)
    .map((r) => toPick(r, t));
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
