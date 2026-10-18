// CompPlanSchema (SPEC §10.1): zod validation for comp_plans.config. Used by the
// /settings/commission form + Advanced JSON editor (server side). Missing keys take
// the partner_25 defaults (engine/plan.ts DEFAULT_PLAN).
import { z } from "zod";
import { DEFAULT_PLAN } from "./engine/plan";
import type { CompPlan } from "./engine/types";

const bps = z.number().int().min(0).max(10000);
const cents = z.number().int().min(0);
const method = z.enum([
  "card",
  "ach",
  "cash",
  "check",
  "zelle",
  "venmo",
  "other",
]);
const D = DEFAULT_PLAN;

export const CompPlanSchema = z
  .object({
    basis: z
      .enum([
        "revenue",
        "net_after_deductions",
        "gross_profit",
        "flat_per_job",
        "hourly",
        "hourly_plus_commission",
      ])
      .default(D.basis),
    rate_bps: bps.default(D.rate_bps),
    flat_per_job_cents: cents.optional(),
    hourly_cents: cents.optional(),
    tiers: z
      .array(
        z.object({
          period_revenue_gte_cents: cents,
          rate_bps: bps,
          mode: z.enum(["marginal", "retro"]),
        }),
      )
      .max(10)
      .optional(),
    overrides: z
      .object({ by_service_type: z.record(z.string(), bps).optional() })
      .default({ by_service_type: {} }),
    deductions_before_split: z
      .object({
        company_parts: z.boolean().default(true),
        tech_parts: z.boolean().default(true),
        processing_fees: z
          .union([
            z.enum(["none", "actual"]),
            z.object({ pct_bps_by_method: z.partialRecord(method, bps) }),
          ])
          .default("actual"),
        lead_cost: z.boolean().default(false),
        subcontract_cost: z.boolean().default(false),
      })
      .prefault({}),
    fee_methods: z.array(method).default(D.fee_methods),
    tips: z
      .object({
        pct_to_tech_bps: bps.default(10000),
        deduct_card_fee_on_tip: z.boolean().default(false),
      })
      .prefault({}),
    tech_parts_reimburse_bps: bps.default(10000),
    cash: z
      .object({
        tech_keeps_cash: z.boolean().default(true),
        settlement: z
          .enum(["net_in_payout", "separate_remittance"])
          .default("net_in_payout"),
        max_cash_held_cents: cents.default(150000),
        remit_within_days: z.number().int().min(0).max(60).default(3),
        methods: z.array(z.enum(["cash", "check"])).default(["cash"]),
      })
      .prefault({}),
    deposits: z
      .object({
        counts_toward_revenue: z.boolean().default(true),
        forfeited_deposit_commission_bps: bps.default(0),
      })
      .prefault({}),
    recalls: z
      .object({
        window_days: z.number().int().min(0).max(365).default(30),
        policy: z
          .enum(["none", "no_commission_on_recall", "clawback_pct"])
          .default("no_commission_on_recall"),
        clawback_bps: bps.optional(),
      })
      .prefault({}),
    chargebacks: z
      .object({
        window_days: z.number().int().min(0).max(540).default(120),
        on_open: z.enum(["none", "hold"]).default("hold"),
        on_lost: z
          .enum(["none", "clawback_100", "clawback_pct"])
          .default("clawback_100"),
        clawback_bps: bps.optional(),
        dispute_fee_to_tech: z.boolean().default(false),
      })
      .prefault({}),
    spiffs: z
      .array(
        z.object({
          match: z.object({
            service_type_id: z.string().optional(),
            pricebook_item_id: z.string().optional(),
            kind: z.literal("review_bonus").optional(),
          }),
          amount: z.object({
            flat_cents: cents.optional(),
            pct_bps: bps.optional(),
          }),
          credit: z.enum(["sold_by", "worked_by"]),
          label: z.string().max(80).optional(),
        }),
      )
      .max(50)
      .default([]),
    splits: z
      .object({
        default: z.enum(["primary_100", "even"]).default("primary_100"),
      })
      .prefault({}),
    earned_on: z.enum(["job_done", "paid_in_full"]).default("paid_in_full"),
    guarantee: z
      .object({ daily_min_cents: cents, recoverable_draw: z.boolean() })
      .optional(),
    negative_balance: z
      .enum(["carry_forward", "request_remittance"])
      .default("carry_forward"),
    max_deduction_per_period_bps: bps.optional(),
    w2_floor_check: z.boolean().default(false),
    min_wage_cents_per_hour: cents.default(725),
  })
  .superRefine((p, ctx) => {
    if (p.basis === "flat_per_job" && p.flat_per_job_cents == null)
      ctx.addIssue({
        code: "custom",
        path: ["flat_per_job_cents"],
        message: "Enter the flat amount per job.",
      });
    if (
      (p.basis === "hourly" || p.basis === "hourly_plus_commission") &&
      p.hourly_cents == null
    )
      ctx.addIssue({
        code: "custom",
        path: ["hourly_cents"],
        message: "Enter the hourly rate.",
      });
    if (p.recalls.policy === "clawback_pct" && p.recalls.clawback_bps == null)
      ctx.addIssue({
        code: "custom",
        path: ["recalls", "clawback_bps"],
        message: "Enter the recall clawback %.",
      });
    if (
      p.chargebacks.on_lost === "clawback_pct" &&
      p.chargebacks.clawback_bps == null
    )
      ctx.addIssue({
        code: "custom",
        path: ["chargebacks", "clawback_bps"],
        message: "Enter the chargeback clawback %.",
      });
  });

export function parsePlanConfig(config: unknown): CompPlan {
  const plan = CompPlanSchema.parse(config ?? {}) as CompPlan;
  if (!plan.cash.tech_keeps_cash) plan.cash.settlement = "separate_remittance";
  return plan;
}
