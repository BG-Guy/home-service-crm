// Commission engine types (SPEC §10.1–§10.2). Pure, isomorphic, no zod: the
// live example calculator in /settings/commission imports the engine on the client.

export type PaymentMethod =
  | "card"
  | "ach"
  | "cash"
  | "check"
  | "zelle"
  | "venmo"
  | "other";

export type WorkerType = "w2" | "1099";
export type CashSettlement = "net_in_payout" | "separate_remittance";
export type CommissionBasis =
  | "revenue"
  | "net_after_deductions"
  | "gross_profit"
  | "flat_per_job"
  | "hourly"
  | "hourly_plus_commission";

export interface SpiffRule {
  match: {
    service_type_id?: string;
    pricebook_item_id?: string;
    kind?: "review_bonus";
  };
  amount: { flat_cents?: number; pct_bps?: number };
  credit: "sold_by" | "worked_by";
  label?: string;
}

export interface TierRule {
  period_revenue_gte_cents: number;
  rate_bps: number;
  mode: "marginal" | "retro";
}

/** CompPlan (SPEC §10.1), stored in comp_plans.config. Every key resolved (defaults applied). */
export interface CompPlan {
  basis: CommissionBasis;
  rate_bps: number;
  flat_per_job_cents?: number;
  hourly_cents?: number;
  tiers?: TierRule[];
  overrides: { by_service_type?: Record<string, number> };
  deductions_before_split: {
    company_parts: boolean;
    tech_parts: boolean;
    processing_fees:
      | "none"
      | "actual"
      | { pct_bps_by_method: Partial<Record<PaymentMethod, number>> };
    lead_cost: boolean;
    subcontract_cost: boolean;
  };
  fee_methods: PaymentMethod[];
  tips: { pct_to_tech_bps: number; deduct_card_fee_on_tip: boolean };
  tech_parts_reimburse_bps: number;
  cash: {
    tech_keeps_cash: boolean;
    settlement: CashSettlement;
    max_cash_held_cents: number;
    remit_within_days: number;
    methods: ("cash" | "check")[];
  };
  deposits: {
    counts_toward_revenue: boolean;
    forfeited_deposit_commission_bps: number;
  };
  recalls: {
    window_days: number;
    policy: "none" | "no_commission_on_recall" | "clawback_pct";
    clawback_bps?: number;
  };
  chargebacks: {
    window_days: number;
    on_open: "none" | "hold";
    on_lost: "none" | "clawback_100" | "clawback_pct";
    clawback_bps?: number;
    dispute_fee_to_tech: boolean;
  };
  spiffs: SpiffRule[];
  splits: { default: "primary_100" | "even" };
  earned_on: "job_done" | "paid_in_full";
  guarantee?: { daily_min_cents: number; recoverable_draw: boolean };
  negative_balance: "carry_forward" | "request_remittance";
  max_deduction_per_period_bps?: number;
  w2_floor_check: boolean;
  min_wage_cents_per_hour: number;
}

/** tech_comp.overrides (SPEC §6.10). */
export interface TechOverrides {
  rate_bps?: number;
  by_service_type?: Record<string, number>;
  tech_keeps_cash?: boolean;
  cash_settlement?: CashSettlement;
}

export interface PaymentInput {
  id: string;
  method: PaymentMethod;
  /** Amount charged, excluding tip, BEFORE refunds (refunds go in refundedCents). */
  amountCents: number;
  /** Tip charged, before refunds. */
  tipCents: number;
  /**
   * Σ succeeded refunds on this payment (excluding `dispute_lost`, which the
   * chargeback rules handle). A refund comes off the amount first and off the tip
   * only beyond it (lead decision, QA T6-07). Default 0.
   */
  refundedCents?: number;
  /** Processor fee on amount + tip ('actual' fee mode). */
  feeCents: number;
  collectedByUserId: string | null;
  kind?: "deposit" | "payment" | "tip_only";
}

export interface AssigneeInput {
  userId: string;
  splitBps: number;
  role: "primary" | "helper";
}

