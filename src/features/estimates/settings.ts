// Settings fragment(s) owned by module `estimates` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  estimates: z
    .object({
      expiry_days: z.number().int().min(1).default(30),
      change_order_threshold_pct: z.number().min(0).default(10),
      change_order_threshold_cents: z.number().int().min(0).default(0),
      // Names for the 1–3 options of an estimate, by position. Stored labels win
      // (deployments that saved Good / Better / Best keep them).
      option_labels: z
        .array(z.string())
        .default(["Option 1", "Option 2", "Option 3"]),
    })
    .prefault({}),
} as const;
