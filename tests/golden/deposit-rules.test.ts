// ★ Golden: deposit rules engine (SPEC M09). Priority, each trigger and amount type,
// rounding to $5, min/max, caps, hold window and the manual fallback.
import { describe, expect, it } from "vitest";
import {
  type DepositFacts,
  type DepositRuleLike,
  depositAmount,
  depositCapWarning,
  evaluateDepositRules,
  roundToStep,
  triggerMatches,
} from "@/features/payments/engine/deposit-rules";

function facts(over: Partial<DepositFacts> = {}): DepositFacts {
  return {
    totalCents: 80_000,
    partsCents: 30_000,
    specialOrderPartsCents: 0,
    afterHours: false,
    newCustomer: false,
    riskBand: "low",
    scheduledDaysOut: 3,
    serviceTypeId: "st-1",
    leadSourceId: "ls-1",
    customerFlags: { prepayRequired: false, disputeHistory: false },
    contractKind: "repair",
    ...over,
  };
}

function rule(over: Partial<DepositRuleLike> = {}): DepositRuleLike {
  return {
    id: "r1",
    name: "Rule",
    priority: 10,
    active: true,
    trigger: { type: "always" },
    amount: { type: "percent_total", value: 25 },
    mode: "capture",
    policyVersionId: null,
    ...over,
  };
}

const opts = { hasProcessor: true };

describe("triggers", () => {
  const t = (trigger: DepositRuleLike["trigger"], f = facts()) =>
    triggerMatches(trigger, f);
  it("always", () => expect(t({ type: "always" })).toBe(true));
  it("estimate_total_gte", () => {
    expect(t({ type: "estimate_total_gte", value: 80_000 })).toBe(true);
    expect(t({ type: "estimate_total_gte", value: 80_001 })).toBe(false);
  });
  it("has_special_order_parts", () => {
    expect(t({ type: "has_special_order_parts" })).toBe(false);
    expect(
      t(
        { type: "has_special_order_parts" },
        facts({ specialOrderPartsCents: 1 }),
      ),
    ).toBe(true);
  });
  it("after_hours / new_customer", () => {
    expect(t({ type: "after_hours" }, facts({ afterHours: true }))).toBe(true);
    expect(t({ type: "after_hours" })).toBe(false);
    expect(t({ type: "new_customer" }, facts({ newCustomer: true }))).toBe(
      true,
    );
  });
  it("risk_band_gte", () => {
    const r = { type: "risk_band_gte" as const, value: "high" };
    expect(t(r, facts({ riskBand: "medium" }))).toBe(false);
    expect(t(r, facts({ riskBand: "high" }))).toBe(true);
    expect(t(r, facts({ riskBand: "critical" }))).toBe(true);
    expect(t(r, facts({ riskBand: null }))).toBe(false);
  });
  it("scheduled_days_out_gte", () => {
    const r = { type: "scheduled_days_out_gte" as const, value: 14 };
    expect(t(r, facts({ scheduledDaysOut: 13 }))).toBe(false);
    expect(t(r, facts({ scheduledDaysOut: 14 }))).toBe(true);
    expect(t(r, facts({ scheduledDaysOut: null }))).toBe(false);
  });
  it("service_type_in / lead_source_in (array or CSV)", () => {
    expect(t({ type: "service_type_in", value: ["st-2", "st-1"] })).toBe(true);
    expect(t({ type: "service_type_in", value: "st-2, st-3" })).toBe(false);
    expect(t({ type: "lead_source_in", value: ["ls-1"] })).toBe(true);
  });
  it("customer_flag (prepay_required default, dispute_history)", () => {
    expect(t({ type: "customer_flag" })).toBe(false);
    expect(
      t(
        { type: "customer_flag", value: "prepay_required" },
        facts({
          customerFlags: { prepayRequired: true, disputeHistory: false },
        }),
      ),
    ).toBe(true);
    expect(
      t(
        { type: "customer_flag", value: "dispute_history" },
        facts({
          customerFlags: { prepayRequired: false, disputeHistory: true },
        }),
      ),
    ).toBe(true);
  });
});

