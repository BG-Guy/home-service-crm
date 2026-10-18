// Settings fragment(s) owned by module `auth` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  auth: z
    .object({
      /** After the first admin exists, allow public signups that land as `pending` users. */
      open_signup: z.boolean().default(false),
      /** Role given to approved open signups. */
      open_signup_role: z.string().default("tech"),
    })
    .prefault({}),
} as const;
