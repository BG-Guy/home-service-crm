// ★ Golden tests for QA round 2 money fixes (B6):
// - T6-07 partial refunds: tips are kept (net of refunds only beyond the amount) and
//   commission is scaled by the share of the invoice kept, never fully reversed.
// - T6-02 post-lock recompute: the adjustment delta is idempotent.
// Plan: 25% partner plan, card fee 3% configured, company absorbs the fee on tips
// (the §10.4 plan). Worked numbers are in each case's comment.
import { describe, expect, it } from "vitest";
import {
  type CompPlan,
  computeJob,
  type ExistingJobEntry,
  invoiceReduction,
  type JobFinancialInputs,
  jobPostings,
  netOfRefunds,
  planRecompute,
  resolvePlan,
  type TechInput,
} from "@/features/payroll/engine";

const plan: CompPlan = resolvePlan({
  deductions_before_split: {
    processing_fees: { pct_bps_by_method: { card: 300 } },
  },
});
const t1: TechInput = { userId: "t1", workerType: "1099", overrides: {} };

const fin = (over: Partial<JobFinancialInputs>): JobFinancialInputs => ({
  jobId: "j",
  revenueCents: 0,
  taxCents: 0,
  serviceTypeId: null,
  customRateBps: null,
  isCallback: false,
  payments: [],
  companyPartsCents: 0,
  techPartsByUser: {},
  assignees: [{ userId: "t1", splitBps: 10000, role: "primary" }],
  ...over,
});

/** §10.4 case A ($400 card + $20 tip, company parts $40, tech parts $25) with a refund. */
const caseA = (refundedCents: number, creditedCents = 0) =>
  fin({
    jobId: "A",
    revenueCents: 40000,
    invoiceTotalCents: 40000,
    creditedCents,
    payments: [
      {
        id: "pa",
        method: "card",
        amountCents: 40000,
        tipCents: 2000,
        refundedCents,
        feeCents: 0,
        collectedByUserId: "t1",
      },
    ],
    companyPartsCents: 4000,
    techPartsByUser: { t1: 2500 },
  });

describe("T6-07 partial refunds (lead decision)", () => {
  it("no refund: case A is unchanged (+125.75)", () => {
    const r = computeJob(caseA(0), plan, [t1]);
    expect(r.refundedCents).toBe(0);
    expect(r.baseCents).toBe(32300);
    expect(r.earnings[0]?.netCents).toBe(12575);
    expect(r.companyNetCents).toBe(24165);
  });

  it("$20 partial refund in B4's shape (paid invoice + $20 credit note): +121.71", () => {
    // base 400 − 40 − 25 − 12 (3% of the $400 charged; the fee isn't refunded) = 323.00
    // kept = (400 − 20) / 400 → base 323.00 × 0.95 = 306.85
    // commission 25% × 306.85 = 76.7125 → 76.71; tip 20.00 kept; reimb 25.00
    // tech 76.71 + 20 + 25 = 121.71
    // company 400 − 20 + 20 − 12.60 − 40 − 25 − 76.71 − 20 = 225.69
    // B4: the invoice stays paid, a credit note covers the refunded base, the
    // payment is partially_refunded. Credit and refund are the same $20: once.
    const r = computeJob(caseA(2000, 2000), plan, [t1]);
    expect(r.feesCents).toBe(1200);
    expect(r.feesOnTipsCents).toBe(60);
    expect(r.refundedCents).toBe(2000);
    expect(r.baseCents).toBe(30685);
    const e = r.earnings[0];
    expect(e?.commissionCents).toBe(7671);
    expect(e?.tipCents).toBe(2000);
    expect(e?.reimbursementCents).toBe(2500);
    expect(e?.netCents).toBe(12171);
    expect(r.companyNetCents).toBe(22569);
    const refundStep = e?.trace.find((s) => s.step === "refunds");
    expect(refundStep?.amount_cents).toBe(-1615);
    expect(refundStep?.label).toContain("5% of the invoice");
  });

  it("same result without the credit note (a refund that re-opened the invoice)", () => {
    const a = computeJob(caseA(2000), plan, [t1]);
    const b = computeJob(caseA(2000, 2000), plan, [t1]);
    expect(b.refundedCents).toBe(2000);
    expect(b.earnings[0]?.netCents).toBe(a.earnings[0]?.netCents);
    expect(b.companyNetCents).toBe(a.companyNetCents);
  });

  it("a credit note alone (goodwill, no refund) scales the base too", () => {
    // $50 credit on the $400 invoice → base 323.00 × 350/400 = 282.625 → 282.63
    // commission 25% × 282.63 = 70.6575 → 70.66
    const r = computeJob(caseA(0, 5000), plan, [t1]);
    expect(r.baseCents).toBe(28263);
    expect(r.earnings[0]?.commissionCents).toBe(7066);
  });

  it("refund beyond the amount comes off the tip: $410 → tip $10, commission $0", () => {
    // amount 400 fully refunded, 10 of the 20 tip refunded → tip 10.00
    // kept = 0 → base 0, commission 0; tech 0 + 10 + 25 = 35.00
    const r = computeJob(caseA(41000), plan, [t1]);
    expect(netOfRefunds(caseA(41000).payments[0] as never)).toEqual({
      amountCents: 0,
      tipCents: 1000,
    });
    expect(r.baseCents).toBe(0);
    const e = r.earnings[0];
    expect(e?.commissionCents).toBe(0);
    expect(e?.tipCents).toBe(1000);
    expect(e?.netCents).toBe(3500);
  });

  it("full refund (amount + tip): only the parts reimbursement remains (+25.00)", () => {
    const e = computeJob(caseA(42000), plan, [t1]).earnings[0];
    expect(e?.commissionCents).toBe(0);
    expect(e?.tipCents).toBe(0);
    expect(e?.netCents).toBe(2500);
  });

  it("refunding an overpayment doesn't touch commission", () => {
    // paid 450 on a 400 invoice, 50 refunded → nothing given back from the invoice
    const f = caseA(0);
    f.payments = [
      {
        id: "pa",
        method: "card",
        amountCents: 45000,
        tipCents: 2000,
        refundedCents: 5000,
        feeCents: 0,
        collectedByUserId: "t1",
      },
    ];
    // The 3% fee is on the $450 charged (13.50, not refunded by the processor):
    // base 400 − 40 − 25 − 13.50 = 321.50 × 25% = 80.375 → 80.38, no refund scaling.
    expect(invoiceReduction(f)).toBe(0);
    const r = computeJob(f, plan, [t1]);
    expect(r.baseCents).toBe(32150);
    expect(r.earnings[0]?.commissionCents).toBe(8038);
  });

  it("partially paid invoice: only the refunded part reduces the base", () => {
    // job_done plan; 200 of 400 paid, 50 refunded → 50 given back
    const f = caseA(0);
    f.payments = [
      {
        id: "pa",
        method: "card",
        amountCents: 20000,
        tipCents: 0,
        refundedCents: 5000,
        feeCents: 0,
        collectedByUserId: "t1",
      },
    ];
    expect(invoiceReduction(f)).toBe(5000);
  });

  it("case B cash kept + $50 cash refund → −163.75", () => {
    // base 300 − 30 = 270 × 250/300 = 225.00 → commission 56.25; reimb 30
    // cash kept 300 − 50 = 250 → net 56.25 + 30 − 250 = −163.75
    const r = computeJob(
      fin({
        jobId: "B",
        revenueCents: 30000,
        invoiceTotalCents: 30000,
        payments: [
          {
            id: "pb",
            method: "cash",
            amountCents: 30000,
            tipCents: 0,
            refundedCents: 5000,
            feeCents: 0,
            collectedByUserId: "t1",
          },
        ],
        techPartsByUser: { t1: 3000 },
      }),
      plan,
      [t1],
    );
    const e = r.earnings[0];
    expect(r.baseCents).toBe(22500);
    expect(e?.commissionCents).toBe(5625);
    expect(e?.cashHeldCents).toBe(25000);
    expect(e?.netCents).toBe(-16375);
  });
});

