// Settings fragment(s) owned by module `payments` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";
import { DEFAULT_MANUAL_INSTRUCTIONS } from "./defaults";

export const settingsShape = {
  payments: z
    .object({
      methods: z
        .array(
          z.enum(["card", "ach", "cash", "check", "zelle", "venmo", "other"]),
        )
        .default(["card", "cash", "check", "zelle", "venmo"]),
      fee_policy: z
        .enum(["absorb", "cash_discount", "surcharge"])
        .default("cash_discount"),
      /** Configured fee (bps) for manual methods; card fees come from the processor. */
      fee_pct_by_method: z.record(z.string(), z.number().int()).default({}),
      surcharge_bps: z.number().int().min(0).max(300).default(0),
      tips_enabled: z.boolean().default(true),
      tip_presets_pct: z.array(z.number()).default([0, 10, 15, 20]),
      allow_keyed: z.boolean().default(false),
      require_check_photo: z.boolean().default(false),
      statement_descriptor: z.string().nullable().default(null),
      descriptor_suffix: z
        .enum(["job_number", "invoice_number"])
        .default("job_number"),
      pay_link_expires_minutes: z.number().int().default(60),
      // ---- added by B4 ----
      /** Cash price shown under `cash_discount` (bps off the card price; display only). */
      cash_discount_bps: z.number().int().min(0).max(1000).default(0),
      /** Tips are not calculated on fee lines unless on (M09). */
      tip_on_fees: z.boolean().default(false),
      /** Methods that require a reference # (check #, Zelle/Venmo confirmation). */
      reference_required: z
        .array(z.enum(["check", "zelle", "venmo", "ach", "other"]))
        .default(["check", "zelle", "venmo"]),
      /** Manual payments older than this and still unverified are flagged. */
      unverified_alert_days: z.number().int().min(1).max(30).default(3),
      /** Pay-by instructions shown on /p/ when no card processor is configured. */
      manual_instructions: z.string().default(DEFAULT_MANUAL_INSTRUCTIONS),
      /** Default due date for promised refunds (days). */
      promised_refund_days: z.number().int().min(1).max(60).default(5),
      // ---- added in QA round 2 (money fixer) ----
      /**
       * Card fee ESTIMATE (rate on the gross charge, bps) stored on a card payment until
       * the processor reports the actual fee, so commission is net of the fee from the
       * start (Stripe standard pricing: 2.9 % + 30¢).
       */
      card_fee_estimate_bps: z.number().int().min(0).max(1000).default(290),
      /** Fixed part of the card fee estimate, per charge (cents). */
      card_fee_estimate_fixed_cents: z
        .number()
        .int()
        .min(0)
        .max(500)
        .default(30),
    })
    .prefault({}),
  deposits: z
    .object({
      hold_max_days_out: z.number().int().default(5),
      round_to_cents: z.number().int().default(500),
      // ---- added by B4 ----
      /** Deposit is refundable when cancelled at least this many hours before the window. */
      refundable_until_hours: z.number().int().min(0).default(24),
      /** Restocking fee kept on cancellation after a special-order part was ordered (%). */
      restocking_pct: z.number().min(0).max(100).default(0),
      /** "Non-refundable once the special-order part is ordered" (PO date logged). */
      nonrefundable_after_po: z.boolean().default(true),
      /** Deposit due this many hours after it's requested (null = no due date). */
      due_hours: z.number().int().min(1).nullable().default(48),
    })
    .prefault({}),
} as const;
