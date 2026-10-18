import "server-only";
import { asc, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { pricebookItems } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";
import type { PricebookItemRow, PricebookPick } from "./contracts";
import { priceForCost } from "./markup";

// Read DAL for the price book settings screen (pricebook.manage). The picker reads
// through the search server function in actions.ts (any document-editing perm).

/** Every non-deleted item (price books are small: a few hundred to ~2k rows). */
export const listPricebookItems = cache(
  async (): Promise<PricebookItemRow[]> => {
    await requireUser("pricebook.manage");
    const [rows, settings] = await Promise.all([
      db
        .select()
        .from(pricebookItems)
        .where(isNull(pricebookItems.deletedAt))
        .orderBy(
          asc(sql`lower(coalesce(${pricebookItems.category}, 'zzz'))`),
          asc(sql`lower(${pricebookItems.name})`),
        )
        .limit(5000),
      getSettings(),
    ]);
    const tiers = settings.parts.markup_tiers;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as PricebookPick["kind"],
      sku: r.sku,
      name: r.name,
      description: r.description,
      category: r.category,
      unitCostCents: r.unitCostCents,
      unitPriceCents: r.unitPriceCents,
      effectivePriceCents:
        r.unitPriceCents ??
        (r.unitCostCents != null ? priceForCost(tiers, r.unitCostCents) : 0),
      avgCostCents: r.avgCostCents,
      taxable: r.taxable,
      isSpecialOrder: r.isSpecialOrder,
      vendor: r.vendor,
      warrantyDays: r.warrantyDays,
      manufacturerWarrantyMonths: r.manufacturerWarrantyMonths,
      active: r.active,
    }));
  },
);
