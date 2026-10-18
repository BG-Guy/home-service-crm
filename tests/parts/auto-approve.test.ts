// Auto-approve rules for tech-paid purchases (SPEC M15).
import { describe, expect, it } from "vitest";
import {
  evaluateAutoApprove,
  markupMargin,
  nextAvgCost,
} from "@/features/parts/rules";

const ok = {
  totalCents: 2500,
  limitCents: 5000,
  hasReceipt: true,
  receiptRequiredOverCents: 0,
  aiConfigured: true,
  aiState: "done" as const,
  aiTotalCents: 2530,
  toleranceCents: 50,
  purchasedOn: "2026-10-14",
  referenceDate: "2026-10-15",
  maxAgeDays: 7,
};

describe("auto-approve", () => {
  it("approves when every rule holds", () => {
    expect(evaluateAutoApprove(ok)).toEqual({
      decision: "approve",
      flags: [],
      clean: true,
    });
  });
  it("approves without AI when none is configured and under the limit", () => {
    expect(
      evaluateAutoApprove({
        ...ok,
        aiConfigured: false,
        aiState: null,
        aiTotalCents: null,
      }).decision,
    ).toBe("approve");
  });
  it("waits for the AI result", () => {
    expect(
      evaluateAutoApprove({ ...ok, aiState: "queued", aiTotalCents: null })
        .decision,
    ).toBe("wait");
  });
  it("reviews mismatches, missing receipts, old dates and over-limit totals", () => {
    expect(evaluateAutoApprove({ ...ok, aiTotalCents: 2600 }).flags).toEqual([
      "ai_mismatch",
    ]);
    expect(evaluateAutoApprove({ ...ok, hasReceipt: false }).flags).toEqual([
      "no_receipt",
    ]);
    expect(
      evaluateAutoApprove({ ...ok, purchasedOn: "2026-10-01" }).flags,
    ).toEqual(["date_out_of_range"]);
    const over = evaluateAutoApprove({
      ...ok,
      totalCents: 5000,
      aiTotalCents: 5000,
    });
    expect(over).toEqual({
      decision: "review",
      flags: ["over_limit"],
      clean: true,
    });
    expect(
      evaluateAutoApprove({ ...ok, aiState: "failed", aiTotalCents: null })
        .flags,
    ).toEqual(["ai_unreadable"]);
  });
  it("a receipt already on another live claim is never auto-approved (QA2 NEW-4)", () => {
    expect(evaluateAutoApprove({ ...ok, duplicateReceipt: true })).toEqual({
      decision: "review",
      flags: ["duplicate_receipt"],
      clean: false,
    });
    // Also without AI, where an under-limit receipt would otherwise auto-approve.
    expect(
      evaluateAutoApprove({
        ...ok,
        aiConfigured: false,
        aiState: null,
        aiTotalCents: null,
        duplicateReceipt: true,
      }).decision,
    ).toBe("review");
    expect(
      evaluateAutoApprove({ ...ok, duplicateReceipt: false }).decision,
    ).toBe("approve");
  });
  it("the tolerance is inclusive ($0.50)", () => {
    expect(evaluateAutoApprove({ ...ok, aiTotalCents: 2550 }).decision).toBe(
      "approve",
    );
    expect(evaluateAutoApprove({ ...ok, aiTotalCents: 2449 }).decision).toBe(
      "review",
    );
  });
  it("a receipt is optional below receipt_required_over_cents", () => {
    expect(
      evaluateAutoApprove({
        ...ok,
        hasReceipt: false,
        aiConfigured: false,
        aiState: null,
        receiptRequiredOverCents: 3000,
      }).decision,
    ).toBe("approve");
  });
});

describe("inventory helpers", () => {
  it("weighted average cost", () => {
    expect(nextAvgCost(10, 1000, 10, 2000)).toBe(1500);
    expect(nextAvgCost(0, null, 5, 1234)).toBe(1234);
  });
  it("markup and margin", () => {
    expect(markupMargin(1000, 4000)).toEqual({ markupPct: 300, marginPct: 75 });
  });
});
