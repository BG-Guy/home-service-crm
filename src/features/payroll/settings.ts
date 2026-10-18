// Settings fragment(s) owned by module `payroll` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  payroll: z
    .object({
      period: z.enum(["weekly", "biweekly", "semimonthly"]).default("weekly"),
      week_starts_on: z.number().int().min(0).max(6).default(1),
      close_delay_hours: z.number().int().default(24),
      review_hours: z.number().int().default(48),
      negative_balance: z
        .enum(["carry_forward", "request_remittance"])
        .default("carry_forward"),
      nacha_enabled: z.boolean().default(false),
      bank_change_hold_hours: z.number().int().default(72),
      threshold_1099_cents: z.number().int().default(200000),
      default_plan_key: z.string().default("partner_25"),
      /** Any first day of a bi-weekly period (aligns the 14-day grid). */
      biweekly_anchor: z.string().default("2026-01-05"),
      /** Role default commission rates (rate resolution step "role"), bps by role key. */
      role_rates_bps: z
        .record(z.string(), z.number().int().min(0).max(10000))
        .default({}),
      /** NACHA file settings (company bank info is encrypted at rest). */
      nacha: z
        .object({
          immediate_destination: z.string().default(""),
          immediate_destination_name: z.string().default(""),
          immediate_origin: z.string().default(""),
          immediate_origin_name: z.string().default(""),
          company_name: z.string().default(""),
          company_id: z.string().default(""),
          odfi_routing: z.string().default(""),
          entry_description: z.string().default("PAYROLL"),
          /** Encrypted (v1:…) company funding account, shown as last 4 only. */
          company_account_enc: z.string().nullable().default(null),
          company_account_last4: z.string().nullable().default(null),
        })
        .prefault({}),
    })
    .prefault({}),
} as const;
