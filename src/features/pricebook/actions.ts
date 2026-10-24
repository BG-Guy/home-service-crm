"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { pricebookItems } from "@/db/schema";
import { action, zf } from "@/lib/action";
import { requireAnyPerm } from "@/lib/auth/current";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { updateSettings } from "@/lib/settings";
import {
  pricebookCategories,
  recentPricebookItems,
  searchPricebook,
  upsertPricebookItems,
} from "./api";
import type { PricebookFacets, PricebookPick } from "./contracts";
import { PRICEBOOK_KINDS } from "./csv";
import { normalizeTiers } from "./markup";

// Price book mutations (pricebook.manage) + the picker's search (S14).

const PATHS = ["/settings/pricebook"];
const zKind = z.enum(PRICEBOOK_KINDS);
const optCents = z.preprocess(
  (v) =>
    v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v,
  z.number().int().min(0).max(100_000_000).nullable(),
);
const optInt = z.preprocess(
  (v) =>
    v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v,
  z.number().int().min(0).max(36_500).nullable(),
);

const ItemInput = z.object({
  id: z.uuid().optional(),
  kind: zKind,
  name: z.string().trim().min(1, "Enter a name.").max(200),
  sku: zf.optionalText(80),
  category: zf.optionalText(80),
  description: zf.optionalText(2000),
  vendor: zf.optionalText(120),
  unitCostCents: optCents,
  unitPriceCents: optCents,
  taxable: zf.checkbox(),
  isSpecialOrder: zf.checkbox(),
  warrantyDays: optInt,
  manufacturerWarrantyMonths: optInt,
  active: zf.checkbox(),
});

export const savePricebookItem = action({
  perm: "pricebook.manage",
  input: ItemInput,
  audit: "pricebook.item_saved",
  async run({ input, tx, audit }) {
    if (input.unitPriceCents == null && input.unitCostCents == null)
      throw new ValidationError({
        unitPriceCents: [
          "Enter a price, or a cost to price it from the markup matrix.",
        ],
      });
    const values = {
      kind: input.kind,
      name: input.name,
      sku: input.sku ?? null,
      category: input.category ?? null,
      description: input.description ?? null,
      vendor: input.vendor ?? null,
      unitCostCents: input.unitCostCents,
      unitPriceCents: input.unitPriceCents,
      taxable: input.taxable,
      isSpecialOrder: input.isSpecialOrder,
      warrantyDays: input.warrantyDays,
      manufacturerWarrantyMonths: input.manufacturerWarrantyMonths,
      active: input.active,
    };
    if (input.id) {
      const [before] = await tx
        .select()
        .from(pricebookItems)
        .where(eq(pricebookItems.id, input.id))
        .limit(1);
      if (!before || before.deletedAt) throw new NotFoundError("Item");
      await tx
        .update(pricebookItems)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(pricebookItems.id, input.id));
      await audit({
        entity: { type: "pricebook_item", id: input.id },
        before,
        after: values,
      });
      return { id: input.id };
    }
    const [row] = await tx
      .insert(pricebookItems)
      .values(values)
      .returning({ id: pricebookItems.id });
    if (!row) throw new Error("insert failed");
    await audit({
      entity: { type: "pricebook_item", id: row.id },
      after: values,
      full: true,
    });
    return { id: row.id };
  },
  revalidate: () => PATHS,
});

export const setPricebookItemActive = action({
  perm: "pricebook.manage",
  input: z.object({ id: z.uuid(), active: z.boolean() }),
  audit: "pricebook.item_active",
  async run({ input, tx }) {
    await tx
      .update(pricebookItems)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(pricebookItems.id, input.id));
    return { id: input.id };
  },
  auditEntity: ({ input }) => ({ type: "pricebook_item", id: input.id }),
  revalidate: () => PATHS,
});

/** Soft delete: historical lines keep their snapshot (name/price on the line). */
export const deletePricebookItem = action({
  perm: "pricebook.manage",
  input: z.object({ id: z.uuid() }),
  audit: "pricebook.item_deleted",
  async run({ input, tx }) {
    const now = new Date();
    await tx
      .update(pricebookItems)
      .set({ deletedAt: now, active: false, updatedAt: now })
      .where(eq(pricebookItems.id, input.id));
    return { id: input.id };
  },
  auditEntity: ({ input }) => ({ type: "pricebook_item", id: input.id }),
  revalidate: () => PATHS,
});

