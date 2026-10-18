// computeJob (SPEC §10.2): pure, integer cents + bps, roundHalfAway per line.
// Every step appends {step, label, amount_cents, running_cents} to a trace so the
// tech can see "Why is my commission $80.75?" (§10.5).
import {
  applyBps,
  divRoundHalfAway,
  formatBps,
  roundHalfAway,
} from "@/lib/money";
import { configuredFeeBps, effectiveCash } from "./plan";
import type {
  AssigneeInput,
  CompPlan,
  JobFinancialInputs,
  JobResult,
  PaymentInput,
  RateSource,
  TechEarning,
  TechInput,
  TraceStep,
} from "./types";

export interface FeeBreakdown {
  /** Fees attributable to revenue (deducted from the base when enabled). */
  feesOnBaseCents: number;
  /** Fees attributable to tips (company absorbs unless deduct_card_fee_on_tip). */
  feesOnTipsCents: number;
  /** All processing fees the company actually pays (company net). */
  feesTotalCents: number;
}

/** §10.2 fees: 'actual' splits each payment's fee pro rata; configured uses bps per method. */
export function computeFees(
  payments: readonly PaymentInput[],
  plan: CompPlan,
): FeeBreakdown {
  const mode = plan.deductions_before_split.processing_fees;
  let onBase = 0;
  let onTip = 0;
  let total = 0;
  for (const p of payments) {
    const counted = plan.fee_methods.includes(p.method);
    if (typeof mode === "object") {
      const bps = counted ? (configuredFeeBps(plan, p.method) ?? 0) : 0;
      const b = applyBps(p.amountCents, bps);
      const t = applyBps(p.tipCents, bps);
      onBase += b;
      onTip += t;
      total += b + t;
      continue;
    }
    total += p.feeCents;
    if (!counted || p.feeCents === 0) continue;
    const gross = p.amountCents + p.tipCents;
    const b =
      gross > 0 ? divRoundHalfAway(p.feeCents * p.amountCents, gross) : 0;
    onBase += b;
    onTip += p.feeCents - b;
  }
  if (mode === "none")
    return {
      feesOnBaseCents: 0,
      feesOnTipsCents: onTip,
      feesTotalCents: total,
    };
  return {
    feesOnBaseCents: onBase,
    feesOnTipsCents: onTip,
    feesTotalCents: total,
  };
}

/**
 * A payment net of its refunds: a refund comes off the amount first and off the tip
 * only beyond it, so a partial refund keeps the tech's tip (lead decision, QA T6-07).
 */
export function netOfRefunds(p: PaymentInput): {
  amountCents: number;
  tipCents: number;
} {
  const refunded = Math.max(0, p.refundedCents ?? 0);
  const fromAmount = Math.min(refunded, p.amountCents);
  const fromTip = Math.min(p.tipCents, refunded - fromAmount);
  return {
    amountCents: p.amountCents - fromAmount,
    tipCents: p.tipCents - fromTip,
  };
}

/**
 * How much of the invoice total went back to the customer: refunds beyond any
 * overpayment, or credit notes, whichever is larger (a refund mirrored by a credit
 * note counts once). The commission base is scaled by (total − this) / total, so a
 * partial refund adjusts commission proportionally instead of reversing it (T6-07).
 */
export function invoiceReduction(
  fin: Pick<
    JobFinancialInputs,
    "payments" | "invoiceTotalCents" | "creditedCents"
  >,
): number {
  const total = fin.invoiceTotalCents ?? 0;
  if (total <= 0) return 0;
  let gross = 0;
  let net = 0;
  for (const p of fin.payments) {
    gross += p.amountCents;
    net += netOfRefunds(p).amountCents;
  }
  const refundImpact = Math.max(0, Math.min(gross, total) - net);
  return Math.min(total, Math.max(fin.creditedCents ?? 0, refundImpact));
}

/** Normalize assignment splits so they sum to 10000 (plan default when they don't). */
export function normalizeSplits(
  assignees: readonly AssigneeInput[],
  plan: CompPlan,
): AssigneeInput[] {
  if (assignees.length === 0) return [];
  if (assignees.length === 1)
    return [{ ...(assignees[0] as AssigneeInput), splitBps: 10000 }];
  const sum = assignees.reduce((a, x) => a + x.splitBps, 0);
  if (sum === 10000) return assignees.map((a) => ({ ...a }));
  if (plan.splits.default === "even") {
    const each = Math.floor(10000 / assignees.length);
    return assignees.map((a, i) => ({
      ...a,
      splitBps:
        i === assignees.length - 1
          ? 10000 - each * (assignees.length - 1)
          : each,
    }));
  }
  const primaryIdx = Math.max(
    0,
    assignees.findIndex((a) => a.role === "primary"),
  );
  return assignees.map((a, i) => ({
    ...a,
    splitBps: i === primaryIdx ? 10000 : 0,
  }));
}