/** Inputs gathered by loadJobFinancialInputs(jobId) (SPEC §10.2). */
export interface JobFinancialInputs {
  jobId: string;
  /** Σ non-tax line totals minus discount lines (service fees included). */
  revenueCents: number;
  taxCents: number;
  serviceTypeId: string | null;
  serviceTypeName?: string | null;
  customRateBps: number | null;
  isCallback: boolean;
  /** The callback falls inside plan.recalls.window_days of the original job. */
  recallInWindow?: boolean;
  payments: PaymentInput[];
  /** Σ qty × unit_cost for part/material lines with company_stock|company_po (and company_card). */
  companyPartsCents: number;
  /** Approved tech-paid purchases on the job, by purchaser. */
  techPartsByUser: Record<string, number>;
  /** Tech-paid purchases still pending (trace flag; recompute on approval). */
  pendingTechPartsCents?: number;
  leadCostCents?: number;
  subcontractCostCents?: number;
  /** Labor cost recorded on lines (gross_profit basis). */
  laborCostCents?: number;
  /** Line totals by price book item (spiff matching). */
  pricebookTotals?: Record<string, number>;
  /** Techs with a logged review for this job (review_bonus spiffs). */
  reviewBonusUserIds?: string[];
  /** Who sold the work (estimate creator); defaults to the primary assignee. */
  soldByUserId?: string | null;
  /** Ordered: primary first; the LAST absorbs rounding remainders. */
  assignees: AssigneeInput[];
  /**
   * Invoice total incl. tax (what the payments pay). With refunds or credit notes the
   * commission base is scaled by the share of the invoice actually kept (partial
   * refunds, QA T6-07). Omitted/0 = no scaling.
   */
  invoiceTotalCents?: number;
  /** Σ credit notes on the invoice. */
  creditedCents?: number;
}

export interface TechInput {
  userId: string;
  name?: string;
  workerType: WorkerType;
  overrides: TechOverrides;
  /** Role default rate from settings (payroll.role_rates_bps[role]). */
  roleRateBps?: number | null;
}

export type RateSource =
  | "job"
  | "tech_service"
  | "tech"
  | "service"
  | "role"
  | "plan";

export type TraceKey =
  | "revenue"
  | "company_parts"
  | "tech_parts"
  | "fees"
  | "lead_cost"
  | "subcontract"
  | "labor_cost"
  | "refunds"
  | "base"
  | "rate"
  | "split"
  | "commission"
  | "spiffs"
  | "tip"
  | "reimbursement"
  | "cash_held"
  | "net"
  | "tips_total"
  | "fees_total"
  | "commissions_total"
  | "reimbursements_total"
  | "company_net"
  | "note";

export type TraceStep = {
  step: TraceKey | string;
  label: string;
  amount_cents: number;
  running_cents: number;
};

export interface TechEarning {
  userId: string;
  splitBps: number;
  rateBps: number;
  rateSource: RateSource;
  commissionCents: number;
  spiffsCents: number;
  tipCents: number;
  reimbursementCents: number;
  /** Cash collected by this tech in plan.cash.methods (always shown on the stub). */
  cashHeldCents: number;
  /** Effective cash handling for this tech. */
  techKeepsCash: boolean;
  cashSettlement: CashSettlement;
  netCents: number;
  trace: TraceStep[];
}

export interface JobResult {
  jobId: string;
  revenueCents: number;
  taxCents: number;
  tipCents: number;
  companyPartsCents: number;
  techPartsCents: number;
  feesCents: number;
  feesOnTipsCents: number;
  otherDeductionsCents: number;
  baseCents: number;
  /**
   * Invoice amount given back to the customer (refunds beyond any overpayment, or
   * credit notes, whichever is larger). The base is scaled by (total − this) / total.
   */
  refundedCents: number;
  commissionTotalCents: number;
  companyNetCents: number;
  earnings: TechEarning[];
  trace: TraceStep[];
  flags: { pendingReimbursements: boolean; recall: boolean };
}

/** Ledger posting produced by the engine (persisted by the DAL). */
export interface Posting {
  userId: string;
  type:
    | "commission"
    | "tip"
    | "spiff"
    | "reimbursement_parts"
    | "reimbursement_expense"
    | "reimbursement_mileage"
    | "cash_held"
    | "cash_remitted"
    | "chargeback_hold"
    | "chargeback_release"
    | "chargeback_clawback"
    | "recall_clawback"
    | "tool_deduction"
    | "tool_allowance"
    | "tool_deposit"
    | "draw"
    | "guarantee_topup"
    | "ot_topup"
    | "adjustment"
    | "payout"
    | "carry_forward";
  amountCents: number;
  wageClass: "wage" | "reimbursement" | "custody" | "n/a";
  needsReview?: boolean;
  memo: string;
}
