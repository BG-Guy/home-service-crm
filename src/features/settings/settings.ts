// Settings fragment(s) owned by module `settings` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const settingsShape = {
  company: z
    .object({
      /** Weekly opening hours in the company time zone (day 0 = Sunday). */
      business_hours: z
        .array(
          z.object({
            day: z.number().int().min(0).max(6),
            open: hhmm,
            close: hhmm,
          }),
        )
        .default(
          [1, 2, 3, 4, 5].map((day) => ({
            day,
            open: "08:00",
            close: "17:00",
          })),
        ),
      /** Outside business hours counts as after-hours; weekends too when true. */
      weekends_after_hours: z.boolean().default(true),
      /** Optional after-hours/emergency premium line (price book item). */
      after_hours_premium_item_id: z.string().nullable().default(null),
      service_zips: z.array(z.string()).default([]),
      emergency_phone: z.string().nullable().default(null),
      lead_response_minutes: z.number().int().min(1).max(1440).default(15),
      license_numbers: z
        .array(
          z.object({
            state: z.string(),
            trade: z.string(),
            number: z.string(),
          }),
        )
        .default([]),
      ein: z.string().nullable().default(null),
      currency: z.literal("USD").default("USD"),
      trade_preset: z.string().default("generic"),
      setup_checklist_dismissed: z.boolean().default(false),
      setup_checklist_done: z.array(z.string()).default([]),
    })
    .prefault({}),
  branding: z
    .object({
      accent_color: z.string().nullable().default(null), // overrides --sys-blue
      logo_dark_media_id: z.string().nullable().default(null),
      app_name: z.string().nullable().default(null),
      invoice_header_style: z
        .enum(["standard", "centered", "minimal"])
        .default("standard"),
    })
    .prefault({}),
  ui: z
    .object({
      default_theme: z.enum(["system", "light", "dark"]).default("system"),
      haptics_hack: z.boolean().default(false),
    })
    .prefault({}),
  compliance: z
    .object({
      contract_templates: z.boolean().default(true),
      deposit_cap_warnings: z.boolean().default(true),
      surcharge_restrictions: z.boolean().default(true),
      /** ⚖️ States where W-2 wage deductions are blocked. */
      wage_deduction_blocked_states: z
        .array(z.string())
        .default(["CA", "NY", "MA", "IL", "WA", "OR"]),
      quiet_hours: z
        .object({ start: hhmm, end: hhmm })
        .default({ start: "08:00", end: "20:00" }),
      frequency_caps: z
        .object({
          automated_per_24h: z.number().int().min(1).default(3),
          marketing_per_7d: z.number().int().min(0).default(1),
        })
        .prefault({}),
      sms_consent_text: z
        .string()
        .default(
          "I agree to receive text messages about my request, appointments and invoices. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.",
        ),
      marketing_consent_text: z
        .string()
        .default(
          "I'd also like occasional maintenance reminders and offers by text. Reply STOP to opt out.",
        ),
    })
    .prefault({}),
  /** Taxability defaults (SPEC M21 Taxes). Rates themselves live in `tax_rates`. */
  taxes: z
    .object({
      labor_taxable: z.boolean().default(false),
      parts_taxable: z.boolean().default(true),
      fees_taxable: z.boolean().default(false),
      /** service_type id → tax_rates id (null = use the default rate). */
      by_service_type: z.record(z.string(), z.string().nullable()).default({}),
    })
    .prefault({}),
  limits: z
    .object({
      max_discount_pct: z
        .object({
          admin: z.number().default(100),
          office: z.number().default(20),
          tech: z.number().default(10),
        })
        .prefault({}),
      /** null = unlimited. */
      max_refund_cents: z
        .object({
          admin: z.number().int().nullable().default(null),
          office: z.number().int().nullable().default(0),
          tech: z.number().int().nullable().default(0),
        })
        .prefault({}),
      auto_approve_under_cents: z.number().int().min(0).default(5000),
    })
    .prefault({}),
} as const;
