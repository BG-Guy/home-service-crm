// Settings fragment(s) owned by module `jobs` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  jobs: z
    .object({
      arrival_radius_m: z.number().int().min(50).default(300),
      window_lengths_min: z.array(z.number().int()).default([60, 120, 240]),
      default_window_min: z.number().int().default(60),
      /** Local time the "unconfirmed tomorrow" list is flagged to the office. */
      unconfirmed_flag_time: z.string().default("09:00"),
      cancellation_policy: z
        .object({
          late_cancel_hours: z.number().int().default(24),
          late_cancel_fee_cents: z.number().int().default(0),
          no_show_fee_cents: z.number().int().default(0),
        })
        .prefault({}),
      service_call_fee_cents: z.number().int().nullable().default(null),
      service_call_fee_credited: z.boolean().default(true),
      callback_no_charge: z.boolean().default(true),
      warranty_claim_due_days: z.number().int().default(30),
      /** Schedule board visible hours (company TZ). */
      board_start_hour: z.number().int().min(0).max(23).default(7),
      board_end_hour: z.number().int().min(1).max(24).default(20),
    })
    .prefault({}),
} as const;
