// ★ Settlement rules: deduction cap carry-forward, recompute reversals (idempotent),
// locked-job adjustments, pay periods, tiers.
import { describe, expect, it } from "vitest";
import {
  deductionCap,
  deductionsOf,
  type ExistingJobEntry,
  openingBalance,
  type Posting,
  periodFor,
  periodsBetween,
  planRecompute,
  tierAdjustment,
  weeksIn,
} from "@/features/payroll/engine";

const P = (
  userId: string,
  type: Posting["type"],
  amountCents: number,
): Posting => ({ userId, type, amountCents, wageClass: "wage", memo: "m" });
const E = (
  id: string,
  userId: string,
  type: string,
  amountCents: number,
  settled = false,
): ExistingJobEntry => ({ id, userId, type, amountCents, settled });

describe("deduction cap ⚖️", () => {
  it("defers deductions beyond cap × gross as carry_forward", () => {
    expect(deductionCap(10000, 6000, 5000)).toEqual({
      allowedCents: 5000,
      deferredCents: 1000,
    });
    expect(deductionCap(10000, 4000, 5000)).toEqual({
      allowedCents: 4000,
      deferredCents: 0,
    });
    expect(deductionCap(10000, 6000, null)).toEqual({
      allowedCents: 6000,
      deferredCents: 0,
    });
    expect(deductionCap(0, 2000, 5000)).toEqual({
      allowedCents: 0,
      deferredCents: 2000,
    });
  });
  it("counts chargebacks, clawbacks, tool deductions and negative adjustments", () => {
    expect(
      deductionsOf([
        { type: "commission", amountCents: 9000, wageClass: "wage" },
        { type: "chargeback_clawback", amountCents: -3000, wageClass: "wage" },
        { type: "tool_deduction", amountCents: -1000, wageClass: "wage" },
        { type: "adjustment", amountCents: -500, wageClass: "wage" },
        { type: "cash_held", amountCents: -20000, wageClass: "custody" },
        {
          type: "tool_deduction",
          amountCents: -999,
          wageClass: "wage",
          pendingReview: true,
        },
      ]),
    ).toBe(4500);
  });
});

describe("recompute before lock", () => {
  it("is a no-op when nothing changed (idempotent)", () => {
    const r = planRecompute(
      [E("1", "t1", "commission", 8075), E("2", "t1", "tip", 2000)],
      [P("t1", "commission", 8075), P("t1", "tip", 2000)],
      { locked: false, memo: "x" },
    );
    expect(r).toEqual({ reverse: [], post: [] });
  });
  it("reverses changed unsettled lines and posts the new amount", () => {
    const r = planRecompute(
      [E("1", "t1", "commission", 8075), E("2", "t1", "tip", 2000)],
      [P("t1", "commission", 9000), P("t1", "tip", 2000)],
      { locked: false, memo: "x" },
    );
    expect(r.reverse.map((e) => e.id)).toEqual(["1"]);
    expect(r.post.map((p) => [p.type, p.amountCents])).toEqual([
      ["commission", 9000],
    ]);
  });
  it("posts only the difference over a settled line", () => {
    const r = planRecompute(
      [E("1", "t1", "commission", 8075, true)],
      [P("t1", "commission", 9000)],
      { locked: false, memo: "x" },
    );
    expect(r.reverse).toEqual([]);
    expect(r.post.map((p) => [p.type, p.amountCents])).toEqual([
      ["commission", 925],
    ]);
  });
  it("removes lines that are no longer earned", () => {
    const r = planRecompute([E("1", "t1", "commission", 8075)], [], {
      locked: false,
      memo: "x",
    });
    expect(r.reverse.map((e) => e.id)).toEqual(["1"]);
    expect(r.post).toEqual([]);
  });
  it("after lock, the difference per user becomes one adjustment", () => {
    const r = planRecompute(
      [E("1", "t1", "commission", 8075, true), E("2", "t1", "tip", 2000, true)],
      [P("t1", "commission", 7000), P("t1", "tip", 2000)],
      { locked: true, memo: "changed after lock" },
    );
    expect(r.reverse).toEqual([]);
    expect(r.post.map((p) => [p.type, p.amountCents])).toEqual([
      ["adjustment", -1075],
    ]);
  });
  it("posts an informational zero cash line once", () => {
    const info = {
      userId: "t2",
      type: "cash_held" as const,
      amountCents: 0,
      wageClass: "custody" as const,
      memo: "remit",
    };
    expect(
      planRecompute([], [info], { locked: false, memo: "x" }).post,
    ).toHaveLength(1);
    expect(
      planRecompute([E("9", "t2", "cash_held", 0)], [info], {
        locked: false,
        memo: "x",
      }).post,
    ).toHaveLength(0);
  });
});

