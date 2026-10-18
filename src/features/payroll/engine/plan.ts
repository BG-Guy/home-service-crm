// Plan defaults and resolution (SPEC §10.1). Pure; zod validation lives in plan-schema.ts.
import type {
  CashSettlement,
  CompPlan,
  PaymentMethod,
  TechOverrides,
  WorkerType,
} from "./types";

/** "Partner 25% after parts & card fee" (owner's model; the seeded partner_25 v1). */
export const DEFAULT_PLAN: CompPlan = {
  basis: "net_after_deductions",
  rate_bps: 2500,
  overrides: { by_service_type: {} },
  deductions_before_split: {
    company_parts: true,
    tech_parts: true,
    processing_fees: "actual",
    lead_cost: false,
    subcontract_cost: false,
  },
  fee_methods: ["card", "ach", "venmo"],
  tips: { pct_to_tech_bps: 10000, deduct_card_fee_on_tip: false },
  tech_parts_reimburse_bps: 10000,
  cash: {
    tech_keeps_cash: true,
    settlement: "net_in_payout",
    max_cash_held_cents: 150000,
    remit_within_days: 3,
    methods: ["cash"],
  },
  deposits: {
    counts_toward_revenue: true,
    forfeited_deposit_commission_bps: 0,
  },
  recalls: { window_days: 30, policy: "no_commission_on_recall" },
  chargebacks: {
    window_days: 120,
    on_open: "hold",
    on_lost: "clawback_100",
    dispute_fee_to_tech: false,
  },
  spiffs: [],
  splits: { default: "primary_100" },
  earned_on: "paid_in_full",
  negative_balance: "carry_forward",
  w2_floor_check: false,
  min_wage_cents_per_hour: 725,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);

function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch ?? base) as T;
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const b = (base as Obj)[k];
    out[k] = isObj(b) && isObj(v) ? merge(b, v) : v;
  }
  return out as T;
}

/** Fill missing keys of a stored config with DEFAULT_PLAN (lenient; validation is plan-schema.ts). */
export function resolvePlan(config: unknown): CompPlan {
  const plan = merge(DEFAULT_PLAN, isObj(config) ? config : {});
  // tech_keeps_cash=false forces separate remittance (SPEC §10.1 note).
  if (!plan.cash.tech_keeps_cash)
    plan.cash = { ...plan.cash, settlement: "separate_remittance" };
  return plan;
}

/** Effective cash handling for one tech (§10.2 step 11). W-2 is always separate_remittance. */
export function effectiveCash(
  plan: CompPlan,
  workerType: WorkerType,
  overrides: TechOverrides,
): { techKeepsCash: boolean; settlement: CashSettlement } {
  const keeps = overrides.tech_keeps_cash ?? plan.cash.tech_keeps_cash;
  let settlement: CashSettlement =
    overrides.cash_settlement ?? plan.cash.settlement;
  if (!keeps || workerType === "w2") settlement = "separate_remittance";
  return { techKeepsCash: keeps, settlement };
}

/** W-2 compliance knock-ons (M16 "worker type switch"): floor check on, fee-on-tip off. */
export function planForWorker(
  plan: CompPlan,
  workerType: WorkerType,
): CompPlan {
  if (workerType !== "w2") return plan;
  return {
    ...plan,
    w2_floor_check: true,
    tips: { ...plan.tips, deduct_card_fee_on_tip: false },
  };
}

/** Processing fee per method in bps for configured fee mode (null = actual/none). */
export function configuredFeeBps(
  plan: CompPlan,
  method: PaymentMethod,
): number | null {
  const pf = plan.deductions_before_split.processing_fees;
  if (typeof pf === "object") return pf.pct_bps_by_method[method] ?? 0;
  return null;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card",
  ach: "ACH",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  other: "Other",
};
