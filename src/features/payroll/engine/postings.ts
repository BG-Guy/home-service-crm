// Ledger posting rules (SPEC §10.2 "Ledger posting", chargebacks, recalls). Pure:
// the DAL loads existing entries, calls these, and inserts the returned rows.
import { applyBps } from "@/lib/money";
import type { CompPlan, JobResult, Posting, WorkerType } from "./types";

/** Ledger types owned by a job's financials (recomputed together). */
export const JOB_LEDGER_TYPES = [
  "commission",
  "spiff",
  "tip",
  "reimbursement_parts",
  "cash_held",
] as const;
export type JobLedgerType = (typeof JOB_LEDGER_TYPES)[number];

export const WAGE_CLASS_OF: Record<Posting["type"], Posting["wageClass"]> = {
  commission: "wage",
  tip: "wage",
  spiff: "wage",
  reimbursement_parts: "reimbursement",
  reimbursement_expense: "reimbursement",
  reimbursement_mileage: "reimbursement",
  cash_held: "custody",
  cash_remitted: "custody",
  chargeback_hold: "wage",
  chargeback_release: "wage",
  chargeback_clawback: "wage",
  recall_clawback: "wage",
  tool_deduction: "wage",
  tool_allowance: "wage",
  tool_deposit: "wage",
  draw: "wage",
  guarantee_topup: "wage",
  ot_topup: "wage",
  adjustment: "wage",
  payout: "n/a",
  carry_forward: "n/a",
};

/**
 * Postings for a job (§10.2): commission, spiff, tip, reimbursement_parts and cash_held.
 * - `earned` gates commission/spiff/tip/cash (earned_on rules); reimbursements of
 *   approved purchases are always owed to the purchaser.
 * - cash_held is negative for net_in_payout, informational 0 for separate remittance.
 */
export function jobPostings(
  result: JobResult,
  opts: { earned: boolean; jobNumber: string },
): Posting[] {
  const out: Posting[] = [];
  const memo = (what: string) => `${what} · ${opts.jobNumber}`;
  for (const e of result.earnings) {
    if (opts.earned) {
      if (e.commissionCents)
        out.push({
          userId: e.userId,
          type: "commission",
          amountCents: e.commissionCents,
          wageClass: "wage",
          memo: memo("Commission"),
        });
      if (e.spiffsCents)
        out.push({
          userId: e.userId,
          type: "spiff",
          amountCents: e.spiffsCents,
          wageClass: "wage",
          memo: memo("Spiff"),
        });
      if (e.tipCents)
        out.push({
          userId: e.userId,
          type: "tip",
          amountCents: e.tipCents,
          wageClass: "wage",
          memo: memo("Tip"),
        });
      if (e.cashHeldCents) {
        const netted = e.techKeepsCash && e.cashSettlement === "net_in_payout";
        out.push({
          userId: e.userId,
          type: "cash_held",
          amountCents: netted ? -e.cashHeldCents : 0,
          wageClass: "custody",
          memo: netted
            ? memo("Cash kept, deducted from pay")
            : memo(
                `Cash collected ${(e.cashHeldCents / 100).toFixed(2)}, remit separately`,
              ),
        });
      }
    }
    if (e.reimbursementCents)
      out.push({
        userId: e.userId,
        type: "reimbursement_parts",
        amountCents: e.reimbursementCents,
        wageClass: "reimbursement",
        memo: memo("Parts reimbursement"),
      });
  }
  return out;
}

export interface ExistingJobEntry {
  id: string;
  userId: string;
  type: string;
  amountCents: number;
  /** In an approved/paid/locked settlement (cannot be reversed). */
  settled: boolean;
}

export interface RecomputePlan {
  /** Unsettled entries to reverse (insert −amount with reverses_id). */
  reverse: ExistingJobEntry[];
  /** New entries to insert (type as given, or 'adjustment' after lock). */
  post: Posting[];
}

/**
 * Recompute before lock (§10.2): for each (user, type), when the current total
 * differs from the target, reverse the unsettled entries and post target − settled.
 * Idempotent: unchanged keys produce nothing. After lock (`locked`), the whole
 * difference per user becomes one `adjustment` in the open period. The delta is
 * target − (job entries + adjustments already posted for this job), so a second
 * trigger for the same change (invoice.paid + payment.succeeded, refund.created +
 * refund.succeeded) posts nothing (QA T6-02).
 */