describe("amounts", () => {
  it("fixed", () => {
    expect(
      depositAmount(rule({ amount: { type: "fixed", value: 7_500 } }), facts()),
    ).toBe(7_500);
  });
  it("percent_total rounds to $5 (half away)", () => {
    // 25 % of $803.00 = $200.75 → $200.00; of $810.00 = $202.50 → $205.00
    expect(depositAmount(rule(), facts({ totalCents: 80_300 }))).toBe(20_000);
    expect(depositAmount(rule(), facts({ totalCents: 81_000 }))).toBe(20_500);
  });
  it("percent_parts uses part lines (special-order parts for that trigger)", () => {
    expect(
      depositAmount(
        rule({ amount: { type: "percent_parts", value: 50 } }),
        facts(),
      ),
    ).toBe(15_000);
    expect(
      depositAmount(
        rule({
          trigger: { type: "has_special_order_parts" },
          amount: { type: "percent_parts", value: 50 },
        }),
        facts({ specialOrderPartsCents: 21_000 }),
      ),
    ).toBe(10_500);
  });
  it("parts_plus_percent = parts + % of the rest", () => {
    // special-order $400 on an $800 job, +10 % of $400 = $440
    expect(
      depositAmount(
        rule({
          trigger: { type: "has_special_order_parts" },
          amount: { type: "parts_plus_percent", value: 10 },
        }),
        facts({ specialOrderPartsCents: 40_000 }),
      ),
    ).toBe(44_000);
  });
  it("min / max and never above the ticket", () => {
    const r = rule({
      amount: {
        type: "percent_total",
        value: 10,
        min_cents: 5_000,
        max_cents: 20_000,
      },
    });
    expect(depositAmount(r, facts({ totalCents: 10_000 }))).toBe(5_000);
    expect(depositAmount(r, facts({ totalCents: 900_000 }))).toBe(20_000);
    expect(
      depositAmount(
        rule({ amount: { type: "fixed", value: 50_000 } }),
        facts({ totalCents: 30_000 }),
      ),
    ).toBe(30_000);
  });
  it("custom rounding step", () => {
    expect(roundToStep(12_345, 100)).toBe(12_300);
    expect(roundToStep(12_350, 100)).toBe(12_400);
    expect(roundToStep(12_345, 1)).toBe(12_345);
    expect(
      depositAmount(
        rule({
          amount: { type: "percent_total", value: 25, round_to_cents: 1 },
        }),
        facts({ totalCents: 80_300 }),
      ),
    ).toBe(20_075);
  });
});