describe("opening balance", () => {
  it("carries a negative balance and any unpaid positive remainder", () => {
    expect(openingBalance({ closingCents: -11850, paidCents: 0 })).toBe(-11850);
    expect(openingBalance({ closingCents: 50000, paidCents: 50000 })).toBe(0);
    expect(openingBalance({ closingCents: 50000, paidCents: 30000 })).toBe(
      20000,
    );
    expect(openingBalance(null)).toBe(0);
  });
});

describe("pay periods", () => {
  it("weekly periods start on the configured weekday", () => {
    // 2026-10-15 is a Thursday.
    expect(
      periodFor("2026-10-15", { period: "weekly", weekStartsOn: 1 }),
    ).toEqual({ startsOn: "2026-10-12", endsOn: "2026-10-18" });
    expect(
      periodFor("2026-10-15", { period: "weekly", weekStartsOn: 0 }),
    ).toEqual({ startsOn: "2026-10-11", endsOn: "2026-10-17" });
  });
  it("bi-weekly periods align to the anchor", () => {
    const cfg = {
      period: "biweekly" as const,
      weekStartsOn: 1,
      biweeklyAnchor: "2026-01-05",
    };
    expect(periodFor("2026-01-05", cfg)).toEqual({
      startsOn: "2026-01-05",
      endsOn: "2026-01-18",
    });
    expect(periodFor("2026-01-19", cfg)).toEqual({
      startsOn: "2026-01-19",
      endsOn: "2026-02-01",
    });
    expect(periodFor("2026-01-31", cfg)).toEqual({
      startsOn: "2026-01-19",
      endsOn: "2026-02-01",
    });
  });
  it("semi-monthly periods are the 1st–15th and 16th–end", () => {
    expect(
      periodFor("2026-02-20", { period: "semimonthly", weekStartsOn: 1 }),
    ).toEqual({ startsOn: "2026-02-16", endsOn: "2026-02-28" });
    expect(
      periodFor("2026-02-15", { period: "semimonthly", weekStartsOn: 1 }),
    ).toEqual({ startsOn: "2026-02-01", endsOn: "2026-02-15" });
  });
  it("lists consecutive periods and the weeks inside one", () => {
    const ps = periodsBetween("2026-10-01", "2026-10-20", {
      period: "weekly",
      weekStartsOn: 1,
    });
    expect(ps.map((p) => p.startsOn)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(
      weeksIn({ startsOn: "2026-10-01", endsOn: "2026-10-15" }, 1),
    ).toHaveLength(3);
  });
});

describe("tiers", () => {
  const jobs = [
    { revenueCents: 600000, baseCents: 500000, appliedRateBps: 2500 },
    { revenueCents: 600000, baseCents: 500000, appliedRateBps: 2500 },
  ];
  it("retro applies the tier rate to every job once reached", () => {
    expect(
      tierAdjustment(jobs, [
        { period_revenue_gte_cents: 1000000, rate_bps: 3000, mode: "retro" },
      ]),
    ).toBe(50000);
  });
  it("marginal applies only above the threshold", () => {
    expect(
      tierAdjustment(jobs, [
        { period_revenue_gte_cents: 1000000, rate_bps: 3000, mode: "marginal" },
      ]),
    ).toBe(8334);
    expect(
      tierAdjustment(jobs, [
        { period_revenue_gte_cents: 2000000, rate_bps: 3000, mode: "retro" },
      ]),
    ).toBe(0);
  });
});
