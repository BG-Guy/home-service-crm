import "server-only";
import type { Tx } from "@/db";
import { settingsOf } from "@/features/payroll/server/util";
import { priceForCostTiers } from "../rules";

/** Price from settings.parts.markup_tiers (own namespace), read through `tx`. */
export async function markupPrice(
  tx: Tx,
  unitCostCents: number,
): Promise<number> {
  const s = await settingsOf(tx);
  return priceForCostTiers(s.parts.markup_tiers, unitCostCents);
}
