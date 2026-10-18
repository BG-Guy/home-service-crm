// ★ Golden: Job Risk Score (SPEC §11.1). Every signal, band thresholds, the
// no_estimate_min_ticket gate, strong_auth / repeat negatives, and the clamp.
import { describe, expect, it } from "vitest";
import {
  bandFor,
  namesMatch,
  RISK_DEFAULT_WEIGHTS,
  type RiskFacts,
  scoreRisk,
} from "@/features/disputes/risk";

const NOW = new Date("2026-10-15T15:00:00Z");

/** A neutral fact set that scores exactly 0 (repeat customer offsets nothing). */
function facts(over: Partial<RiskFacts> = {}): RiskFacts {
  return {
    ticketCents: 20_000,
    hasSignedAuthorization: false,
    overageUnsigned: false,
    payments: [],
    customerName: "Jane Smith",
    siteContactName: null,
    afterHours: false,
    emergency: false,
    hasPremiumLine: false,
    hasUpsellLine: false,
    priorCompletedJobs: 1,
    priorPaidUndisputedJobs: 1,
    leadSource: "website",
    customerDisputeHistory: false,
    fingerprintDisputed: false,
    complaint: false,
    depositTaken: false,
    scheduledStart: null,
    now: NOW,
    ...over,
  };
}

const keys = (f: RiskFacts) => scoreRisk(f).signals.map((s) => s.key);
const card = (o: Partial<RiskFacts["payments"][number]> = {}) => ({
  status: "succeeded",
  entryMode: "online",
  payerName: null,
  avsResult: "pass",
  cardCountry: "US",
  threeDs: null,
  ...o,
});

describe("risk signals (each in isolation)", () => {
  it("baseline scores 0 / low", () => {
    const r = scoreRisk(facts());
    expect(r).toMatchObject({ score: 0, band: "low", signals: [] });
  });

  it("keyed_card +25 (payment or intended)", () => {
    expect(
      scoreRisk(facts({ payments: [card({ entryMode: "keyed" })] })).score,
    ).toBe(25);
    expect(scoreRisk(facts({ intendedKeyed: true })).score).toBe(25);
  });

  it("payer_mismatch +15 unless the payer matches customer or site contact", () => {
    expect(
      scoreRisk(facts({ payments: [card({ payerName: "Bob Jones" })] })).score,
    ).toBe(15);
    expect(
      keys(facts({ payments: [card({ payerName: "J. Smith" })] })),
    ).not.toContain("payer_mismatch");
    expect(
      keys(
        facts({
          siteContactName: "Bob Jones",
          payments: [card({ payerName: "Robert Jones" })],
        }),
      ),
    ).not.toContain("payer_mismatch");
  });

  it("ticket_1000 +15 / ticket_3000 +25 (higher only, strictly greater)", () => {
    const t = (c: number) =>
      scoreRisk(facts({ ticketCents: c, hasSignedAuthorization: true }));
    expect(t(100_000).score).toBe(0);
    expect(t(100_001).signals.map((s) => s.key)).toEqual(["ticket_1000"]);
    expect(t(300_000).score).toBe(15);
    expect(t(300_001).signals.map((s) => s.key)).toEqual(["ticket_3000"]);
    expect(t(300_001).score).toBe(25);
  });

  it("no_signed_estimate +30 only at or above the min ticket (default $250)", () => {
    expect(scoreRisk(facts({ ticketCents: 24_999 })).score).toBe(0);
    expect(scoreRisk(facts({ ticketCents: 25_000 })).score).toBe(30);
    expect(
      scoreRisk(facts({ ticketCents: 25_000, hasSignedAuthorization: true }))
        .score,
    ).toBe(0);
    // admin-editable gate
    expect(
      scoreRisk(facts({ ticketCents: 10_000 }), {
        noEstimateMinTicketCents: 5_000,
      }).score,
    ).toBe(30);
  });

  it("overage_unsigned +25", () => {
    expect(scoreRisk(facts({ overageUnsigned: true })).score).toBe(25);
  });

  it("after_hours +10 (after-hours flag, or emergency WITH a premium line)", () => {
    expect(scoreRisk(facts({ afterHours: true })).score).toBe(10);
    expect(scoreRisk(facts({ emergency: true })).score).toBe(0);
    expect(
      scoreRisk(facts({ emergency: true, hasPremiumLine: true })).score,
    ).toBe(10);
  });

  it("upsell +10", () => {
    expect(scoreRisk(facts({ hasUpsellLine: true })).score).toBe(10);
  });

  it("new_customer +10 / unknown_source +5", () => {
    expect(
      scoreRisk(facts({ priorCompletedJobs: 0, priorPaidUndisputedJobs: 0 }))
        .score,
    ).toBe(10);
    expect(scoreRisk(facts({ leadSource: null })).score).toBe(5);
    expect(scoreRisk(facts({ leadSource: "other" })).score).toBe(5);
    expect(scoreRisk(facts({ leadSource: undefined })).score).toBe(0);
  });

  it("avs_or_foreign +15", () => {
    expect(
      scoreRisk(facts({ payments: [card({ avsResult: "fail" })] })).score,
    ).toBe(15);
    expect(
      scoreRisk(facts({ payments: [card({ cardCountry: "GB" })] })).score,
    ).toBe(15);
  });

  it("prior_dispute +40 (customer flag or disputed fingerprint)", () => {
    expect(scoreRisk(facts({ customerDisputeHistory: true })).score).toBe(40);
    expect(scoreRisk(facts({ fingerprintDisputed: true })).score).toBe(40);
  });

  it("complaint +20", () => {
    expect(scoreRisk(facts({ complaint: true })).score).toBe(20);
  });

  it("far_future_deposit +5 when start > 30 days out", () => {
    const start = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
    expect(
      scoreRisk(facts({ depositTaken: true, scheduledStart: start(30) })).score,
    ).toBe(0);
    expect(
      scoreRisk(facts({ depositTaken: true, scheduledStart: start(31) })).score,
    ).toBe(5);
    expect(
      scoreRisk(facts({ depositTaken: false, scheduledStart: start(60) }))
        .score,
    ).toBe(0);
  });
});