describe("evaluateDepositRules", () => {
  it("priority order, first match wins; inactive rules skipped", () => {
    const rules = [
      rule({ id: "b", name: "B", priority: 20 }),
      rule({
        id: "a",
        name: "A",
        priority: 10,
        trigger: { type: "after_hours" },
        amount: { type: "fixed", value: 5_000 },
      }),
      rule({ id: "z", name: "Z", priority: 1, active: false }),
    ];
    expect(evaluateDepositRules(rules, facts(), opts)?.ruleId).toBe("b");
    expect(
      evaluateDepositRules(rules, facts({ afterHours: true }), opts),
    ).toMatchObject({ ruleId: "a", amountCents: 5_000, mode: "capture" });
  });

  it("no matching rule → null", () => {
    expect(
      evaluateDepositRules(
        [rule({ trigger: { type: "new_customer" } })],
        facts(),
        opts,
      ),
    ).toBeNull();
  });

  it("no processor → capture/hold/card_on_file fall back to manual", () => {
    for (const mode of ["capture", "hold", "card_on_file"]) {
      expect(
        evaluateDepositRules([rule({ mode })], facts(), {
          hasProcessor: false,
        }),
      ).toMatchObject({ mode: "manual", fellBackToManual: true });
    }
    expect(
      evaluateDepositRules([rule({ mode: "manual" })], facts(), {
        hasProcessor: false,
      }),
    ).toMatchObject({ mode: "manual", fellBackToManual: false });
  });

  it("holds only for jobs ≤ 5 days out (else capture)", () => {
    const r = [rule({ mode: "hold" })];
    expect(
      evaluateDepositRules(r, facts({ scheduledDaysOut: 5 }), opts)?.mode,
    ).toBe("hold");
    expect(
      evaluateDepositRules(r, facts({ scheduledDaysOut: 6 }), opts)?.mode,
    ).toBe("capture");
    expect(
      evaluateDepositRules(r, facts({ scheduledDaysOut: null }), opts)?.mode,
    ).toBe("capture");
  });

  it("base-seed rules: special order → parts + 10 %; high risk → 25 %", () => {
    const rules = [
      rule({
        id: "so",
        name: "Special-order parts",
        priority: 10,
        trigger: { type: "has_special_order_parts" },
        amount: { type: "parts_plus_percent", value: 10, round_to_cents: 500 },
      }),
      rule({
        id: "hr",
        name: "High-risk jobs",
        priority: 20,
        trigger: { type: "risk_band_gte", value: "high" },
        amount: { type: "percent_total", value: 25, round_to_cents: 500 },
      }),
    ];
    expect(evaluateDepositRules(rules, facts(), opts)).toBeNull();
    expect(
      evaluateDepositRules(rules, facts({ riskBand: "high" }), opts),
    ).toMatchObject({ ruleId: "hr", amountCents: 20_000 });
    expect(
      evaluateDepositRules(
        rules,
        facts({ riskBand: "high", specialOrderPartsCents: 20_000 }),
        opts,
      ),
    ).toMatchObject({ ruleId: "so", amountCents: 26_000 });
  });
});

describe("⚖️ state cap warnings (improvement contracts only)", () => {
  const imp = (over: Partial<DepositFacts> = {}) =>
    facts({ contractKind: "improvement", ...over });
  it("repair contracts never warn", () => {
    expect(depositCapWarning(90_000, facts(), "CA")).toBeNull();
  });
  it("CA: ≤ min($1,000, 10 %)", () => {
    expect(depositCapWarning(8_000, imp(), "CA")).toBeNull();
    expect(depositCapWarning(8_001, imp(), "CA")).toMatch(/California/);
    expect(
      depositCapWarning(100_001, imp({ totalCents: 5_000_000 }), "CA"),
    ).toMatch(/California/);
  });
  it("MA: over $1,000 ≤ max(1/3, special-order cost)", () => {
    expect(depositCapWarning(50_000, imp(), "MA")).toBeNull(); // ≤ $1,000 contract
    const big = imp({ totalCents: 300_000, specialOrderPartsCents: 150_000 });
    expect(depositCapWarning(150_000, big, "MA")).toBeNull();
    expect(depositCapWarning(150_001, big, "MA")).toMatch(/Massachusetts/);
  });
  it("MD: ≤ 1/3", () => {
    expect(depositCapWarning(26_666, imp(), "MD")).toBeNull();
    expect(depositCapWarning(26_667, imp(), "MD")).toMatch(/Maryland/);
  });
  it("FL: > 10 % → permit reminder", () => {
    expect(depositCapWarning(8_000, imp(), "FL")).toBeNull();
    expect(depositCapWarning(8_001, imp(), "FL")).toMatch(/Florida/);
  });
  it("evaluate attaches the warning unless warnings are off", () => {
    const rules = [rule()];
    expect(
      evaluateDepositRules(rules, imp(), { ...opts, state: "CA" })?.capWarning,
    ).toMatch(/California/);
    expect(
      evaluateDepositRules(rules, imp(), {
        ...opts,
        state: "CA",
        capWarnings: false,
      })?.capWarning,
    ).toBeNull();
  });
});
