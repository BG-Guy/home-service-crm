// Settings fragment(s) owned by module `reviews` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";
import { safeHttpsUrl } from "./url";

export const settingsShape = {
  reviews: z
    .object({
      // Used as a redirect target (/r/[token]): https only. A stored non-https value
      // fails here and falls back to null (parseSettings never throws). QA T5-17.
      google_url: z
        .string()
        .refine((v) => safeHttpsUrl(v) !== null, "Use an https:// link.")
        .nullable()
        .default(null),
      min_days_between: z.number().int().default(365),
      delay_minutes: z.number().int().min(60).max(120).default(90),
      reminder_enabled: z.boolean().default(true),
      internal_rating_page: z.boolean().default(true),
      consent_basis: z
        .enum(["transactional", "marketing"])
        .default("transactional"),
      skip_no_charge_callbacks: z.boolean().default(true),
      /** Automated asks only for jobs completed within this many days (QA T6-06). */
      max_days_after_completion: z.number().int().min(1).max(365).default(30),
    })
    .prefault({}),
} as const;