describe("negative signals and clamp", () => {
  it("strong_auth −15 (tap/chip/3DS on a succeeded payment)", () => {
    const base = facts({ complaint: true }); // 20
    expect(
      scoreRisk({ ...base, payments: [card({ entryMode: "tap" })] }).score,
    ).toBe(5);
    expect(
      scoreRisk({ ...base, payments: [card({ entryMode: "chip" })] }).score,
    ).toBe(5);
    expect(
      scoreRisk({ ...base, payments: [card({ threeDs: "authenticated" })] })
        .score,
    ).toBe(5);
    // failed payments don't count
    expect(
      scoreRisk({
        ...base,
        payments: [card({ entryMode: "tap", status: "failed" })],
      }).score,
    ).toBe(20);
  });

  it("repeat_customer −10 at ≥ 2 prior paid, undisputed jobs", () => {
    const base = facts({ complaint: true, priorPaidUndisputedJobs: 2 });
    expect(scoreRisk(base).score).toBe(10);
    expect(scoreRisk({ ...base, priorPaidUndisputedJobs: 1 }).score).toBe(20);
  });

  it("clamps to 0..100", () => {
    const low = scoreRisk(
      facts({
        payments: [card({ entryMode: "tap" })],
        priorPaidUndisputedJobs: 5,
      }),
    );
    expect(low.score).toBe(0);
    expect(low.signals.map((s) => s.points)).toEqual([-15, -10]);
    const high = scoreRisk(
      facts({
        payments: [
          card({
            entryMode: "keyed",
            payerName: "Bob Jones",
            avsResult: "fail",
          }),
        ],
        ticketCents: 400_000,
        overageUnsigned: true,
        afterHours: true,
        hasUpsellLine: true,
        priorCompletedJobs: 0,
        priorPaidUndisputedJobs: 0,
        leadSource: null,
        customerDisputeHistory: true,
        complaint: true,
      }),
    );
    expect(high.score).toBe(100);
    expect(high.band).toBe("critical");
  });
});

describe("bands", () => {
  it("default thresholds 25 / 50 / 75", () => {
    expect(bandFor(0)).toBe("low");
    expect(bandFor(24)).toBe("low");
    expect(bandFor(25)).toBe("medium");
    expect(bandFor(49)).toBe("medium");
    expect(bandFor(50)).toBe("high");
    expect(bandFor(74)).toBe("high");
    expect(bandFor(75)).toBe("critical");
    expect(bandFor(100)).toBe("critical");
  });

  it("admin-edited weights and bands", () => {
    const r = scoreRisk(facts({ complaint: true }), {
      weights: { complaint: 35 },
      bands: { medium: 30, high: 60, critical: 90 },
    });
    expect(r).toMatchObject({ score: 35, band: "medium" });
    // A weight of 0 disables a signal entirely.
    expect(
      scoreRisk(facts({ complaint: true }), { weights: { complaint: 0 } })
        .signals,
    ).toEqual([]);
  });

  it("worked example: $1,200 unsigned new-customer job with upsell → high", () => {
    const r = scoreRisk(
      facts({
        ticketCents: 120_000,
        hasUpsellLine: true,
        priorCompletedJobs: 0,
        priorPaidUndisputedJobs: 0,
      }),
    );
    // 15 (ticket_1000) + 30 (no_signed_estimate) + 10 (upsell) + 10 (new) = 65
    expect(r.score).toBe(65);
    expect(r.band).toBe("high");
  });

  it("default weights table matches SPEC §11.1", () => {
    expect(RISK_DEFAULT_WEIGHTS).toEqual({
      keyed_card: 25,
      payer_mismatch: 15,
      ticket_1000: 15,
      ticket_3000: 25,
      no_signed_estimate: 30,
      overage_unsigned: 25,
      after_hours: 10,
      upsell: 10,
      new_customer: 10,
      unknown_source: 5,
      avs_or_foreign: 15,
      prior_dispute: 40,
      complaint: 20,
      far_future_deposit: 5,
      strong_auth: -15,
      repeat_customer: -10,
    });
  });
});

describe("name token match", () => {
  it("normalizes case, accents and titles", () => {
    expect(namesMatch("José Álvarez", "jose alvarez")).toBe(true);
    expect(namesMatch("Mr. Smith", "Jane Smith")).toBe(true);
    expect(namesMatch("Bob", "Jane Smith")).toBe(false);
    expect(namesMatch("", "Jane")).toBe(false);
  });
});
