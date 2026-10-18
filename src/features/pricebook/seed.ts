// Demo seed fragment for `pricebook` (BUILD_PLAN §10.3 #4). Owner: B3.
// Writes pricebook_items from DEMO.pricebook (ids = seedId('pricebook', key)), plus a
// few descriptions so the picker and the customer-facing estimate read well.
// Never emits events; rerunnable (onConflictDoNothing).
import type { DB } from "@/db";
import { pricebookItems } from "@/db/schema";
import type { DemoSeedCtx } from "@/db/seed/types";

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  // Descriptions live on the trade profile's price book.
  const descriptions = new Map(
    ctx.profile.pricebook.map((p) => [p.key, p.description ?? null]),
  );
  const rows = ctx.plan.pricebook.map((p) => ({
    id: p.id,
    kind: p.kind,
    sku: p.sku,
    name: p.name,
    description: descriptions.get(p.key) ?? null,
    category: p.category,
    unitCostCents: p.unitCostCents,
    unitPriceCents: p.unitPriceCents,
    taxable: p.taxable,
    warrantyDays: p.warrantyDays,
    manufacturerWarrantyMonths: p.manufacturerWarrantyMonths,
    isSpecialOrder: p.isSpecialOrder,
    vendor: p.vendor,
    active: true,
  }));
  if (rows.length)
    await db.insert(pricebookItems).values(rows).onConflictDoNothing();
  ctx.log(`pricebook: ${rows.length} items`);
}
