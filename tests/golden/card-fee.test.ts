// ★ Golden tests: card fee on Stripe webhook payments (QA round 2, money fixer).
// Real webhooks carry the charge as an id, so the actual fee isn't known when the
// payment is booked. The payment stores an ESTIMATE from the configured card rate
// (2.9 % + 30¢ by default) so commission is net of the fee from the start; when the
// `stripe_fee` worker gets the actual fee it emits `payment.fee_updated` and payroll
// recomputes (unchanged ledger keys post nothing → no double posting).
// Plan: the default "Partner 25% after parts & card fee" (processing_fees 'actual').
import { describe, expect, it } from "vitest";
import {
  estimatedCardFee,
  splitActualFee,
} from "@/features/payments/engine/fees";
import {
  computeJob,
  type ExistingJobEntry,
  type JobFinancialInputs,
  jobPostings,
  planRecompute,
  resolvePlan,
  type TechInput,
} from "@/features/payroll/engine";

const plan = resolvePlan({});
const t1: TechInput = { userId: "t1", workerType: "1099", overrides: {} };

const card = (feeCents: number, tipCents = 0): JobFinancialInputs => ({
  jobId: "J-1060",
  revenueCents: 12500,
  taxCents: 0,
  serviceTypeId: null,
  customRateBps: null,
  isCallback: false,
  payments: [
    {
      id: "pi",
      method: "card",
      amountCents: 12500,
      tipCents,
      feeCents,
      collectedByUserId: null,
    },
  ],
  companyPartsCents: 0,
  techPartsByUser: {},
  assignees: [{ userId: "t1", splitBps: 10000, role: "primary" }],
  invoiceTotalCents: 12500,
});

describe("estimatedCardFee (2.9 % + 30¢ on the gross charge)", () => {
  it("$125.00 card → $3.93 (362.5 → 363 + 30), all on the base", () => {
    expect(
      estimatedCardFee({
        amountCents: 12500,
        tipCents: 0,
        bps: 290,
        fixedCents: 30,
      }),
    ).toEqual({ feeCents: 393, feeOnBaseCents: 393, feeOnTipCents: 0 });
  });

  it("$125.00 + $10.00 tip → $4.22 split pro rata (base 3.91, tip 0.31)", () => {
    // 13500 × 2.9 % = 391.5 → 392 (half away) + 30 = 422
    // base 422 × 12500 / 13500 = 390.74 → 391; tip 31
    expect(
      estimatedCardFee({
        amountCents: 12500,
        tipCents: 1000,
        bps: 290,
        fixedCents: 30,
      }),
    ).toEqual({ feeCents: 422, feeOnBaseCents: 391, feeOnTipCents: 31 });
  });

  it("uses what was charged (surcharge included) when given", () => {
    // gross 12875 (3 % surcharge): 373.375 → 373 + 30 = 403
    expect(
      estimatedCardFee({
        amountCents: 12500,
        tipCents: 0,
        grossCents: 12875,
        bps: 290,
        fixedCents: 30,
      }).feeCents,
    ).toBe(403);
  });

  it("nothing charged → no fee; the split of an actual fee matches the estimate's", () => {
    expect(
      estimatedCardFee({
        amountCents: 0,
        tipCents: 0,
        bps: 290,
        fixedCents: 30,
      }).feeCents,
    ).toBe(0);
    expect(
      splitActualFee({ amountCents: 12500, tipCents: 1000, feeCents: 422 }),
    ).toEqual({ feeOnBaseCents: 391, feeOnTipCents: 31 });
  });
});

describe("commission follows the fee: estimate first, actual later, posted once", () => {
  it("J-1060 before the fix: fee 0 → 25 % × 125.00 = 31.25 (over-paid)", () => {
    expect(computeJob(card(0), plan, [t1]).earnings[0]?.commissionCents).toBe(
      3125,
    );
  });

  it("estimate $3.93 → 25 % × (125.00 − 3.93) = 30.2675 → 30.27", () => {
    const r = computeJob(card(393), plan, [t1]);
    expect(r.feesCents).toBe(393);
    expect(r.baseCents).toBe(12107);
    expect(r.earnings[0]?.commissionCents).toBe(3027);
  });

  it("actual $3.80 arrives → 25 % × 121.20 = 30.30: reverse 30.27, post 30.30, then nothing", () => {
    const before = jobPostings(computeJob(card(393), plan, [t1]), {
      earned: true,
      jobNumber: "J-1060",
    });
    const existing: ExistingJobEntry[] = before.map((p, i) => ({
      id: `e${i}`,
      userId: p.userId,
      type: p.type,
      amountCents: p.amountCents,
      settled: false,
    }));
    expect(existing.map((e) => [e.type, e.amountCents])).toEqual([
      ["commission", 3027],
    ]);
    const after = jobPostings(computeJob(card(380), plan, [t1]), {
      earned: true,
      jobNumber: "J-1060",
    });
    const plan1 = planRecompute(existing, after, {
      locked: false,
      memo: "payment.fee_updated",
    });
    expect(plan1.reverse.map((e) => e.amountCents)).toEqual([3027]);
    expect(plan1.post.map((p) => [p.type, p.amountCents])).toEqual([
      ["commission", 3030],
    ]);
    // The same event re-delivered (or invoice.paid recomputing too): nothing posts.
    const now: ExistingJobEntry[] = [
      {
        id: "n1",
        userId: "t1",
        type: "commission",
        amountCents: 3030,
        settled: false,
      },
    ];
    const plan2 = planRecompute(now, after, {
      locked: false,
      memo: "payment.fee_updated",
    });
    expect(plan2.reverse).toEqual([]);
    expect(plan2.post).toEqual([]);
  });

  it("locked job: the fee change posts one adjustment (+0.03), never twice", () => {
    const after = jobPostings(computeJob(card(380), plan, [t1]), {
      earned: true,
      jobNumber: "J-1060",
    });
    const settled: ExistingJobEntry[] = [
      {
        id: "s1",
        userId: "t1",
        type: "commission",
        amountCents: 3027,
        settled: true,
      },
    ];
    const first = planRecompute(settled, after, {
      locked: true,
      memo: "payment.fee_updated",
    });
    expect(first.post.map((p) => [p.type, p.amountCents])).toEqual([
      ["adjustment", 3],
    ]);
    const second = planRecompute(settled, after, {
      locked: true,
      memo: "payment.fee_updated",
      postedAdjustments: new Map([["t1", 3]]),
    });
    expect(second.post).toEqual([]);
  });

  it("the tip's fee share stays with the company (tip kept whole)", () => {
    // 12500 + 1000 tip, actual fee 422: base share 391 → 25 % × 12109 = 30.2725 → 30.27
    const r = computeJob(card(422, 1000), plan, [t1]);
    expect(r.feesOnTipsCents).toBe(31);
    expect(r.earnings[0]?.commissionCents).toBe(3027);
    expect(r.earnings[0]?.tipCents).toBe(1000);
  });
});
