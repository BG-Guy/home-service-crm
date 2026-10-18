// Golden: resolveVehicleLogPolicy (SPEC M17 resolution order) + evaluateEvidence.
import { describe, expect, it } from "vitest";
import {
  approvalHint,
  evaluateEvidence,
  odometerHintCopy,
  type PolicyUser,
  resolveVehicleLogPolicy,
  type VehiclePolicies,
} from "@/features/vehicles/rules";
import { settingsShape } from "@/features/vehicles/settings";

const SEEDED: VehiclePolicies = {
  odometer: {
    tech_can_log: true,
    approval: "auto_if_evidence",
    ai_optional: false,
  },
  fuel: {
    tech_can_log: true,
    approval: "auto_if_evidence",
    ai_optional: false,
  },
  service: {
    tech_can_log: true,
    approval: "always_review",
    ai_optional: false,
  },
  document: {
    tech_can_log: true,
    approval: "always_review",
    ai_optional: false,
  },
  inspection: { tech_can_log: true, approval: "auto", ai_optional: false },
  trip: {
    tech_can_log: true,
    approval: "auto_if_evidence",
    ai_optional: false,
  },
};

const user = (
  baseRole: PolicyUser["baseRole"],
  perms: string[],
): PolicyUser => ({ baseRole, perms: new Set(perms) });

const tech = user("tech", ["vehicles.log", "vehicles.view_own"]);
const trustedTech = user("tech", ["vehicles.log", "vehicles.log_trusted"]);
const office = user("office", ["vehicles.log", "vehicles.view_all"]);
const admin = user("admin", [
  "vehicles.log",
  "vehicles.log_approve",
  "vehicles.manage",
]);
const OK = { ok: true, pendingAi: false, missing: [] };
const MISSING = { ok: false, pendingAi: false, missing: ["photo"] };

describe("step 1: can log", () => {
  it("needs vehicles.log", () => {
    const r = resolveVehicleLogPolicy(user("tech", []), "odometer", SEEDED);
    expect(r).toMatchObject({ canLog: false, step: 1, reason: "cannot_log" });
  });
  it("tech blocked when tech_can_log is false (two-key rule)", () => {
    const p = {
      ...SEEDED,
      fuel: { ...SEEDED.fuel, tech_can_log: false },
    };
    expect(resolveVehicleLogPolicy(tech, "fuel", p).canLog).toBe(false);
    // office/admin are not techs: still allowed
    expect(resolveVehicleLogPolicy(office, "fuel", p).canLog).toBe(true);
    expect(resolveVehicleLogPolicy(admin, "fuel", p).canLog).toBe(true);
  });
});

describe("step 2: approver", () => {
  it("vehicles.log_approve holder is approved immediately, even always_review", () => {
    const r = resolveVehicleLogPolicy(admin, "document", SEEDED);
    expect(r).toMatchObject({
      status: "approved",
      step: 2,
      reason: "approver",
    });
  });
  it("approver with missing evidence is still approved", () => {
    const r = resolveVehicleLogPolicy(admin, "odometer", SEEDED, {
      evidence: MISSING,
    });
    expect(r.status).toBe("approved");
  });
});

describe("step 3: trusted override", () => {
  it("always_review becomes auto_if_evidence for log_trusted", () => {
    const ok = resolveVehicleLogPolicy(trustedTech, "service", SEEDED, {
      evidence: OK,
    });
    expect(ok).toMatchObject({
      effectivePolicy: "auto_if_evidence",
      status: "approved",
      step: 3,
      reason: "evidence_ok",
    });
    const missing = resolveVehicleLogPolicy(trustedTech, "service", SEEDED, {
      evidence: MISSING,
    });
    expect(missing).toMatchObject({
      status: "pending",
      reason: "evidence_missing",
    });
  });
  it("does not change auto or auto_if_evidence policies", () => {
    expect(
      resolveVehicleLogPolicy(trustedTech, "inspection", SEEDED)
        .effectivePolicy,
    ).toBe("auto");
    expect(
      resolveVehicleLogPolicy(trustedTech, "odometer", SEEDED, {
        evidence: MISSING,
      }).status,
    ).toBe("pending");
  });
  it("untrusted tech: always_review stays in review", () => {
    const r = resolveVehicleLogPolicy(tech, "service", SEEDED, {
      evidence: OK,
    });
    expect(r).toMatchObject({
      effectivePolicy: "always_review",
      status: "pending",
      step: 4,
      reason: "always_review",
    });
  });
});

