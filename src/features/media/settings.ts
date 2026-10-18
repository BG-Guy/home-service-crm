// Settings fragment(s) owned by module `media` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  media: z
    .object({
      /** Upload originals for these tags (when chargeback protection is on). */
      keep_originals: z.boolean().default(true),
      keep_originals_tags: z
        .array(z.string())
        .default(["before", "after", "id_check", "signature"]),
      max_upload_mb: z.number().int().min(1).max(15).default(15),
      // ---- added by B4 ----
      /** Photos geostamped farther than this from the property are flagged `far_from_site`. */
      far_from_site_m: z.number().int().min(50).default(500),
    })
    .prefault({}),
} as const;
