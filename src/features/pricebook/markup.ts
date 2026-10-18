// Markup matrix (SPEC M21 price book; settings.parts.markup_tiers owned by B6, edited on
// /settings/pricebook by B3). Pure and isomorphic.
import { roundHalfAway } from "@/lib/money";

export interface MarkupTier {
  /** Upper bound (exclusive) on unit cost in cents; null = no bound (last tier). */
  lt: number | null;
  /** Price = cost × mult. */
  mult: number;
}

/** The tier that applies to a cost: the first whose `lt` exceeds it, else the last. */
export function tierFor(
  tiers: readonly MarkupTier[],
  unitCostCents: number,
): MarkupTier | null {
  return (
    tiers.find((t) => t.lt === null || unitCostCents < t.lt) ??
    tiers[tiers.length - 1] ??
    null
  );
}

/** Sell price from cost via the matrix (half away from zero). */
export function priceForCost(
  tiers: readonly MarkupTier[],
  unitCostCents: number,
): number {
  return roundHalfAway(
    unitCostCents * (tierFor(tiers, unitCostCents)?.mult ?? 1),
  );
}

/** Markup over cost in percent ((price − cost) / cost), null without a cost. */
export function markupPct(
  priceCents: number,
  costCents: number | null,
): number | null {
  if (costCents == null || costCents <= 0) return null;
  return Math.round(((priceCents - costCents) / costCents) * 1000) / 10;
}

/** Gross margin in percent ((price − cost) / price), null without a cost or price. */
export function marginPct(
  priceCents: number,
  costCents: number | null,
): number | null {
  if (costCents == null || priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 1000) / 10;
}

/** Multiplier ⇄ margin helpers for the matrix editor (×4 = 75 % margin). */
export const multToMarginPct = (mult: number) =>
  mult > 0 ? Math.round((1 - 1 / mult) * 1000) / 10 : 0;

/** Normalize tiers: ascending bounds, exactly one open-ended last tier. */
export function normalizeTiers(tiers: readonly MarkupTier[]): MarkupTier[] {
  const bounded = tiers
    .filter((t): t is MarkupTier & { lt: number } => t.lt != null && t.lt > 0)
    .sort((a, b) => a.lt - b.lt);
  const dedup = bounded.filter(
    (t, i) => i === 0 || t.lt !== bounded[i - 1]?.lt,
  );
  const open = tiers.find((t) => t.lt == null) ?? { lt: null, mult: 2 };
  return [...dedup, { lt: null, mult: open.mult }];
}
