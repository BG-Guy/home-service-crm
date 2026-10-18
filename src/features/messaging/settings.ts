// Settings fragment(s) owned by module `messaging` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  messaging: z
    .object({
      tech_texts_from: z
        .enum(["tech_phone", "office_outbox"])
        .default("tech_phone"),
      /** template key → 'tech' | 'office' (link-mode outbox owner). */
      outbox_owner_by_template: z
        .record(z.string(), z.enum(["tech", "office"]))
        .default({
          "job.on_my_way": "tech",
          "job.running_late": "tech",
        }),
      link_delimiter: z.enum(["auto", "?", "&", "?&"]).default("auto"),
      whatsapp_enabled: z.boolean().default(false),
      email_from_name: z.string().nullable().default(null),
      reply_phone: z.string().nullable().default(null),
    })
    .prefault({}),
} as const;
