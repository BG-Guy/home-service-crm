// Settings fragment(s) owned by module `parts` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  parts: z
    .object({
      /** Cost (cents) below `lt` → price = cost × mult; last tier has lt = null. */
      markup_tiers: z
        .array(
          z.object({
            lt: z.number().int().nullable(),
            mult: z.number().positive(),
          }),
        )
        .default([
          { lt: 2000, mult: 4 },
          { lt: 10000, mult: 3 },
          { lt: null, mult: 2 },
        ]),
      receipt_required_over_cents: z.number().int().default(0),
      ai_match_tolerance_cents: z.number().int().default(50),
      receipt_max_age_days: z.number().int().default(7),
      stale_receipt_days: z.number().int().default(60),
      /** Due date of the warranty_claim task created on a callback with reason "part". */
      warranty_claim_days: z.number().int().min(1).default(30),
    })
    .prefault({}),
  inventory: z
    .object({
      cycle_count_day: z.number().int().min(1).max(28).default(1),
      /** Decrement the tech's truck stock when a company_stock part is added to a job. */
      decrement_on_use: z.boolean().default(true),
      /** Who fulfils restock requests (null = office queue). */
      restock_assignee_user_id: z.string().nullable().default(null),
    })
    .prefault({}),
} as const;
