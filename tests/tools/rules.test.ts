// Tool rules (SPEC M18): check-out blocks, due states, audits, ⚖️ deduction gate, QR.
import { describe, expect, it } from "vitest";
import {
  addDays,
  assetTag,
  checkoutBlock,
  deductionAllowed,
  dueState,
  nextAuditDue,
  nextMaintenanceOn,
  qrPayload,
  toolIdFromScan,
} from "@/features/tools/rules";

const today = "2026-10-15";

describe("check-out blocks", () => {
  const opts = { blockOnCalibration: true };
  it("in repair, lost, stolen, retired never check out", () => {
    for (const s of ["in_repair", "lost", "stolen", "retired"])
      expect(
        checkoutBlock({ status: s, calibrationDueOn: null }, today, opts),
      ).toBe(s);
  });
  it("calibration overdue blocks (setting on)", () => {
    expect(
      checkoutBlock(
        { status: "available", calibrationDueOn: "2026-10-14" },
        today,
        opts,
      ),
    ).toBe("calibration_overdue");
    expect(
      checkoutBlock(
        { status: "available", calibrationDueOn: "2026-10-14" },
        today,
        { blockOnCalibration: false },
      ),
    ).toBeNull();
  });
  it("due today is still allowed", () => {
    expect(
      checkoutBlock(
        { status: "available", calibrationDueOn: today },
        today,
        opts,
      ),
    ).toBeNull();
  });
  it("assigned needs check-in unless reassigning", () => {
    expect(
      checkoutBlock(
        { status: "assigned", calibrationDueOn: null },
        today,
        opts,
      ),
    ).toBe("already_assigned");
    expect(
      checkoutBlock({ status: "assigned", calibrationDueOn: null }, today, {
        ...opts,
        allowReassign: true,
      }),
    ).toBeNull();
  });
});

describe("due states and maintenance", () => {
  it("overdue / due / due soon / ok", () => {
    expect(dueState("2026-10-14", today)).toBe("overdue");
    expect(dueState(today, today)).toBe("due");
    expect(dueState("2026-10-22", today, 7)).toBe("due_soon");
    expect(dueState("2026-10-23", today, 7)).toBe("ok");
    expect(dueState(null, today)).toBe("ok");
  });
  it("logging resets the next due date", () => {
    expect(nextMaintenanceOn("2026-10-15", 90)).toBe("2027-01-13");
    expect(nextMaintenanceOn(null, 90)).toBeNull();
    expect(nextMaintenanceOn("2026-10-15", null)).toBeNull();
  });
  it("addDays crosses months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("audits", () => {
  it("first audit is due today; then every N days; never in the past", () => {
    expect(nextAuditDue(null, today, 30)).toBe(today);
    expect(nextAuditDue("2026-10-01", today, 30)).toBe("2026-10-31");
    expect(nextAuditDue("2026-08-01", today, 30)).toBe(today);
  });
});

describe("⚖️ deductions", () => {
  const base = {
    enabled: true,
    workerType: "1099" as const,
    companyState: "TX",
    blockedStates: ["CA", "NY"],
    agreementSigned: true,
  };
  it("off by default blocks", () => {
    expect(deductionAllowed({ ...base, enabled: false }).ok).toBe(false);
  });
  it("W-2 in a blocked state is blocked; 1099 there is allowed", () => {
    expect(
      deductionAllowed({ ...base, workerType: "w2", companyState: "ca" }).ok,
    ).toBe(false);
    expect(deductionAllowed({ ...base, companyState: "CA" }).ok).toBe(true);
  });
  it("needs a signed tool agreement", () => {
    expect(deductionAllowed({ ...base, agreementSigned: false }).ok).toBe(
      false,
    );
  });
  it("W-2 in an allowed state with agreement is ok", () => {
    expect(deductionAllowed({ ...base, workerType: "w2" }).ok).toBe(true);
  });
});

describe("labels and scanning", () => {
  const id = "3f2b6c1e-8a7d-4c2b-9e1f-0a1b2c3d4e5f";
  it("asset tags are zero-padded", () => {
    expect(assetTag(1)).toBe("T-0001");
    expect(assetTag(1234)).toBe("T-1234");
  });
  it("QR payload round-trips through the scanner parser", () => {
    expect(toolIdFromScan(qrPayload("https://crm.example.com/", id))).toBe(id);
    expect(toolIdFromScan(id.toUpperCase())).toBe(id);
    expect(toolIdFromScan("https://example.com/other")).toBeNull();
  });
});
