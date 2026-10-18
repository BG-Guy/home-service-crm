// Settings fragment(s) owned by module `leads` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  leads: z
    .object({
      assignment: z
        .enum(["first_to_claim", "round_robin"])
        .default("first_to_claim"),
      sla_business_hours: z.boolean().default(false),
      spam_review_threshold: z.number().int().min(0).max(100).default(50),
      lost_reasons: z
        .array(z.string())
        .default([
          "price",
          "timing",
          "out_of_area",
          "no_answer",
          "went_with_competitor",
          "other",
        ]),
      dedupe_window_minutes: z.number().int().default(10),
      returning_window_days: z.number().int().default(14),
      rate_limit_per_minute: z.number().int().default(10),
      daily_cap_per_source: z.number().int().default(500),
      default_source_id: z.string().nullable().default(null),
    })
    .prefault({}),
} as const;
