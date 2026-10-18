// Settings fragment(s) owned by module `tools` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  tools: z
    .object({
      audit_frequency_days: z.number().int().default(30),
      maintenance_interval_days_by_category: z
        .record(z.string(), z.number().int())
        .default({}),
      /** ⚖️ Off by default; blocked for W-2 in flagged states. */
      deductions_enabled: z.boolean().default(false),
      agreement_text: z.string().nullable().default(null),
      /** Block check-out while calibration is overdue (SPEC M18). */
      block_on_calibration_overdue: z.boolean().default(true),
      /** Photo required at each check-out/check-in handoff. */
      require_handoff_photo: z.boolean().default(true),
      /** Days before maintenance due when `tool.maintenance_due` fires. */
      maintenance_warning_days: z.number().int().min(0).max(60).default(7),
    })
    .prefault({}),
} as const;