export function planRecompute(
  existing: readonly ExistingJobEntry[],
  target: readonly Posting[],
  opts: {
    locked: boolean;
    memo: string;
    /** Σ `adjustment` entries already posted for this job after lock, by user. */
    postedAdjustments?: ReadonlyMap<string, number>;
  },
): RecomputePlan {
  const key = (u: string, t: string) => `${u}|${t}`;
  const cur = new Map<
    string,
    { settled: number; unsettled: ExistingJobEntry[] }
  >();
  for (const e of existing) {
    const k = key(e.userId, e.type);
    const v = cur.get(k) ?? { settled: 0, unsettled: [] };
    if (e.settled) v.settled += e.amountCents;
    else v.unsettled.push(e);
    cur.set(k, v);
  }
  const tgt = new Map<string, Posting>();
  for (const p of target) {
    const k = key(p.userId, p.type);
    const prev = tgt.get(k);
    tgt.set(
      k,
      prev
        ? { ...prev, amountCents: prev.amountCents + p.amountCents }
        : { ...p },
    );
  }

  if (opts.locked) {
    const deltaByUser = new Map<string, number>();
    const total = (m: Map<string, number>, u: string, v: number) =>
      m.set(u, (m.get(u) ?? 0) + v);
    for (const e of existing) total(deltaByUser, e.userId, -e.amountCents);
    for (const [u, v] of opts.postedAdjustments ?? [])
      total(deltaByUser, u, -v);
    for (const p of target) total(deltaByUser, p.userId, p.amountCents);
    const post: Posting[] = [];
    for (const [userId, delta] of deltaByUser)
      if (delta !== 0)
        post.push({
          userId,
          type: "adjustment",
          amountCents: delta,
          wageClass: "wage",
          memo: opts.memo,
        });
    return { reverse: [], post };
  }

  const reverse: ExistingJobEntry[] = [];
  const post: Posting[] = [];
  const keys = new Set([...cur.keys(), ...tgt.keys()]);
  for (const k of keys) {
    const c = cur.get(k) ?? { settled: 0, unsettled: [] };
    const t = tgt.get(k);
    const hasAny = c.settled !== 0 || c.unsettled.length > 0;
    const currentTotal =
      c.settled + c.unsettled.reduce((a, e) => a + e.amountCents, 0);
    const targetTotal = t?.amountCents ?? 0;
    if (currentTotal === targetTotal) {
      // Unchanged. An informational zero line (separate-remittance cash) is posted once.
      if (t && targetTotal === 0 && !hasAny) post.push({ ...t });
      continue;
    }
    reverse.push(...c.unsettled);
    const need = targetTotal - c.settled;
    if (need === 0) continue;
    if (t) post.push({ ...t, amountCents: need });
    else {
      const [userId, type] = k.split("|") as [string, Posting["type"]];
      post.push({
        userId,
        type,
        amountCents: need,
        wageClass: WAGE_CLASS_OF[type],
        memo: opts.memo,
      });
    }
  }
  return { reverse, post };
}

// ------------------------------------------------------------------ chargebacks

export interface ChargebackEarning {
  userId: string;
  commissionCents: number;
  spiffsCents: number;
  workerType: WorkerType;
}

export interface ChargebackExisting {
  userId: string;
  type: "chargeback_hold" | "chargeback_release" | "chargeback_clawback";
  amountCents: number;
}

/**
 * Chargeback postings (§10.2): open+hold → −(commission+spiffs); won → release the
 * hold; lost → release (if held) + clawback per plan. W-2 deductions are needs_review.
 * Idempotent against `existing` entries for the same dispute.
 */
export function chargebackPostings(
  plan: CompPlan,
  phase: "open" | "won" | "lost",
  earnings: readonly ChargebackEarning[],
  existing: readonly ChargebackExisting[],
  memo: string,
): Posting[] {
  const out: Posting[] = [];
  const sum = (u: string, t: ChargebackExisting["type"]) =>
    existing
      .filter((e) => e.userId === u && e.type === t)
      .reduce((a, e) => a + e.amountCents, 0);
  for (const e of earnings) {
    const at = e.commissionCents + e.spiffsCents;
    if (at <= 0) continue;
    const w2 = e.workerType === "w2";
    const held = -sum(e.userId, "chargeback_hold");
    const released = sum(e.userId, "chargeback_release");
    const clawed = -sum(e.userId, "chargeback_clawback");
    if (phase === "open") {
      if (plan.chargebacks.on_open === "hold" && held === 0)
        out.push({
          userId: e.userId,
          type: "chargeback_hold",
          amountCents: -at,
          wageClass: "wage",
          needsReview: w2,
          memo: `Chargeback hold · ${memo}`,
        });
      continue;
    }
    const outstanding = held - released;
    if (outstanding > 0)
      out.push({
        userId: e.userId,
        type: "chargeback_release",
        amountCents: outstanding,
        wageClass: "wage",
        needsReview: w2,
        memo: `Chargeback hold released · ${memo}`,
      });
    if (phase === "lost" && clawed === 0) {
      const amt =
        plan.chargebacks.on_lost === "clawback_100"
          ? at
          : plan.chargebacks.on_lost === "clawback_pct"
            ? applyBps(at, plan.chargebacks.clawback_bps ?? 0)
            : 0;
      if (amt > 0)
        out.push({
          userId: e.userId,
          type: "chargeback_clawback",
          amountCents: -amt,
          wageClass: "wage",
          needsReview: w2,
          memo: `Chargeback lost · ${memo}`,
        });
    }
  }
  return out;
}

/** Recall clawback (§10.2 step 5, policy clawback_pct) against the ORIGINAL job's techs. */
export function recallClawbackPostings(
  plan: CompPlan,
  original: readonly ChargebackEarning[],
  memo: string,
): Posting[] {
  if (plan.recalls.policy !== "clawback_pct") return [];
  return original
    .map((e): Posting | null => {
      const amt = applyBps(e.commissionCents, plan.recalls.clawback_bps ?? 0);
      if (amt <= 0) return null;
      return {
        userId: e.userId,
        type: "recall_clawback",
        amountCents: -amt,
        wageClass: "wage",
        needsReview: e.workerType === "w2",
        memo: `Recall clawback · ${memo}`,
      };
    })
    .filter((p): p is Posting => p !== null);
}
