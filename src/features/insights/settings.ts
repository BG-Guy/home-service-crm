// Settings fragment(s) owned by module `insights` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  insights: z
    .object({
      /** Show techs their rank among peers on My Stats (SPEC M20). */
      show_tech_rank: z.boolean().default(false),
      week_starts_on: z.number().int().min(0).max(6).default(1),
      /** Anomaly report: flag invoices discounted more than this share (percent). */
      anomaly_discount_pct: z.number().min(1).max(100).default(25),
      /** Anomaly report window (days, trailing). */
      anomaly_window_days: z.number().int().min(1).max(90).default(7),
    })
    .prefault({}),
} as const;
