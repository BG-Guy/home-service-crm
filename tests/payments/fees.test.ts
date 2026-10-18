// Fee split base vs tip (SPEC §10.2), surcharge caps (M09 ⚖️), tips, balance math
// including a lost dispute recorded as a refund.
import { describe, expect, it } from "vitest";
import {
  cashPriceCents,
  configuredFee,
  effectiveSurchargeBps,
  invoiceBalanceCents,
  splitActualFee,
  surchargeBlocked,
  surchargeCapBps,
  surchargeCents,
  tipForPreset,
} from "@/features/payments/engine/fees";

describe("fee split (§10.2)", () => {
  it("actual: fee_on_base = round(fee × amount/(amount+tip)), tip gets the rest", () => {
    // §10.4 case A: $400 + $20 tip, fee $12.60 → base 12.00, tip 0.60
    expect(
      splitActualFee({ amountCents: 40_000, tipCents: 2_000, feeCents: 1_260 }),
    ).toEqual({ feeOnBaseCents: 1_200, feeOnTipCents: 60 });
    // rounding: 333.33 + 5.01, fee 10.15
    const r = splitActualFee({
      amountCents: 33_333,
      tipCents: 501,
      feeCents: 1_015,
    });
    expect(r.feeOnBaseCents + r.feeOnTipCents).toBe(1_015);
    expect(r.feeOnBaseCents).toBe(1_000);
  });
  it("no tip → all on base", () => {
    expect(
      splitActualFee({ amountCents: 25_000, tipCents: 0, feeCents: 750 }),
    ).toEqual({ feeOnBaseCents: 750, feeOnTipCents: 0 });
  });
  it("configured: base and tip rounded separately", () => {
    expect(
      configuredFee({ amountCents: 40_000, tipCents: 2_000, bps: 300 }),
    ).toEqual({ feeCents: 1_260, feeOnBaseCents: 1_200, feeOnTipCents: 60 });
    // §10.4 case E: 333.33 × 3 % = 10.00 (999.99 → 1000)
    expect(
      configuredFee({ amountCents: 33_333, tipCents: 501, bps: 300 }),
    ).toEqual({ feeCents: 1_015, feeOnBaseCents: 1_000, feeOnTipCents: 15 });
    expect(configuredFee({ amountCents: 10_000, tipCents: 0, bps: 0 })).toEqual(
      { feeCents: 0, feeOnBaseCents: 0, feeOnTipCents: 0 },
    );
  });
});

describe("⚖️ surcharge caps", () => {
  it("blocked in CT and MA, 2 % in CO, 3 % elsewhere", () => {
    expect(surchargeCapBps("CT")).toBe(0);
    expect(surchargeCapBps("ma")).toBe(0);
    expect(surchargeCapBps("CO")).toBe(200);
    expect(surchargeCapBps("TX")).toBe(300);
    expect(surchargeCapBps(null)).toBe(300);
    expect(surchargeBlocked("CT")).toBe(true);
    expect(surchargeBlocked("TX")).toBe(false);
  });
  it("configured rate is capped by state", () => {
    expect(effectiveSurchargeBps(350, "TX")).toBe(300);
    expect(effectiveSurchargeBps(300, "CO")).toBe(200);
    expect(effectiveSurchargeBps(250, "CT")).toBe(0);
    expect(effectiveSurchargeBps(150, "TX")).toBe(150);
  });
  it("credit only", () => {
    const i = { amountCents: 10_000, configuredBps: 300, state: "TX" };
    expect(surchargeCents({ ...i, funding: "credit" })).toBe(300);
    expect(surchargeCents({ ...i, funding: "debit" })).toBe(0);
    expect(surchargeCents({ ...i, funding: "prepaid" })).toBe(0);
    expect(surchargeCents({ ...i, funding: "unknown" })).toBe(300);
    expect(surchargeCents({ ...i, state: "MA", funding: "credit" })).toBe(0);
  });
});

describe("tips and cash price", () => {
  it("tips are not calculated on fee lines by default", () => {
    expect(
      tipForPreset({ amountCents: 20_000, feeLinesCents: 8_900, pct: 15 }),
    ).toBe(1_665);
    expect(
      tipForPreset({
        amountCents: 20_000,
        feeLinesCents: 8_900,
        pct: 15,
        tipOnFees: true,
      }),
    ).toBe(3_000);
    expect(tipForPreset({ amountCents: 5_000, feeLinesCents: 0, pct: 0 })).toBe(
      0,
    );
  });
  it("cash price under the cash-discount policy", () => {
    expect(cashPriceCents(10_000, 300)).toBe(9_700);
    expect(cashPriceCents(10_000, 0)).toBe(10_000);
  });
});

describe("balance math (mirrors invoice_balances)", () => {
  it("total − paid + refunds − credits; tips never count", () => {
    expect(
      invoiceBalanceCents({
        totalCents: 60_000,
        payments: [
          { amountCents: 15_000, status: "succeeded" },
          { amountCents: 45_000, status: "succeeded" },
          { amountCents: 9_999, status: "failed" },
        ],
        refunds: [],
      }).balanceCents,
    ).toBe(0);
  });
  it("partial refund re-opens part of the balance", () => {
    expect(
      invoiceBalanceCents({
        totalCents: 30_000,
        payments: [{ amountCents: 30_000, status: "partially_refunded" }],
        refunds: [
          { amountCents: 5_000, status: "succeeded" },
          { amountCents: 2_500, status: "scheduled" },
        ],
      }),
    ).toEqual({ paidCents: 30_000, refundedCents: 5_000, balanceCents: 5_000 });
  });
  it("refunds count up to the payment's amount (a refunded tip never re-opens more)", () => {
    expect(
      invoiceBalanceCents({
        totalCents: 10_000,
        payments: [{ id: "p1", amountCents: 10_000, status: "refunded" }],
        refunds: [
          { paymentId: "p1", amountCents: 10_000, status: "succeeded" },
          { paymentId: "p1", amountCents: 2_000, status: "succeeded" },
        ],
      }),
    ).toEqual({
      paidCents: 10_000,
      refundedCents: 10_000,
      balanceCents: 10_000,
    });
  });
  it("a LOST dispute is a succeeded refund (reason dispute_lost) → balance due again", () => {
    const b = invoiceBalanceCents({
      totalCents: 60_000,
      payments: [{ amountCents: 60_000, status: "disputed" }],
      refunds: [{ amountCents: 60_000, status: "succeeded" }],
    });
    expect(b.balanceCents).toBe(60_000);
    // while the dispute is open, the payment still counts as paid
    expect(
      invoiceBalanceCents({
        totalCents: 60_000,
        payments: [{ amountCents: 60_000, status: "disputed" }],
        refunds: [],
      }).balanceCents,
    ).toBe(0);
  });
  it("credit notes reduce the balance", () => {
    expect(
      invoiceBalanceCents({
        totalCents: 10_000,
        payments: [],
        refunds: [],
        creditedCents: 2_500,
      }).balanceCents,
    ).toBe(7_500);
  });
});
