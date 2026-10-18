// ★ Golden: Readiness Score (SPEC §11.2). n/a = full credit; photo knock-on when
// the photos / before_after flags are off; transition-control knock-ons (M11).
import { describe, expect, it } from "vitest";
import { evaluateControls } from "@/features/disputes/controls";
import {
  type ReadinessFacts,
  readinessBand,
  scoreReadiness,
} from "@/features/disputes/readiness";

function facts(over: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    signedEstimateWithPolicies: true,
    estimateApplicable: true,
    completionSigned: true,
    photosEnabled: true,
    beforePhotos: 2,
    afterPhotos: 2,
    arrivedGeostamp: true,
    completedGeostamp: true,
    changeOrdersTotal: 0,
    changeOrdersSigned: 0,
    changeOrderRequired: false,
    paymentsCount: 1,
    receiptsDelivered: 1,
    customerMessages: 3,
    cardPayments: 1,
    strongAuthPayments: 1,
    ...over,
  };
}

const item = (f: ReadinessFacts, key: string) =>
  scoreReadiness(f).items.find((i) => i.key === key);

describe("readiness score", () => {
  it("everything earned → 100", () => {
    expect(scoreReadiness(facts()).score).toBe(100);
  });

  it("nothing earned, everything applicable → 0", () => {
    const r = scoreReadiness(
      facts({
        signedEstimateWithPolicies: false,
        completionSigned: false,
        beforePhotos: 0,
        afterPhotos: 0,
        arrivedGeostamp: false,
        completedGeostamp: false,
        changeOrdersTotal: 1,
        changeOrdersSigned: 0,
        receiptsDelivered: 0,
        customerMessages: 0,
        strongAuthPayments: 0,
      }),
    );
    expect(r.score).toBe(0);
  });

  it("each item carries its SPEC weight (25/20/15/10/10/10/5/5)", () => {
    const missing = (over: Partial<ReadinessFacts>) =>
      100 - scoreReadiness(facts(over)).score;
    expect(missing({ signedEstimateWithPolicies: false })).toBe(25);
    expect(missing({ completionSigned: false })).toBe(20);
    expect(missing({ afterPhotos: 1 })).toBe(15);
    expect(missing({ completedGeostamp: false })).toBe(10);
    expect(missing({ changeOrdersTotal: 2, changeOrdersSigned: 1 })).toBe(10);
    expect(missing({ paymentsCount: 2, receiptsDelivered: 1 })).toBe(10);
    expect(missing({ customerMessages: 0 })).toBe(5);
    expect(missing({ strongAuthPayments: 0 })).toBe(5);
  });

  it("n/a items earn full credit", () => {
    // cash-only job: strong auth n/a
    const cash = facts({ cardPayments: 0, strongAuthPayments: 0 });
    expect(item(cash, "strong_auth")).toMatchObject({
      applicable: false,
      earned: true,
    });
    expect(scoreReadiness(cash).score).toBe(100);
    // no change order needed
    expect(item(facts(), "change_orders_signed")).toMatchObject({
      applicable: false,
      earned: true,
    });
    // no payments yet: receipt n/a
    expect(
      item(
        facts({ paymentsCount: 0, receiptsDelivered: 0 }),
        "receipt_delivered",
      ),
    ).toMatchObject({ applicable: false, earned: true });
    // small service call: estimate n/a
    expect(
      scoreReadiness(
        facts({ estimateApplicable: false, signedEstimateWithPolicies: false }),
      ).score,
    ).toBe(100);
  });

  it("photo knock-on: flags off → before/after item n/a (full credit)", () => {
    const off = facts({
      photosEnabled: false,
      beforePhotos: 0,
      afterPhotos: 0,
    });
    expect(item(off, "before_after_photos")).toMatchObject({
      applicable: false,
      earned: true,
    });
    expect(scoreReadiness(off).score).toBe(100);
    // flags on, no photos → 85
    expect(
      scoreReadiness(facts({ beforePhotos: 0, afterPhotos: 0 })).score,
    ).toBe(85);
  });

  it("needs ≥ 2 before AND ≥ 2 after", () => {
    expect(
      item(facts({ beforePhotos: 1 }), "before_after_photos")?.earned,
    ).toBe(false);
    expect(
      item(facts({ beforePhotos: 5, afterPhotos: 2 }), "before_after_photos")
        ?.earned,
    ).toBe(true);
  });

  it("a required change order makes the CO item applicable and missing", () => {
    expect(
      item(facts({ changeOrderRequired: true }), "change_orders_signed"),
    ).toMatchObject({ applicable: true, earned: false });
  });

  it("rounds to the nearest integer (half up)", () => {
    // weights total 100 by default; custom weights exercise rounding: 2/3 → 67
    const r = scoreReadiness(facts({ completionSigned: false }), {
      signed_estimate: 1,
      completion_signed: 1,
      before_after_photos: 1,
      geostamps: 0,
      change_orders_signed: 0,
      receipt_delivered: 0,
      comms_log: 0,
      strong_auth: 0,
    });
    expect(r.score).toBe(67);
  });

  it("ring bands: red < 50, amber 50–79, green ≥ 80", () => {
    expect(readinessBand(49)).toBe("red");
    expect(readinessBand(50)).toBe("amber");
    expect(readinessBand(79)).toBe("amber");
    expect(readinessBand(80)).toBe("green");
  });
});

