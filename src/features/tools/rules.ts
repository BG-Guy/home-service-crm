// Pure tool rules (SPEC M18). Isomorphic: no I/O. Unit-tested in tests/tools/rules.test.ts.

export const TOOL_STATUSES = [
  "available",
  "assigned",
  "in_repair",
  "lost",
  "stolen",
  "retired",
] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const TOOL_CONDITIONS = ["new", "good", "fair", "poor"] as const;
export type ToolCondition = (typeof TOOL_CONDITIONS)[number];

export const INCIDENT_KINDS = ["lost", "stolen", "damaged"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_DECISIONS = [
  "write_off",
  "repair",
  "tech_responsibility",
] as const;
export type IncidentDecision = (typeof INCIDENT_DECISIONS)[number];

export const CONDITION_LABEL: Record<ToolCondition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

/** Whole days from date key a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1) -
      Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1)) /
      86_400_000,
  );
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

/** next_maintenance_on = last + interval (or null without both). */
export function nextMaintenanceOn(
  lastMaintainedOn: string | null,
  intervalDays: number | null,
): string | null {
  if (!lastMaintainedOn || !intervalDays || intervalDays <= 0) return null;
  return addDays(lastMaintainedOn, intervalDays);
}

export type DueState = "ok" | "due_soon" | "due" | "overdue";

/** Due state of a date: overdue (past), due (today), due_soon (≤ warn days), ok. */
export function dueState(
  dueOn: string | null,
  today: string,
  warnDays = 7,
): DueState {
  if (!dueOn) return "ok";
  const left = daysBetween(today, dueOn);
  if (left < 0) return "overdue";
  if (left === 0) return "due";
  if (left <= warnDays) return "due_soon";
  return "ok";
}

export interface ToolForCheckout {
  status: string;
  calibrationDueOn: string | null;
  currentUserId?: string | null;
}

export type BlockReason =
  | "in_repair"
  | "lost"
  | "stolen"
  | "retired"
  | "calibration_overdue"
  | "already_assigned";

export const BLOCK_LABEL: Record<BlockReason, string> = {
  in_repair: "In repair — return it from repair first",
  lost: "Marked lost",
  stolen: "Marked stolen",
  retired: "Retired",
  calibration_overdue: "Calibration overdue",
  already_assigned: "Already checked out — check it in first",
};

/**
 * Why a tool can't be checked out (null = OK). SPEC M18: block when calibration is
 * overdue (setting, default on) and while `in_repair`; lost/stolen/retired never.
 */
export function checkoutBlock(
  t: ToolForCheckout,
  today: string,
  opts: { blockOnCalibration: boolean; allowReassign?: boolean },
): BlockReason | null {
  if (t.status === "in_repair") return "in_repair";
  if (t.status === "lost") return "lost";
  if (t.status === "stolen") return "stolen";
  if (t.status === "retired") return "retired";
  if (
    opts.blockOnCalibration &&
    t.calibrationDueOn &&
    daysBetween(today, t.calibrationDueOn) < 0
  )
    return "calibration_overdue";
  if (t.status === "assigned" && !opts.allowReassign) return "already_assigned";
  return null;
}

/** Next audit due date for a tech: frequency after the last submission (or today). */
export function nextAuditDue(
  lastSubmittedOn: string | null,
  today: string,
  frequencyDays: number,
): string {
  if (!lastSubmittedOn) return today;
  const due = addDays(lastSubmittedOn, Math.max(1, frequencyDays));
  return due < today ? today : due;
}

/**
 * ⚖️ May a `tech_responsibility` decision create a (pending) tool deduction?
 * Only when deductions are enabled, the worker isn't a W-2 employee in a blocked
 * state, and the tech signed the tool agreement (SPEC M18).
 */
export function deductionAllowed(i: {
  enabled: boolean;
  workerType: "w2" | "1099";
  companyState: string | null;
  blockedStates: readonly string[];
  agreementSigned: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!i.enabled)
    return {
      ok: false,
      reason: "Tool deductions are off in Settings → Tools.",
    };
  if (
    i.workerType === "w2" &&
    i.companyState &&
    i.blockedStates.includes(i.companyState.toUpperCase())
  )
    return {
      ok: false,
      reason: `Wage deductions for W-2 employees are blocked in ${i.companyState.toUpperCase()}.`,
    };
  if (!i.agreementSigned)
    return {
      ok: false,
      reason: "The tech hasn't signed the tool agreement.",
    };
  return { ok: true };
}

/** Asset tag for a new tool: T-0001… from the count of existing tags. */
export function assetTag(n: number): string {
  return `T-${String(Math.max(1, n)).padStart(4, "0")}`;
}

/** QR payload for a tool label (scanned with BarcodeDetector at check-out). */
export function qrPayload(origin: string, toolId: string): string {
  return `${origin.replace(/\/$/, "")}/tools/${toolId}`;
}

/** Tool id from a scanned QR value (full URL or bare id). */
export function toolIdFromScan(value: string): string | null {
  const m = value.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m ? (m[1] as string).toLowerCase() : null;
}
