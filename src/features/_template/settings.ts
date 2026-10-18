// Settings namespace(s) owned by this module, merged into CompanySettings
// (SPEC §15.1, BUILD_PLAN §3.4). Every key needs a default; objects use
// .prefault({}) so a missing namespace parses to its defaults. Add keys freely,
// never rename or remove them (stored JSON depends on them).
import { z } from "zod";

export const settingsShape = {
  example: z
    .object({
      /** Remind the assignee this many hours before an item is due. */
      remind_hours_before: z.number().int().min(0).max(168).default(24),
      default_assignee_role: z.enum(["office", "tech"]).default("office"),
    })
    .prefault({}),
} as const;