describe("transition controls knock-ons", () => {
  const base = {
    band: "medium" as const,
    enforceBandControls: true,
    photosEnabled: true,
    depositsEnabled: true,
    serviceType: null,
    hasSignedAuthorization: true,
    beforePhotos: 0,
    afterPhotos: 0,
    completionSigned: false,
    depositSatisfied: false,
    depositOutstanding: false,
    startApproved: false,
    prepaid: false,
    criticalControl: "approval" as const,
    changeOrderRequired: false,
  };

  it("medium: min photo set before Complete", () => {
    const r = evaluateControls({ ...base, to: "completed" });
    expect(r.missing.map((m) => m.key)).toEqual([
      "photos_before",
      "photos_after",
    ]);
  });

  it("medium with photos off → completion signature replaces the photo control", () => {
    const r = evaluateControls({
      ...base,
      to: "completed",
      photosEnabled: false,
    });
    expect(r.missing.map((m) => m.key)).toEqual(["completion_signature"]);
    expect(
      evaluateControls({
        ...base,
        to: "completed",
        photosEnabled: false,
        completionSigned: true,
      }).ok,
    ).toBe(true);
  });

  it("high: deposit before start; signature + photos before complete", () => {
    const start = evaluateControls({
      ...base,
      band: "high",
      to: "in_progress",
    });
    expect(start.missing.map((m) => m.key)).toEqual(["deposit"]);
    expect(
      evaluateControls({
        ...base,
        band: "high",
        to: "in_progress",
        depositsEnabled: false,
      }).ok,
    ).toBe(true);
    const done = evaluateControls({
      ...base,
      band: "high",
      to: "completed",
      beforePhotos: 1,
      afterPhotos: 1,
    });
    expect(done.missing.map((m) => m.key)).toEqual(["completion_signature"]);
  });

  it("critical: approval or prepay to start (not overridable)", () => {
    const r = evaluateControls({
      ...base,
      band: "critical",
      to: "in_progress",
      depositSatisfied: true,
    });
    expect(r.missing).toEqual([
      expect.objectContaining({
        key: "start_approval",
        overridable: false,
        action: "request_start_approval",
      }),
    ]);
    expect(
      evaluateControls({
        ...base,
        band: "critical",
        to: "in_progress",
        depositSatisfied: true,
        startApproved: true,
      }).ok,
    ).toBe(true);
    expect(
      evaluateControls({
        ...base,
        band: "critical",
        to: "in_progress",
        depositSatisfied: true,
        criticalControl: "cash_only",
      }).ok,
    ).toBe(true);
  });

  it("service-type photo requirements are ignored when photos are off", () => {
    const st = {
      requiresSignedEstimate: false,
      photosRequiredBefore: 3,
      photosRequiredAfter: 3,
    };
    expect(
      evaluateControls({
        ...base,
        band: "low",
        to: "in_progress",
        serviceType: st,
      }).missing.map((m) => m.key),
    ).toEqual(["photos_before"]);
    expect(
      evaluateControls({
        ...base,
        band: "low",
        to: "in_progress",
        serviceType: st,
        photosEnabled: false,
      }).ok,
    ).toBe(true);
  });

  it("unsigned estimate blocks Complete at medium; change order required blocks too", () => {
    const r = evaluateControls({
      ...base,
      to: "completed",
      hasSignedAuthorization: false,
      beforePhotos: 1,
      afterPhotos: 1,
      changeOrderRequired: true,
    });
    expect(r.missing.map((m) => m.key)).toEqual([
      "signed_estimate",
      "change_order",
    ]);
  });
});