describe("step 4: policy", () => {
  it("auto approves", () => {
    expect(resolveVehicleLogPolicy(tech, "inspection", SEEDED).status).toBe(
      "approved",
    );
  });
  it("auto_if_evidence approves only with evidence", () => {
    expect(
      resolveVehicleLogPolicy(tech, "odometer", SEEDED, { evidence: OK })
        .status,
    ).toBe("approved");
    expect(
      resolveVehicleLogPolicy(tech, "odometer", SEEDED, { evidence: MISSING })
        .status,
    ).toBe("pending");
    expect(
      resolveVehicleLogPolicy(tech, "odometer", SEEDED, {
        evidence: { ok: false, pendingAi: true, missing: [] },
      }).reason,
    ).toBe("awaiting_ai");
  });
});

describe("anomaly forces review whatever steps 2–3 say", () => {
  const anomalies = ["odometer_jump"];
  it("admin approver", () => {
    expect(
      resolveVehicleLogPolicy(admin, "odometer", SEEDED, { anomalies }),
    ).toMatchObject({ status: "pending", reason: "anomaly" });
  });
  it("trusted tech", () => {
    expect(
      resolveVehicleLogPolicy(trustedTech, "service", SEEDED, {
        anomalies,
        evidence: OK,
      }),
    ).toMatchObject({ status: "pending", reason: "anomaly" });
  });
  it("auto policy", () => {
    expect(
      resolveVehicleLogPolicy(tech, "inspection", SEEDED, { anomalies }).status,
    ).toBe("pending");
  });
});

describe("evaluateEvidence", () => {
  const aiOn = (value: number | null, done = true) => ({
    enabled: true,
    done,
    value,
  });
  it("odometer: photo + AI within ±0.5 %", () => {
    expect(
      evaluateEvidence({
        type: "odometer",
        hasMedia: true,
        typed: 50_000,
        ai: aiOn(50_200),
        aiOptional: false,
      }).ok,
    ).toBe(true);
    expect(
      evaluateEvidence({
        type: "odometer",
        hasMedia: true,
        typed: 50_000,
        ai: aiOn(50_300),
        aiOptional: false,
      }).missing,
    ).toEqual(["ai_mismatch"]);
  });
  it("odometer: no photo", () => {
    expect(
      evaluateEvidence({
        type: "odometer",
        hasMedia: false,
        typed: 50_000,
        aiOptional: true,
      }).missing,
    ).toEqual(["photo"]);
  });
  it("AI off falls to review unless ai_optional", () => {
    const base = {
      type: "odometer" as const,
      hasMedia: true,
      typed: 50_000,
      ai: { enabled: false, done: false, value: null },
    };
    expect(evaluateEvidence({ ...base, aiOptional: false }).missing).toEqual([
      "ai_off",
    ]);
    expect(evaluateEvidence({ ...base, aiOptional: true }).ok).toBe(true);
  });
  it("AI queued → pending AI", () => {
    const r = evaluateEvidence({
      type: "fuel",
      hasMedia: true,
      typed: 6512,
      ai: aiOn(null, false),
      aiOptional: false,
    });
    expect(r).toEqual({ ok: false, pendingAi: true, missing: [] });
  });
  it("fuel receipt total within 50¢", () => {
    expect(
      evaluateEvidence({
        type: "fuel",
        hasMedia: true,
        typed: 6512,
        ai: aiOn(6550),
        aiOptional: false,
      }).ok,
    ).toBe(true);
    expect(
      evaluateEvidence({
        type: "fuel",
        hasMedia: true,
        typed: 6512,
        ai: aiOn(6600),
        aiOptional: false,
      }).missing,
    ).toEqual(["ai_mismatch"]);
  });
  it("inspection and trip checks", () => {
    expect(
      evaluateEvidence({
        type: "inspection",
        hasMedia: false,
        aiOptional: false,
        checklistComplete: true,
        failedItemsHavePhotos: false,
      }).missing,
    ).toEqual(["damage_photo"]);
    expect(
      evaluateEvidence({
        type: "trip",
        hasMedia: false,
        aiOptional: false,
        tripConsistent: true,
      }).ok,
    ).toBe(true);
  });
});

