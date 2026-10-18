// Settlement math (SPEC §10.3). Pure: the DAL selects the period's ledger entries.
import { applyBps, divRoundHalfAway, roundHalfAway } from "@/lib/money";
import type { Posting, TierRule } from "./types";

export interface SettlementEntry {
  id?: string;
  type: Posting["type"] | string;
  amountCents: number;
  wageClass: Posting["wageClass"] | string;
  /** needs_review entries still awaiting an admin decision are excluded. */
  pendingReview?: boolean;
  jobId?: string | null;
  effectiveDate?: string;
}

export interface SettlementTotals {
  byType: Record<string, number>;
  /** wage_class 'wage' (commission, spiffs, tips, top-ups, adjustments, deductions). */
  wagesCents: number;
  /** Gross positive earnings (commission + spiff + tip + top-ups + positive adjustments). */
  grossEarningsCents: number;
  reimbursementsCents: number;
  custodyCents: number;
  otherCents: number;
  periodNetCents: number;
  pendingReviewCents: number;
  pendingReviewCount: number;
}

const DEDUCTION_TYPES = new Set([
  "chargeback_hold",
  "chargeback_clawback",
  "recall_clawback",
  "tool_deduction",
  "tool_deposit",
  "draw",
]);
const GROSS_TYPES = new Set([
  "commission",
  "spiff",
  "tip",
  "guarantee_topup",
  "ot_topup",
  "tool_allowance",
  "chargeback_release",
]);

/** Σ by type and by wage class; period_net excludes payouts and pending reviews (§10.3). */
export function summarizeEntries(
  entries: readonly SettlementEntry[],
): SettlementTotals {
  const byType: Record<string, number> = {};
  let wages = 0;
  let gross = 0;
  let reimb = 0;
  let custody = 0;
  let other = 0;
  let pending = 0;
  let pendingCount = 0;
  for (const e of entries) {
    if (e.type === "payout") continue;
    if (e.pendingReview) {
      pending += e.amountCents;
      pendingCount++;
      continue;
    }
    byType[e.type] = (byType[e.type] ?? 0) + e.amountCents;
    if (e.wageClass === "wage") wages += e.amountCents;
    else if (e.wageClass === "reimbursement") reimb += e.amountCents;
    else if (e.wageClass === "custody") custody += e.amountCents;
    else other += e.amountCents;
    if (
      GROSS_TYPES.has(e.type) ||
      (e.type === "adjustment" && e.amountCents > 0)
    )
      gross += e.amountCents;
  }
  return {
    byType,
    wagesCents: wages,
    grossEarningsCents: gross,
    reimbursementsCents: reimb,
    custodyCents: custody,
    otherCents: other,
    periodNetCents: wages + reimb + custody + other,
    pendingReviewCents: pending,
    pendingReviewCount: pendingCount,
  };
}

/** Σ deductions (positive number) among the entries (cap base). */
export function deductionsOf(entries: readonly SettlementEntry[]): number {
  let d = 0;
  for (const e of entries) {
    if (e.pendingReview || e.type === "payout") continue;
    if (DEDUCTION_TYPES.has(e.type) && e.amountCents < 0) d += -e.amountCents;
    else if (e.type === "adjustment" && e.amountCents < 0) d += -e.amountCents;
  }
  return d;
}

/**
 * Deduction cap ⚖️ (§10.3): deductions beyond cap × gross earnings are deferred to
 * the next period as `carry_forward` (+deferred now, −deferred next period).
 */
export function deductionCap(
  grossEarningsCents: number,
  deductionsCents: number,
  capBps: number | null | undefined,
): { allowedCents: number; deferredCents: number } {
  if (capBps == null)
    return { allowedCents: deductionsCents, deferredCents: 0 };
  const cap = Math.max(0, applyBps(Math.max(0, grossEarningsCents), capBps));
  const deferred = Math.max(0, deductionsCents - cap);
  return { allowedCents: deductionsCents - deferred, deferredCents: deferred };
}

/**
 * W-2 floor check (§10.3), weekly: if wages < hours × min wage, top up; then the
 * regular rate is (wages + topup) / hours and OT = round(0.5 × rate × hours over 40).
 * Hours are passed in minutes to stay exact.
 */
export function floorCheck(i: {
  wagesCents: number;
  minutesWorked: number;
  minWageCentsPerHour: number;
  otThresholdMinutes?: number;
}): {
  guaranteeTopupCents: number;
  otTopupCents: number;
  regularRateCentsPerHour: number;
} {
  const minutes = Math.max(0, Math.round(i.minutesWorked));
  if (minutes === 0)
    return {
      guaranteeTopupCents: 0,
      otTopupCents: 0,
      regularRateCentsPerHour: 0,
    };
  const floor = divRoundHalfAway(minutes * i.minWageCentsPerHour, 60);
  const topup = Math.max(0, floor - Math.max(0, i.wagesCents));
  const total = Math.max(0, i.wagesCents) + topup;
  const otMinutes = Math.max(0, minutes - (i.otThresholdMinutes ?? 40 * 60));
  // ot = 0.5 × (total / hours) × otHours = total × otMinutes / (2 × minutes)
  const ot =
    otMinutes > 0 ? divRoundHalfAway(total * otMinutes, 2 * minutes) : 0;
  return {
    guaranteeTopupCents: topup,
    otTopupCents: ot,
    regularRateCentsPerHour: divRoundHalfAway(total * 60, minutes),
  };
}

export interface TierJob {
  /** Split-weighted revenue and base of one earned job in the period. */
  revenueCents: number;
  baseCents: number;
  appliedRateBps: number;
}

/**
 * Tier adjustment (§10.3). `retro`: once period revenue reaches a tier, the tier rate
 * applies to every job's base. `marginal`: only the share of base above the threshold.
 */
export function tierAdjustment(
  jobs: readonly TierJob[],
  tiers: readonly TierRule[] | undefined,
): number {
  if (!tiers?.length || jobs.length === 0) return 0;
  const revenue = jobs.reduce((a, j) => a + j.revenueCents, 0);
  const reached = [...tiers]
    .filter((t) => revenue >= t.period_revenue_gte_cents)
    .sort((a, b) => b.period_revenue_gte_cents - a.period_revenue_gte_cents)[0];
  if (!reached) return 0;
  let adj = 0;
  if (reached.mode === "retro") {
    for (const j of jobs)
      adj += roundHalfAway(
        (j.baseCents * (reached.rate_bps - j.appliedRateBps)) / 10000,
      );
    return adj;
  }
  const aboveShare =
    revenue > 0 ? (revenue - reached.period_revenue_gte_cents) / revenue : 0;
  for (const j of jobs)
    adj += roundHalfAway(
      (j.baseCents * aboveShare * (reached.rate_bps - j.appliedRateBps)) /
        10000,
    );
  return adj;
}

/**
 * Opening balance (§10.3): the previous closing minus what was paid out. A negative
 * balance carries forward; any unpaid positive remainder carries too.
 */
export function openingBalance(
  prev: { closingCents: number; paidCents: number } | null,
): number {
  if (!prev) return 0;
  return prev.closingCents - prev.paidCents;
}

export function closeOut(
  openingCents: number,
  periodNetCents: number,
): { closingCents: number; payableCents: number } {
  const closing = openingCents + periodNetCents;
  return { closingCents: closing, payableCents: Math.max(0, closing) };
}
