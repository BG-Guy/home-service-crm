// Settings fragment(s) owned by module `notify` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  notify: z
    .object({
      daily_digest_time: z.string().default("07:30"),
      approval_batch_minutes: z.number().int().default(15),
      /** Notification types that fall back to email when push is unavailable. */
      critical_email_fallback: z
        .array(z.string())
        .default([
          "staff.new_lead",
          "staff.dispute",
          "staff.cash_over_limit",
          "staff.settlement_ready",
        ]),
    })
    .prefault({}),
} as const;