const CsvRow = z.object({
  sku: z.string().max(80).nullable(),
  name: z.string().trim().min(1).max(200),
  kind: zKind,
  category: z.string().max(80).nullable(),
  description: z.string().max(2000).nullable(),
  unitCostCents: z.number().int().min(0).nullable(),
  unitPriceCents: z.number().int().min(0).nullable(),
  taxable: z.boolean(),
  isSpecialOrder: z.boolean(),
  vendor: z.string().max(120).nullable(),
  warrantyDays: z.number().int().min(0).nullable(),
  manufacturerWarrantyMonths: z.number().int().min(0).nullable(),
  active: z.boolean(),
});

/** Rows parsed in the browser (csv.ts); re-validated here. Upsert by SKU, else name. */
export const importPricebookRows = action({
  perm: "pricebook.manage",
  input: z.object({ rows: z.array(CsvRow).min(1).max(5000) }),
  async run({ input, tx, actor }) {
    return upsertPricebookItems(tx, input.rows, actor);
  },
  revalidate: () => PATHS,
});

/** Markup matrix (settings.parts.markup_tiers; edit right granted to B3 by §3.4). */
export const saveMarkupTiers = action({
  perm: "pricebook.manage",
  input: z.object({
    tiers: z
      .array(
        z.object({
          lt: z.number().int().positive().nullable(),
          mult: z.number().min(1, "Multiplier must be at least 1×.").max(20),
        }),
      )
      .min(1)
      .max(12),
  }),
  async run({ input, tx, actor }) {
    const tiers = normalizeTiers(input.tiers);
    await updateSettings(tx, { parts: { markup_tiers: tiers } }, actor);
    return { tiers };
  },
  revalidate: () => [...PATHS, "/estimates", "/invoices"],
});

/**
 * S14 search (a read — no action() transaction). Anyone who builds documents or
 * adds parts may search; prices are not secret, costs are only returned to editors.
 */
const PICKER_PERMS = [
  "estimates.create",
  "invoices.create",
  "pricebook.manage",
  "parts.add_to_job",
] as const;

const pickerKinds = (kinds: unknown): PricebookPick["kind"][] =>
  (Array.isArray(kinds) ? kinds : []).filter((k): k is PricebookPick["kind"] =>
    (PRICEBOOK_KINDS as readonly string[]).includes(k),
  );

/** Costs only for editors (pricebook.manage / parts.view_cost). */
const forViewer = (
  user: Awaited<ReturnType<typeof requireAnyPerm>>,
  items: PricebookPick[],
) =>
  user.perms.has("pricebook.manage") || user.perms.has("parts.view_cost")
    ? items
    : items.map((i) => ({ ...i, unitCostCents: null }));

export async function searchPricebookItems(input: {
  q: string;
  kinds?: PricebookPick["kind"][];
  /** A category chip (Quote to Paid E3). */
  category?: string | null;
}): Promise<PricebookPick[]> {
  const user = await requireAnyPerm([...PICKER_PERMS]);
  const q = typeof input?.q === "string" ? input.q : "";
  const category =
    typeof input?.category === "string" ? input.category.slice(0, 80) : null;
  const items = await searchPricebook(q, {
    kinds: pickerKinds(input?.kinds),
    limit: 60,
    category,
  });
  return forViewer(user, items);
}

/** The picker's category chips and this user's recent items (a read, S14). */
export async function pricebookPickerFacets(input: {
  kinds?: PricebookPick["kind"][];
}): Promise<PricebookFacets> {
  const user = await requireAnyPerm([...PICKER_PERMS]);
  const kinds = pickerKinds(input?.kinds);
  const [categories, recent] = await Promise.all([
    pricebookCategories(kinds),
    recentPricebookItems(user.id, { kinds }),
  ]);
  return { categories, recent: forViewer(user, recent) };
}
