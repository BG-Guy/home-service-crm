// Settings fragment(s) owned by module `portal` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  portal: z
    .object({
      show_tech_photo: z.boolean().default(true),
      allow_reschedule_request: z.boolean().default(true),
      rate_limit_per_minute: z.number().int().default(60),
    })
    .prefault({}),
} as const;
