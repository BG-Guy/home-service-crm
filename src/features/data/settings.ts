// Settings fragment(s) owned by module `data` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  data: z
    .object({
      backups_enabled: z.boolean().default(true),
      backup_keep_daily: z.number().int().default(14),
      backup_keep_weekly: z.number().int().default(8),
      export_link_hours: z.number().int().default(24),
    })
    .prefault({}),
} as const;