describe("odometer default: photo auto-approves with AI off (QA T1-10)", () => {
  // Defaults straight from the settings schema, not the SEEDED fixture above.
  const defaults = settingsShape.vehicles.parse({}).policies as VehiclePolicies;
  const aiOff = { enabled: false, done: false, value: null };

  it("odometer ai_optional defaults on; fuel/service stay off", () => {
    expect(defaults.odometer).toMatchObject({
      approval: "auto_if_evidence",
      ai_optional: true,
    });
    expect(defaults.fuel.ai_optional).toBe(false);
    expect(defaults.service.ai_optional).toBe(false);
  });

  it("a normal reading with a photo is approved", () => {
    const ev = evaluateEvidence({
      type: "odometer",
      hasMedia: true,
      typed: 48_210,
      ai: aiOff,
      aiOptional: defaults.odometer.ai_optional,
    });
    expect(
      resolveVehicleLogPolicy(tech, "odometer", defaults, { evidence: ev }),
    ).toMatchObject({ status: "approved", reason: "evidence_ok" });
  });

  it("no photo, or an anomaly, still goes to review", () => {
    const noPhoto = evaluateEvidence({
      type: "odometer",
      hasMedia: false,
      typed: 48_210,
      ai: aiOff,
      aiOptional: defaults.odometer.ai_optional,
    });
    expect(
      resolveVehicleLogPolicy(tech, "odometer", defaults, { evidence: noPhoto })
        .status,
    ).toBe("pending");
    const withPhoto = evaluateEvidence({
      type: "odometer",
      hasMedia: true,
      typed: 48_210,
      ai: aiOff,
      aiOptional: true,
    });
    expect(
      resolveVehicleLogPolicy(tech, "odometer", defaults, {
        evidence: withPhoto,
        anomalies: ["odometer_backwards"],
      }),
    ).toMatchObject({ status: "pending", reason: "anomaly" });
  });

  it("an AI mismatch still goes to review when AI is on", () => {
    const ev = evaluateEvidence({
      type: "odometer",
      hasMedia: true,
      typed: 48_210,
      ai: { enabled: true, done: true, value: 41_000 },
      aiOptional: true,
    });
    expect(ev.missing).toEqual(["ai_mismatch"]);
    expect(
      resolveVehicleLogPolicy(tech, "odometer", defaults, { evidence: ev })
        .status,
    ).toBe("pending");
  });

  it("fuel with a receipt still waits for review with AI off", () => {
    const ev = evaluateEvidence({
      type: "fuel",
      hasMedia: true,
      typed: 6512,
      ai: aiOff,
      aiOptional: defaults.fuel.ai_optional,
    });
    expect(
      resolveVehicleLogPolicy(tech, "fuel", defaults, { evidence: ev }).status,
    ).toBe("pending");
  });
});

describe("approvalHint: sheet copy matches the policy (QA T1-10)", () => {
  const defaults = settingsShape.vehicles.parse({}).policies as VehiclePolicies;

  it("defaults: odometer auto with a photo, fuel reviewed without AI", () => {
    expect(approvalHint(tech, "odometer", defaults, false)).toBe("with_proof");
    expect(approvalHint(tech, "fuel", defaults, false)).toBe("review");
    expect(approvalHint(tech, "fuel", defaults, true)).toBe("with_proof");
    expect(approvalHint(tech, "inspection", defaults, false)).toBe("auto");
    expect(approvalHint(tech, "service", defaults, true)).toBe("review");
  });
  it("ai_optional off + AI off → review", () => {
    expect(approvalHint(tech, "odometer", SEEDED, false)).toBe("review");
    expect(approvalHint(tech, "odometer", SEEDED, true)).toBe("with_proof");
  });
  it("approver, trusted and blocked users", () => {
    expect(approvalHint(admin, "service", defaults, false)).toBe("approver");
    expect(approvalHint(trustedTech, "service", defaults, true)).toBe(
      "with_proof",
    );
    const blocked = {
      ...defaults,
      odometer: { ...defaults.odometer, tech_can_log: false },
    };
    expect(approvalHint(tech, "odometer", blocked, true)).toBe("none");
  });
  it("copy never promises auto-approval for review", () => {
    expect(odometerHintCopy("review")).not.toMatch(/automatic/i);
    expect(odometerHintCopy("with_proof")).toMatch(/automatic/i);
    expect(odometerHintCopy(undefined)).not.toMatch(/automatic/i);
  });
});