describe("T6-02 post-lock recompute is idempotent", () => {
  const settled = (
    type: string,
    amountCents: number,
    id = type,
  ): ExistingJobEntry => ({
    id,
    userId: "t1",
    type,
    amountCents,
    settled: true,
  });

  it("$20 refund on a locked case-A job: −4.04 once, then nothing", () => {
    // Before: commission 80.75 + tip 20 + reimb 25 = 125.75 (settled, locked).
    // After the refund: 76.71 + 20 + 25 = 121.71 → one adjustment of −4.04.
    const existing = [
      settled("commission", 8075),
      settled("tip", 2000),
      settled("reimbursement_parts", 2500),
    ];
    const target = jobPostings(computeJob(caseA(2000), plan, [t1]), {
      earned: true,
      jobNumber: "J-1",
    });
    const first = planRecompute(existing, target, {
      locked: true,
      memo: "refund.created",
    });
    expect(first.reverse).toEqual([]);
    expect(first.post.map((p) => [p.type, p.amountCents])).toEqual([
      ["adjustment", -404],
    ]);
    // refund.succeeded fires the same recompute: the posted −4.04 is counted.
    const second = planRecompute(existing, target, {
      locked: true,
      memo: "refund.succeeded",
      postedAdjustments: new Map([["t1", -404]]),
    });
    expect(second.post).toEqual([]);
  });

  it("paying a locked unpaid job posts +46.34 once (invoice.paid + payment.succeeded)", () => {
    // Locked while unpaid (paid_in_full plan → nothing earned at lock), then paid.
    // Revenue basis: $185.36 × 25% = 46.34. Two events trigger the recompute.
    const revenuePlan = resolvePlan({ basis: "revenue" });
    const target = jobPostings(
      computeJob(
        fin({
          revenueCents: 18536,
          invoiceTotalCents: 18536,
          payments: [
            {
              id: "p",
              method: "card",
              amountCents: 18536,
              tipCents: 0,
              feeCents: 0,
              collectedByUserId: null,
            },
          ],
        }),
        revenuePlan,
        [t1],
      ),
      { earned: true, jobNumber: "J-1056" },
    );
    const first = planRecompute([], target, {
      locked: true,
      memo: "invoice.paid",
    });
    expect(first.post.map((p) => p.amountCents)).toEqual([4634]);
    const second = planRecompute([], target, {
      locked: true,
      memo: "payment.succeeded",
      postedAdjustments: new Map([["t1", 4634]]),
    });
    expect(second.post).toEqual([]);
    // A later real change still posts only its own delta.
    const third = planRecompute(
      [],
      [{ ...target[0], amountCents: 5000 }] as never,
      {
        locked: true,
        memo: "invoice.revised",
        postedAdjustments: new Map([["t1", 4634]]),
      },
    );
    expect(third.post.map((p) => p.amountCents)).toEqual([366]);
  });
});