/**
 * Split `total` by bps: every assignee but the last gets round(total × bps / 10000);
 * the LAST absorbs the remainder so shares always sum to `total` (§10.4 case E).
 */
export function splitByBps(total: number, bps: readonly number[]): number[] {
  if (bps.length === 0) return [];
  const out = bps.map((b) => applyBps(total, b));
  const others = out.slice(0, -1).reduce((a, b) => a + b, 0);
  out[out.length - 1] = total - others;
  return out;
}

/** §10.2 step 4: job custom → tech × service → tech → plan service → role → plan base. */
export function resolveRate(
  plan: CompPlan,
  tech: TechInput,
  fin: Pick<JobFinancialInputs, "customRateBps" | "serviceTypeId">,
): { rateBps: number; source: RateSource } {
  if (fin.customRateBps != null)
    return { rateBps: fin.customRateBps, source: "job" };
  const svc = fin.serviceTypeId;
  const techSvc = svc ? tech.overrides.by_service_type?.[svc] : undefined;
  if (techSvc != null) return { rateBps: techSvc, source: "tech_service" };
  if (tech.overrides.rate_bps != null)
    return { rateBps: tech.overrides.rate_bps, source: "tech" };
  const planSvc = svc ? plan.overrides.by_service_type?.[svc] : undefined;
  if (planSvc != null) return { rateBps: planSvc, source: "service" };
  if (tech.roleRateBps != null)
    return { rateBps: tech.roleRateBps, source: "role" };
  return { rateBps: plan.rate_bps, source: "plan" };
}

const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  job: "job rate",
  tech_service: "your rate for this service",
  tech: "your personal rate",
  service: "service rate",
  role: "role rate",
  plan: "plan rate",
};

function step(
  trace: TraceStep[],
  key: string,
  label: string,
  amount: number,
  running: number,
): number {
  trace.push({
    step: key,
    label,
    amount_cents: amount,
    running_cents: running,
  });
  return running;
}

export interface ComputeOptions {
  /** e.g. "Partner 25 v1" — shown in the rate trace line. */
  planLabel?: string;
}

