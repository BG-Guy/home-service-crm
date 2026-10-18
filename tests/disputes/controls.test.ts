import { describe, expect, it } from "vitest";
import {
  type ControlFacts,
  evaluateControls,
} from "@/features/disputes/controls";

const base: ControlFacts = {
  to: "completed",
  band: "low",
  enforceBandControls: true,
  photosEnabled: true,
  depositsEnabled: true,
  serviceType: null,
  hasSignedAuthorization: false,
  beforePhotos: 0,
  afterPhotos: 0,
  completionSigned: false,
  depositSatisfied: false,
  depositOutstanding: false,
  startApproved: false,
  prepaid: false,
  criticalControl: "approval",
  changeOrderRequired: false,
};
const keys = (f: Partial<ControlFacts>) =>
  evaluateControls({ ...base, ...f }).missing.map((m) => m.key);

describe("transition controls (§11.1 bands, §M11 knock-ons)", () => {
  it("low risk, no service rules → nothing required", () => {
    expect(evaluateControls(base)).toEqual({ ok: true, missing: [] });
  });

  it("medium: signed estimate + ≥1 before and ≥1 after before Complete", () => {
    expect(keys({ band: "medium" })).toEqual([
      "signed_estimate",
      "photos_before",
      "photos_after",
    ]);
    expect(
      keys({
        band: "medium",
        hasSignedAuthorization: true,
        beforePhotos: 1,
        afterPhotos: 1,
      }),
    ).toEqual([]);
  });

  it("photos off → the photo control becomes the completion signature", () => {
    expect(
      keys({
        band: "medium",
        photosEnabled: false,
        hasSignedAuthorization: true,
      }),
    ).toEqual(["completion_signature"]);
  });

  it("high: deposit or hold before Start; completion signature at Complete", () => {
    expect(keys({ band: "high", to: "in_progress" })).toEqual(["deposit"]);
    expect(
      keys({ band: "high", to: "in_progress", depositSatisfied: true }),
    ).toEqual([]);
    expect(
      keys({
        band: "high",
        hasSignedAuthorization: true,
        beforePhotos: 1,
        afterPhotos: 1,
      }),
    ).toEqual(["completion_signature"]);
  });

  it("critical: approval (not overridable) unless approved or prepaid", () => {
    const m = evaluateControls({
      ...base,
      band: "critical",
      to: "in_progress",
      depositSatisfied: true,
    }).missing;
    expect(m.map((x) => x.key)).toEqual(["start_approval"]);
    expect(m[0]?.overridable).toBe(false);
    expect(
      keys({
        band: "critical",
        to: "in_progress",
        depositSatisfied: true,
        prepaid: true,
      }),
    ).toEqual([]);
    expect(
      keys({
        band: "critical",
        to: "in_progress",
        depositSatisfied: true,
        criticalControl: "cash_only",
      }),
    ).toEqual([]);
  });

  it("enforcement off → only service-type rules apply", () => {
    expect(
      keys({
        band: "critical",
        enforceBandControls: false,
        serviceType: {
          requiresSignedEstimate: true,
          photosRequiredBefore: 2,
          photosRequiredAfter: 2,
        },
        beforePhotos: 2,
        afterPhotos: 1,
      }),
    ).toEqual(["signed_estimate", "photos_after"]);
  });

  it("deposits flag off → no deposit control", () => {
    expect(
      keys({ band: "high", to: "in_progress", depositsEnabled: false }),
    ).toEqual([]);
  });

  it("change order required blocks Complete", () => {
    expect(keys({ changeOrderRequired: true })).toEqual(["change_order"]);
  });
});
