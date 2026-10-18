// ★ Cash custody formula (SPEC M16): held = cash + checks − confirmed remittances −
// cash netted in frozen settlements. Checks are never netted.
import { describe, expect, it } from "vitest";
import {
  custodyAlert,
  custodyBalance,
  remittanceCredit,
} from "@/features/payroll/engine/custody";

const d = (s: string) => new Date(`${s}T15:00:00Z`);

describe("custody balance", () => {
  it("sums cash and checks collected", () => {
    const r = custodyBalance({
      collections: [
        { method: "cash", amountCents: 30000, at: d("2026-10-10") },
        { method: "check", amountCents: 12000, at: d("2026-10-11") },
      ],
      confirmedRemittancesCents: 0,
      nettedInSettlementsCents: 0,
    });
    expect(r.heldCents).toBe(42000);
    expect(r.oldestAt?.toISOString().slice(0, 10)).toBe("2026-10-10");
  });

  it("netting consumes cash only — checks are never netted", () => {
    const r = custodyBalance({
      collections: [
        { method: "cash", amountCents: 30000, at: d("2026-10-10") },
        { method: "check", amountCents: 12000, at: d("2026-10-11") },
      ],
      confirmedRemittancesCents: 0,
      nettedInSettlementsCents: 50000,
    });
    expect(r.cashHeldCents).toBe(0);
    expect(r.checksHeldCents).toBe(12000);
    expect(r.heldCents).toBe(12000);
    expect(r.oldestAt?.toISOString().slice(0, 10)).toBe("2026-10-11");
  });

  it("remittances settle checks first, then cash", () => {
    const r = custodyBalance({
      collections: [
        { method: "cash", amountCents: 30000, at: d("2026-10-10") },
        { method: "check", amountCents: 12000, at: d("2026-10-11") },
      ],
      confirmedRemittancesCents: 20000,
      nettedInSettlementsCents: 0,
    });
    expect(r.checksHeldCents).toBe(0);
    expect(r.cashHeldCents).toBe(22000);
    expect(r.heldCents).toBe(22000);
  });

  it("pay credit for remitted cash that payroll already deducted", () => {
    // 300 cash netted, 100 check outstanding; hands in 400 → 300 credited back.
    expect(
      remittanceCredit({
        remittanceCents: 40000,
        checksCollectedCents: 10000,
        priorRemittedCents: 0,
        priorCreditsCents: 0,
        cashNettedCents: 30000,
      }),
    ).toBe(30000);
    // hands in only the check → no credit
    expect(
      remittanceCredit({
        remittanceCents: 10000,
        checksCollectedCents: 10000,
        priorRemittedCents: 0,
        priorCreditsCents: 0,
        cashNettedCents: 30000,
      }),
    ).toBe(0);
    // separate remittance (nothing netted) → never credited
    expect(
      remittanceCredit({
        remittanceCents: 30000,
        checksCollectedCents: 0,
        priorRemittedCents: 0,
        priorCreditsCents: 0,
        cashNettedCents: 0,
      }),
    ).toBe(0);
  });

  it("alerts over the limit or when cash is older than remit_within_days", () => {
    const now = d("2026-10-15");
    const limits = { maxCashHeldCents: 150000, remitWithinDays: 3 };
    expect(
      custodyAlert(
        { heldCents: 160000, oldestAt: d("2026-10-14") },
        limits,
        now,
      ),
    ).toMatchObject({ over: true, reason: "amount" });
    expect(
      custodyAlert(
        { heldCents: 10000, oldestAt: d("2026-10-10") },
        limits,
        now,
      ),
    ).toMatchObject({ over: true, reason: "age", oldestDays: 5 });
    expect(
      custodyAlert({ heldCents: 10000, oldestAt: d("2026-10-14") }, limits, now)
        .over,
    ).toBe(false);
  });
});

describe("net-in-payout techs: only checks are nagged (QA T6-12)", () => {
  const limits = { maxCashHeldCents: 150000, remitWithinDays: 3 };
  const now = d("2026-10-20");
  const collections = [
    { method: "cash" as const, amountCents: 180000, at: d("2026-10-10") },
    { method: "check" as const, amountCents: 12000, at: d("2026-10-18") },
    { method: "check" as const, amountCents: 8000, at: d("2026-10-19") },
  ];

  it("tracks the oldest outstanding check separately", () => {
    const r = custodyBalance({
      collections,
      confirmedRemittancesCents: 0,
      nettedInSettlementsCents: 0,
    });
    expect(r.oldestAt?.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(r.oldestCheckAt?.toISOString().slice(0, 10)).toBe("2026-10-18");
    // $1,800 cash kept 10 days: a hand-in tech is over the limit…
    expect(custodyAlert(r, limits, now).over).toBe(true);
    // …a net-in-payout tech (cash comes off pay) holds $200 of checks, 2 days old.
    expect(
      custodyAlert(
        { heldCents: r.checksHeldCents, oldestAt: r.oldestCheckAt },
        limits,
        now,
      ).over,
    ).toBe(false);
  });

  it("a remittance covers the oldest check first", () => {
    const r = custodyBalance({
      collections,
      confirmedRemittancesCents: 12000,
      nettedInSettlementsCents: 0,
    });
    expect(r.checksHeldCents).toBe(8000);
    expect(r.oldestCheckAt?.toISOString().slice(0, 10)).toBe("2026-10-19");
  });

  it("no checks outstanding → no check date", () => {
    const r = custodyBalance({
      collections: collections.slice(0, 1),
      confirmedRemittancesCents: 0,
      nettedInSettlementsCents: 0,
    });
    expect(r.oldestCheckAt).toBeNull();
  });
});
