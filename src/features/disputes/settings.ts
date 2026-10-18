// Settings fragment(s) owned by module `disputes` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  disputes: z
    .object({
      efw_refund_multiplier: z.number().min(0).default(1),
      dispute_fee_cents: z.number().int().default(1500),
      suggest_accept_under_cents: z.number().int().default(5000),
      suggest_accept_readiness_below: z.number().int().default(50),
      // ---- added by B4 ----
      /** Readiness item key → weight (SPEC §11.2). Empty = engine defaults. */
      readiness_weights: z.record(z.string(), z.number().min(0)).default({}),
      /** Dispute-rate warning line (card disputes ÷ card payments). */
      rate_threshold_bps: z.number().int().min(1).default(75),
    })
    .prefault({}),
  risk: z
    .object({
      /** Signal key → points (SPEC §11.1). Empty = engine defaults. */
      weights: z.record(z.string(), z.number()).default({}),
      bands: z
        .object({
          medium: z.number().int().default(25),
          high: z.number().int().default(50),
          critical: z.number().int().default(75),
        })
        .prefault({}),
      no_estimate_min_ticket_cents: z.number().int().default(25000),
      critical_control: z
        .enum(["approval", "prepay", "cash_only"])
        .default("approval"),
      // ---- added by B4 ----
      /** Enforce the band → controls table at Start/Complete (photos/signature/deposit/approval). */
      enforce_controls: z.boolean().default(true),
    })
    .prefault({}),
} as const;
