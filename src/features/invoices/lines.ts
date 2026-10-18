import "server-only";
import { z } from "zod";
import { ConflictError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import type { LineInput } from "./contracts";
import { discountPercent, discountWithinLimit } from "./math";

export { mathLines } from "./math";

// Shared line schema + discount guard for invoice, estimate and change-order editors.

const zQty = z.coerce
  .number()
  .positive("Quantity must be more than 0.")
  .max(100_000);
const zCents = z.coerce.number().int().min(-100_000_000).max(100_000_000);

export const LineSchema = z.object({
  id: z.uuid().optional(),
  type: z.enum(["service", "labor", "part", "material", "fee", "discount"]),
  pricebookItemId: z.uuid().nullable().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  qty: zQty.refine(
    (q) => Math.round(q * 1000) / 1000 === q,
    "Up to 3 decimals.",
  ),
  unitPriceCents: zCents,
  unitCostCents: zCents.nullable().optional(),
  discountCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  taxable: z.boolean().optional(),
  partSource: z
    .enum(["company_stock", "company_po", "company_card", "tech_purchased"])
    .nullable()
    .optional(),
  warrantyDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(36_500)
    .nullable()
    .optional(),
  manufacturerWarrantyMonths: z.coerce
    .number()
    .int()
    .min(0)
    .max(600)
    .nullable()
    .optional(),
  serial: z.string().trim().max(120).nullable().optional(),
  isServiceFee: z.boolean().optional(),
  isUpsell: z.boolean().optional(),
  isOptional: z.boolean().optional(),
  isSelected: z.boolean().optional(),
});
export type LineDraft = z.infer<typeof LineSchema>;

/** Role discount limit (M07): discount perm + settings.limits.max_discount_pct by role. */
export async function assertDiscountAllowed(
  user: SessionUser,
  lines: Parameters<typeof discountPercent>[0],
): Promise<void> {
  const pct = discountPercent(lines);
  if (pct <= 0) return;
  if (!user.perms.has("estimates.discount"))
    throw new ConflictError("discount_forbidden", "You can't apply discounts.");
  const max = (await getSettings()).limits.max_discount_pct[user.baseRole];
  if (!discountWithinLimit(pct, max))
    throw new ConflictError(
      "discount_limit",
      `Discounts are limited to ${max}% for your role (this is ${pct}%). Ask an admin.`,
    );
}

export function toLineInput(l: LineDraft): LineInput {
  return {
    type: l.type,
    pricebookItemId: l.pricebookItemId ?? null,
    name: l.name,
    description: l.description ?? null,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    unitCostCents: l.unitCostCents ?? null,
    discountCents: l.discountCents ?? 0,
    taxable: l.taxable,
    partSource: l.partSource ?? null,
    warrantyDays: l.warrantyDays ?? null,
    manufacturerWarrantyMonths: l.manufacturerWarrantyMonths ?? null,
    serial: l.serial ?? null,
    isServiceFee: l.isServiceFee ?? false,
    isUpsell: l.isUpsell ?? false,
  };
}