/** SPEC §10.2 pipeline. Pure: same inputs → same outputs. */
export function computeJob(
  fin: JobFinancialInputs,
  plan: CompPlan,
  techs: readonly TechInput[],
  opts: ComputeOptions = {},
): JobResult {
  const techById = new Map(techs.map((t) => [t.userId, t]));
  const techOf = (userId: string): TechInput =>
    techById.get(userId) ?? { userId, workerType: "1099", overrides: {} };
  const d = plan.deductions_before_split;

  // 1. revenue, tips (net of refunds beyond the amount), fees (on what was charged:
  // processors keep their fee on refunds)
  const R = fin.revenueCents;
  const nets = fin.payments.map(netOfRefunds);
  const tipTotal = nets.reduce((a, p) => a + p.tipCents, 0);
  const fees = computeFees(fin.payments, plan);
  const techPartsTotal = Object.values(fin.techPartsByUser).reduce(
    (a, b) => a + b,
    0,
  );

  // 2. deductions in order
  const cp = d.company_parts ? fin.companyPartsCents : 0;
  const tp = d.tech_parts ? techPartsTotal : 0;
  const fb = d.processing_fees === "none" ? 0 : fees.feesOnBaseCents;
  const lead = d.lead_cost ? (fin.leadCostCents ?? 0) : 0;
  const sub = d.subcontract_cost ? (fin.subcontractCostCents ?? 0) : 0;
  const labor = plan.basis === "gross_profit" ? (fin.laborCostCents ?? 0) : 0;
  const deductions =
    plan.basis === "revenue" ? 0 : cp + tp + fb + lead + sub + labor;

  // 3. base, scaled by the share of the invoice kept after refunds and credits
  const baseBeforeRefunds = Math.max(0, R - deductions);
  const invoiceTotal = fin.invoiceTotalCents ?? 0;
  const refunded = invoiceReduction(fin);
  const base =
    refunded > 0
      ? divRoundHalfAway(
          baseBeforeRefunds * (invoiceTotal - refunded),
          invoiceTotal,
        )
      : baseBeforeRefunds;
  const refundOnBase = baseBeforeRefunds - base;
  const refundOnRevenue =
    refunded > 0 ? divRoundHalfAway(R * refunded, invoiceTotal) : 0;
  const otherDeductions = plan.basis === "revenue" ? 0 : lead + sub + labor;

  // splits + rates
  const assignees = normalizeSplits(fin.assignees, plan);
  const splitBps = assignees.map((a) => a.splitBps);
  const recall =
    fin.isCallback &&
    (fin.recallInWindow ?? true) &&
    plan.recalls.policy === "no_commission_on_recall";
  const rates = assignees.map((a) => {
    const r = resolveRate(plan, techOf(a.userId), fin);
    return recall ? { ...r, rateBps: 0 } : r;
  });

  // 6. commission
  const commissionBasis = plan.basis !== "hourly";
  let commissions: number[];
  if (!commissionBasis || assignees.length === 0) {
    commissions = assignees.map(() => 0);
  } else if (plan.basis === "flat_per_job") {
    commissions = splitByBps(
      recall ? 0 : (plan.flat_per_job_cents ?? 0),
      splitBps,
    );
  } else if (rates.every((r) => r.rateBps === rates[0]?.rateBps)) {
    const total = roundHalfAway((base * (rates[0]?.rateBps ?? 0)) / 10000);
    commissions = splitByBps(total, splitBps);
  } else {
    commissions = assignees.map((a, i) =>
      roundHalfAway(
        (base * a.splitBps * (rates[i]?.rateBps ?? 0)) / 100_000_000,
      ),
    );
  }
  const commissionTotal = commissions.reduce((a, b) => a + b, 0);

  // 7. spiffs
  const spiffByUser = new Map<string, number>();
  let workedPool = 0;
  const primary = assignees.find((a) => a.role === "primary") ?? assignees[0];
  if (!recall && assignees.length > 0) {
    for (const rule of plan.spiffs) {
      const flat = rule.amount.flat_cents;
      const pct = rule.amount.pct_bps ?? 0;
      let amount = 0;
      let reviewUsers: string[] = [];
      if (rule.match.kind === "review_bonus") {
        reviewUsers = (fin.reviewBonusUserIds ?? []).filter((u) =>
          assignees.some((a) => a.userId === u),
        );
        amount = flat ?? applyBps(R, pct);
        for (const u of reviewUsers)
          spiffByUser.set(u, (spiffByUser.get(u) ?? 0) + amount);
        continue;
      }
      if (rule.match.service_type_id) {
        if (rule.match.service_type_id !== fin.serviceTypeId) continue;
        amount = flat ?? applyBps(R, pct);
      }
      if (rule.match.pricebook_item_id) {
        const lineTotal = fin.pricebookTotals?.[rule.match.pricebook_item_id];
        if (lineTotal == null) continue;
        amount = flat ?? applyBps(lineTotal, pct);
      }
      if (!rule.match.service_type_id && !rule.match.pricebook_item_id)
        continue;
      if (amount === 0) continue;
      if (rule.credit === "sold_by") {
        const seller =
          fin.soldByUserId &&
          assignees.some((a) => a.userId === fin.soldByUserId)
            ? fin.soldByUserId
            : (primary?.userId ?? null);
        if (seller)
          spiffByUser.set(seller, (spiffByUser.get(seller) ?? 0) + amount);
      } else {
        workedPool += amount;
      }
    }
  }
  const workedShares = splitByBps(workedPool, splitBps);
  assignees.forEach((a, i) => {
    const w = workedShares[i] ?? 0;
    if (w) spiffByUser.set(a.userId, (spiffByUser.get(a.userId) ?? 0) + w);
  });

  // 9. tips (the fee on tips is deducted only when enabled and never for W-2)
  const tipPool = applyBps(tipTotal, plan.tips.pct_to_tech_bps);
  const tipPoolAfterFee = Math.max(0, tipPool - fees.feesOnTipsCents);
  const tipShares = splitByBps(tipPool, splitBps);
  const tipSharesAfterFee = splitByBps(tipPoolAfterFee, splitBps);

  // 10–11. reimbursements to purchasers, cash by collector
  const cashByUser = new Map<string, number>();
  fin.payments.forEach((p, i) => {
    if (!p.collectedByUserId) return;
    if (!(plan.cash.methods as string[]).includes(p.method)) return;
    const n = nets[i] ?? { amountCents: 0, tipCents: 0 };
    cashByUser.set(
      p.collectedByUserId,
      (cashByUser.get(p.collectedByUserId) ?? 0) + n.amountCents + n.tipCents,
    );
  });

  const userIds: string[] = [];
  const add = (u: string) => {
    if (!userIds.includes(u)) userIds.push(u);
  };
  for (const a of assignees) add(a.userId);
  for (const u of Object.keys(fin.techPartsByUser)) add(u);
  for (const u of cashByUser.keys())
    if (techById.has(u) || assignees.some((a) => a.userId === u)) add(u);

  const label = opts.planLabel ? `, plan ${opts.planLabel}` : "";
  const refundShareLabel =
    refunded > 0
      ? `${formatBps(divRoundHalfAway(refunded * 10000, invoiceTotal))} of the invoice`
      : "";
  const feeLabel = (() => {
    const pf = d.processing_fees;
    if (typeof pf === "object") {
      const methods = new Set(
        fin.payments
          .filter((p) => plan.fee_methods.includes(p.method))
          .map((p) => p.method),
      );
      if (methods.size === 1) {
        const m = [...methods][0] as PaymentInput["method"];
        const bps = pf.pct_bps_by_method[m] ?? 0;
        return `${m === "card" ? "Card" : m.toUpperCase()} processing fee (${formatBps(bps)})`;
      }
    }
    return "Processing fees";
  })();

  const earnings: TechEarning[] = userIds.map((userId) => {
    const t = techOf(userId);
    const idx = assignees.findIndex((a) => a.userId === userId);
    const split = idx >= 0 ? (assignees[idx]?.splitBps ?? 0) : 0;
    const rate =
      idx >= 0
        ? (rates[idx] ?? { rateBps: 0, source: "plan" as const })
        : { rateBps: 0, source: "plan" as const };
    const commission = idx >= 0 ? (commissions[idx] ?? 0) : 0;
    const spiffs = spiffByUser.get(userId) ?? 0;
    const blockFeeOnTip =
      t.workerType === "w2" || !plan.tips.deduct_card_fee_on_tip;
    const tip =
      idx >= 0
        ? ((blockFeeOnTip ? tipShares[idx] : tipSharesAfterFee[idx]) ?? 0)
        : 0;
    const reimbursement = applyBps(
      fin.techPartsByUser[userId] ?? 0,
      plan.tech_parts_reimburse_bps,
    );
    const cash = effectiveCash(plan, t.workerType, t.overrides);
    const cashHeld = cashByUser.get(userId) ?? 0;
    const netted =
      cash.techKeepsCash && cash.settlement === "net_in_payout" ? cashHeld : 0;
    const net = commission + spiffs + tip + reimbursement - netted;

    const trace: TraceStep[] = [];
    let run = step(trace, "revenue", "Job total (before tax & tip)", R, R);
    if (plan.basis !== "revenue") {
      if (cp)
        run = step(trace, "company_parts", "Company parts", -cp, run - cp);
      if (tp) {
        const mine = fin.techPartsByUser[userId] ?? 0;
        const lbl =
          mine === tp
            ? "Parts you bought"
            : mine > 0
              ? "Parts bought by techs (incl. yours)"
              : "Parts bought by techs";
        run = step(trace, "tech_parts", lbl, -tp, run - tp);
      }
      if (fb) run = step(trace, "fees", feeLabel, -fb, run - fb);
      if (lead) run = step(trace, "lead_cost", "Lead cost", -lead, run - lead);
      if (sub)
        run = step(trace, "subcontract", "Subcontractor cost", -sub, run - sub);
      if (labor)
        run = step(trace, "labor_cost", "Labor cost", -labor, run - labor);
    }
    if (refundOnBase)
      run = step(
        trace,
        "refunds",
        `Refunded or credited to the customer (${refundShareLabel})`,
        -refundOnBase,
        run - refundOnBase,
      );
    run = step(trace, "base", "Commission base", base, base);
    if (idx >= 0) {
      if (recall) {
        step(
          trace,
          "note",
          "Callback within the recall window: no commission",
          0,
          base,
        );
      }
      if (plan.basis === "flat_per_job") {
        step(trace, "rate", `Flat per job${label}`, 0, base);
      } else if (plan.basis === "hourly") {
        step(trace, "rate", "Hourly plan: paid from time entries", 0, base);
      } else {
        const src =
          rate.source === "plan" ? "" : `, ${RATE_SOURCE_LABEL[rate.source]}`;
        step(
          trace,
          "rate",
          `Your rate (${formatBps(rate.rateBps)}${src}${label})`,
          0,
          base,
        );
      }
      if (split !== 10000)
        step(trace, "split", `Your split (${formatBps(split)})`, 0, base);
    }
    run = step(trace, "commission", "Commission", commission, commission);
    if (spiffs) run = step(trace, "spiffs", "Spiffs", spiffs, run + spiffs);
    if (tip)
      run = step(
        trace,
        "tip",
        `Tip (${formatBps(plan.tips.pct_to_tech_bps)})`,
        tip,
        run + tip,
      );
    if (reimbursement)
      run = step(
        trace,
        "reimbursement",
        "Reimbursement for parts",
        reimbursement,
        run + reimbursement,
      );
    if (netted)
      run = step(
        trace,
        "cash_held",
        "Cash you kept (deducted from pay)",
        -netted,
        run - netted,
      );
    step(trace, "net", "Your earnings on this job", net, net);

    return {
      userId,
      splitBps: split,
      rateBps: rate.rateBps,
      rateSource: rate.source,
      commissionCents: commission,
      spiffsCents: spiffs,
      tipCents: tip,
      reimbursementCents: reimbursement,
      cashHeldCents: cashHeld,
      techKeepsCash: cash.techKeepsCash,
      cashSettlement: cash.settlement,
      netCents: net,
      trace,
    };
  });

  // 13. company net
  const sumReimb = earnings.reduce((a, e) => a + e.reimbursementCents, 0);
  const sumComm = earnings.reduce((a, e) => a + e.commissionCents, 0);
  const sumSpiff = earnings.reduce((a, e) => a + e.spiffsCents, 0);
  const sumTips = earnings.reduce((a, e) => a + e.tipCents, 0);
  const leadAll = fin.leadCostCents ?? 0;
  const subAll = fin.subcontractCostCents ?? 0;
  const companyNet =
    R -
    refundOnRevenue +
    tipTotal -
    fees.feesTotalCents -
    fin.companyPartsCents -
    sumReimb -
    sumComm -
    sumSpiff -
    sumTips -
    (d.lead_cost ? leadAll : 0) -
    (d.subcontract_cost ? subAll : 0);

  const ctrace: TraceStep[] = [];
  let c = step(ctrace, "revenue", "Job total (before tax & tip)", R, R);
  if (refundOnRevenue)
    c = step(
      ctrace,
      "refunds",
      "Refunded or credited to the customer",
      -refundOnRevenue,
      c - refundOnRevenue,
    );
  if (tipTotal)
    c = step(ctrace, "tips_total", "Tips collected", tipTotal, c + tipTotal);
  if (fees.feesTotalCents)
    c = step(
      ctrace,
      "fees_total",
      "Processing fees",
      -fees.feesTotalCents,
      c - fees.feesTotalCents,
    );
  if (fin.companyPartsCents)
    c = step(
      ctrace,
      "company_parts",
      "Company parts",
      -fin.companyPartsCents,
      c - fin.companyPartsCents,
    );
  if (sumReimb)
    c = step(
      ctrace,
      "reimbursements_total",
      "Parts reimbursed to techs",
      -sumReimb,
      c - sumReimb,
    );
  if (sumComm + sumSpiff)
    c = step(
      ctrace,
      "commissions_total",
      "Commissions & spiffs",
      -(sumComm + sumSpiff),
      c - sumComm - sumSpiff,
    );
  if (sumTips)
    c = step(ctrace, "tip", "Tips paid to techs", -sumTips, c - sumTips);
  if (d.lead_cost && leadAll)
    c = step(ctrace, "lead_cost", "Lead cost", -leadAll, c - leadAll);
  if (d.subcontract_cost && subAll)
    c = step(ctrace, "subcontract", "Subcontractor cost", -subAll, c - subAll);
  step(ctrace, "company_net", "Company net", companyNet, companyNet);

  return {
    jobId: fin.jobId,
    revenueCents: R,
    taxCents: fin.taxCents,
    tipCents: tipTotal,
    companyPartsCents: fin.companyPartsCents,
    techPartsCents: techPartsTotal,
    feesCents: fees.feesOnBaseCents,
    feesOnTipsCents: fees.feesOnTipsCents,
    otherDeductionsCents: otherDeductions,
    baseCents: base,
    refundedCents: refunded,
    commissionTotalCents: commissionTotal,
    companyNetCents: companyNet,
    earnings,
    trace: ctrace,
    flags: {
      pendingReimbursements: (fin.pendingTechPartsCents ?? 0) > 0,
      recall,
    },
  };
}
