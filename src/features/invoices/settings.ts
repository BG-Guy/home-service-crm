// Settings fragment(s) owned by module `invoices` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  invoices: z
    .object({
      auto_issue_on_complete: z.boolean().default(true),
      photos_on_invoice: z.boolean().default(true),
      photos_on_receipt: z.boolean().default(true),
      residential_terms: z
        .enum(["due_on_receipt", "net_15", "net_30"])
        .default("due_on_receipt"),
      commercial_terms: z
        .enum(["due_on_receipt", "net_15", "net_30"])
        .default("net_30"),
      footer: z.string().default(""),
      late_fee: z
        .object({
          enabled: z.boolean().default(false),
          pct_bps: z.number().int().default(0),
        })
        .prefault({}),
    })
    .prefault({}),
} as const;
