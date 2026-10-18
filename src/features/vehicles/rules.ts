// Pure vehicle rules (SPEC M17). Isomorphic: no I/O, no server imports, safe in
// client components. Golden-tested in tests/golden/vehicle-policy.test.ts and
// tests/golden/vehicle-anomaly.test.ts.
//
//  - resolveVehicleLogPolicy: the four-step approval resolution (§M17 order)
//  - evaluateEvidence:       what `auto_if_evidence` needs per log type
//  - detectAnomalies:        rules-first flags that ALWAYS force review
//  - forecastReminder:       Fleetio-style miles/days reminders (whichever first)
//  - trailingAvgDailyMiles, computeMpg, mileageReimbursementCents
import { divRoundHalfAway } from "@/lib/money";
import { addDaysToKey, dateKey, parseDateKey, zonedParts } from "@/lib/time";

export const VEHICLE_LOG_TYPES = [
  "odometer",
  "fuel",
  "service",
  "document",
  "inspection",
  "trip",
] as const;
export type VehicleLogType = (typeof VEHICLE_LOG_TYPES)[number];

export type ApprovalPolicy = "auto" | "auto_if_evidence" | "always_review";

export interface LogPolicy {
  tech_can_log: boolean;
  approval: ApprovalPolicy;
  /** `auto_if_evidence` may pass without the AI cross-check (AI off or skipped). */
  ai_optional: boolean;
}
export type VehiclePolicies = Record<VehicleLogType, LogPolicy>;

/** The bits of a SessionUser the policy needs (perm keys as plain strings). */
export interface PolicyUser {
  baseRole: "admin" | "office" | "tech";
  perms: { has(perm: string): boolean } | ReadonlySet<string>;
}

const has = (u: PolicyUser, p: string) =>
  (u.perms as { has(perm: string): boolean }).has(p);

// ------------------------------------------------------------------ policy

/** Step 1 only: may this user submit this log type? (two-key rule, SPEC §4.2) */
export function canLogVehicle(
  user: PolicyUser,
  type: VehicleLogType,
  policies: VehiclePolicies,
): boolean {
  if (!has(user, "vehicles.log")) return false;
  if (user.baseRole === "tech" && !policies[type].tech_can_log) return false;
  return true;
}

export interface EvidenceResult {
  ok: boolean;
  /** The AI cross-check is queued; the item waits in review until it lands. */
  pendingAi: boolean;
  /** Machine codes of unmet requirements (photo, ai_mismatch, ai_off, …). */
  missing: string[];
}

export type PolicyReason =
  | "cannot_log"
  | "approver"
  | "auto"
  | "evidence_ok"
  | "evidence_missing"
  | "awaiting_ai"
  | "always_review"
  | "anomaly";

export interface PolicyOutcome {
  canLog: boolean;
  /** Policy after the trusted override (step 3). */
  effectivePolicy: ApprovalPolicy;
  status: "approved" | "pending";
  /** Step that decided the outcome (1–4). */
  step: 1 | 2 | 3 | 4;
  reason: PolicyReason;
}

/**
 * SPEC M17 resolution order:
 *  1. Can log? `vehicles.log` AND (role ≠ tech OR policies[type].tech_can_log).
 *  2. Logged by a `vehicles.log_approve` holder → approved immediately.
 *  3. `vehicles.log_trusted` → `always_review` is treated as `auto_if_evidence`.
 *  4. Apply the policy. ANY anomaly flag forces review, whatever steps 2–3 say.
 */
export function resolveVehicleLogPolicy(
  user: PolicyUser,
  type: VehicleLogType,
  policies: VehiclePolicies,
  opts: { anomalies?: readonly string[]; evidence?: EvidenceResult } = {},
): PolicyOutcome {
  const configured = policies[type].approval;
  const trusted =
    configured === "always_review" && has(user, "vehicles.log_trusted");
  const effectivePolicy: ApprovalPolicy = trusted
    ? "auto_if_evidence"
    : configured;

  if (!canLogVehicle(user, type, policies)) {
    return {
      canLog: false,
      effectivePolicy,
      status: "pending",
      step: 1,
      reason: "cannot_log",
    };
  }
  const anomalous = (opts.anomalies?.length ?? 0) > 0;
  if (anomalous) {
    return {
      canLog: true,
      effectivePolicy,
      status: "pending",
      step: 4,
      reason: "anomaly",
    };
  }
  if (has(user, "vehicles.log_approve")) {
    return {
      canLog: true,
      effectivePolicy,
      status: "approved",
      step: 2,
      reason: "approver",
    };
  }
  const step = trusted ? 3 : 4;
  switch (effectivePolicy) {
    case "auto":
      return {
        canLog: true,
        effectivePolicy,
        status: "approved",
        step,
        reason: "auto",
      };
    case "always_review":
      return {
        canLog: true,
        effectivePolicy,
        status: "pending",
        step,
        reason: "always_review",
      };
    default: {
      const ev = opts.evidence ?? { ok: false, pendingAi: false, missing: [] };
      if (ev.ok)
        return {
          canLog: true,
          effectivePolicy,
          status: "approved",
          step,
          reason: "evidence_ok",
        };
      return {
        canLog: true,
        effectivePolicy,
        status: "pending",
        step,
        reason: ev.pendingAi ? "awaiting_ai" : "evidence_missing",
      };
    }
  }
}

// ------------------------------------------------------------------ evidence

/** Odometer AI read must match the typed value within ±0.5 % (SPEC M17). */
export const ODOMETER_AI_TOLERANCE = 0.005;
/** Receipt AI total must match the typed total within 50¢. */
export const RECEIPT_AI_TOLERANCE_CENTS = 50;

export function odometerMatches(typed: number, ai: number): boolean {
  return Math.abs(typed - ai) <= Math.max(1, typed * ODOMETER_AI_TOLERANCE);
}
export function receiptTotalMatches(typedCents: number, aiCents: number) {
  return Math.abs(typedCents - aiCents) <= RECEIPT_AI_TOLERANCE_CENTS;
}

export interface EvidenceInput {
  type: VehicleLogType;
  /** Photo (odometer), receipt (fuel/service) or document file present. */
  hasMedia: boolean;
  /** Typed odometer (odometer) or typed total in cents (fuel/service). */
  typed?: number | null;
  /** AI cross-check state. `enabled` = provider configured (AI_PROVIDER≠none). */
  ai?: {
    enabled: boolean;
    /** The AI task finished (done/failed/skipped). */
    done: boolean;
    value: number | null;
  };
  aiOptional: boolean;
  /** inspection: every checklist item answered. */
  checklistComplete?: boolean;
  /** inspection: failed items carry at least one photo. */
  failedItemsHavePhotos?: boolean;
  /** trip: start/end odometer present and consistent with miles. */
  tripConsistent?: boolean;
  /** document: has an expiry date when the kind needs one. */
  documentExpiryOk?: boolean;
}

const AI_CHECKED: readonly VehicleLogType[] = ["odometer", "fuel", "service"];

/** What `auto_if_evidence` requires (SPEC M17). Pure; the caller gathers the facts. */
export function evaluateEvidence(i: EvidenceInput): EvidenceResult {
  const missing: string[] = [];
  let pendingAi = false;
  switch (i.type) {
    case "odometer":
      if (!i.hasMedia) missing.push("photo");
      break;
    case "fuel":
    case "service":
      if (!i.hasMedia) missing.push("receipt");
      break;
    case "document":
      if (!i.hasMedia) missing.push("document");
      if (i.documentExpiryOk === false) missing.push("expiry");
      break;
    case "inspection":
      if (i.checklistComplete === false) missing.push("checklist");
      if (i.failedItemsHavePhotos === false) missing.push("damage_photo");
      break;
    case "trip":
      if (i.tripConsistent === false) missing.push("odometer");
      break;
  }
  if (AI_CHECKED.includes(i.type) && i.hasMedia && i.typed != null) {
    const ai = i.ai;
    if (!ai?.enabled) {
      if (!i.aiOptional) missing.push("ai_off");
    } else if (!ai.done) {
      pendingAi = true;
    } else if (ai.value == null) {
      if (!i.aiOptional) missing.push("ai_unreadable");
    } else {
      const ok =
        i.type === "odometer"
          ? odometerMatches(i.typed, ai.value)
          : receiptTotalMatches(i.typed, ai.value);
      if (!ok) missing.push("ai_mismatch");
    }
  }
  return {
    ok: missing.length === 0 && !pendingAi,
    pendingAi: pendingAi && missing.length === 0,
    missing,
  };
}

/**
 * What a user can expect when they log this type, so sheet copy matches what
 * `resolveVehicleLogPolicy` + `evaluateEvidence` will actually do (QA T1-10):
 *  - `approver`:   their own entries are approved right away (anomalies still go to review)
 *  - `auto`:       approved automatically unless something looks off
 *  - `with_proof`: approved automatically with the photo/receipt, unless something looks off
 *  - `review`:     an admin reviews every entry
 *  - `none`:       may not log this type
 * `aiOn` = an AI provider is configured (the photo cross-check runs).
 */
export type ApprovalHint =
  | "approver"
  | "auto"
  | "with_proof"
  | "review"
  | "none";

export function approvalHint(
  user: PolicyUser,
  type: VehicleLogType,
  policies: VehiclePolicies,
  aiOn: boolean,
): ApprovalHint {
  if (!canLogVehicle(user, type, policies)) return "none";
  if (has(user, "vehicles.log_approve")) return "approver";
  const p = policies[type];
  const effective: ApprovalPolicy =
    p.approval === "always_review" && has(user, "vehicles.log_trusted")
      ? "auto_if_evidence"
      : p.approval;
  if (effective === "auto") return "auto";
  if (effective === "always_review") return "review";
  // auto_if_evidence: the AI-checked types need AI on, or AI marked optional.
  if (AI_CHECKED.includes(type) && !aiOn && !p.ai_optional) return "review";
  return "with_proof";
}

/** Footnote under the odometer photo (and the end-of-day prompt) for a hint. */
export function odometerHintCopy(hint: ApprovalHint | null | undefined) {
  switch (hint) {
    case "approver":
      return "Your readings are approved right away unless something looks off.";
    case "auto":
      return "Readings are approved automatically unless something looks off.";
    case "with_proof":
      return "With a clear dashboard photo, your reading is approved automatically unless something looks off.";
    case "review":
      return "An admin reviews each reading. A clear photo makes that quick.";
    default:
      return "A clear dashboard photo keeps your mileage log accurate.";
  }
}

// ------------------------------------------------------------------ anomalies

export const ANOMALY_FLAGS = [
  "odometer_backwards",
  "odometer_jump",
  "gallons_over_tank",
  "mpg_drop",
  "duplicate_fuel_day",
  "odometer_unchanged",
  "weekend_fuel",
] as const;
export type AnomalyFlag = (typeof ANOMALY_FLAGS)[number];

export const ANOMALY_LABELS: Record<string, string> = {
  odometer_backwards: "Odometer went backwards",
  odometer_jump: "Odometer jump (too many miles per day)",
  gallons_over_tank: "More gallons than the tank holds",
  mpg_drop: "MPG dropped sharply",
  duplicate_fuel_day: "Second fuel purchase the same day",
  odometer_unchanged: "Fuel with an unchanged odometer",
  weekend_fuel: "Weekend fuel purchase",
};

/** Non-anomaly review reasons shown next to flags in the review screen. */
export const MISSING_LABELS: Record<string, string> = {
  photo: "No odometer photo",
  receipt: "No receipt",
  document: "No document file",
  expiry: "No expiry date",
  checklist: "Checklist incomplete",
  damage_photo: "Failed items without a photo",
  odometer: "Start/end odometer missing or inconsistent",
  ai_off: "AI check unavailable",
  ai_unreadable: "AI couldn't read the photo",
  ai_mismatch: "Typed value doesn't match the photo",
};

export interface AnomalyInput {
  /** Odometer value of this entry (reading, fuel or service), if any. */
  value?: number | null;
  at: Date;
  /** Latest APPROVED reading before this one. */
  prev?: { value: number; at: Date } | null;
  maxDailyMiles: number;
  fuel?: {
    gallons: number;
    tankGal: number | null;
    /** Odometer at the previous approved fill (MPG baseline). */
    prevFillOdometer?: number | null;
    /** Trailing average MPG of approved fills. */
    avgMpg?: number | null;
    /** Other fuel logs (any status but rejected) on the same company-local day. */
    sameDayFills: number;
    weekendCheck: boolean;
    mpgDropPct: number;
    tz: string;
  };
}

const DAY_MS = 86_400_000;

/** Rules-first anomaly flags (SPEC M17). The LLM may only explain them. */
export function detectAnomalies(i: AnomalyInput): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const v = i.value ?? null;
  if (v != null && i.prev) {
    if (v < i.prev.value) flags.push("odometer_backwards");
    else {
      const days = Math.max(1, (i.at.getTime() - i.prev.at.getTime()) / DAY_MS);
      if ((v - i.prev.value) / days > i.maxDailyMiles)
        flags.push("odometer_jump");
    }
  }
  const f = i.fuel;
  if (f) {
    if (f.tankGal != null && f.tankGal > 0 && f.gallons > f.tankGal)
      flags.push("gallons_over_tank");
    if (f.sameDayFills > 0) flags.push("duplicate_fuel_day");
    if (v != null && i.prev && v === i.prev.value)
      flags.push("odometer_unchanged");
    if (f.weekendCheck) {
      const wd = zonedParts(i.at, f.tz).weekday;
      if (wd === 0 || wd === 6) flags.push("weekend_fuel");
    }
    const mpg = computeMpg(v, f.prevFillOdometer ?? null, f.gallons);
    if (
      mpg != null &&
      f.avgMpg != null &&
      f.avgMpg > 0 &&
      mpg < f.avgMpg * (1 - f.mpgDropPct / 100)
    )
      flags.push("mpg_drop");
  }
  return flags;
}

/** Miles since the previous fill ÷ gallons of this fill (full-tank method). */
export function computeMpg(
  odometer: number | null | undefined,
  prevFillOdometer: number | null | undefined,
  gallons: number,
): number | null {
  if (odometer == null || prevFillOdometer == null || gallons <= 0) return null;
  const miles = odometer - prevFillOdometer;
  if (miles <= 0) return null;
  return Math.round((miles / gallons) * 10) / 10;
}

// ------------------------------------------------------------------ reminders

/** Tasks driven by document expiry instead of miles/days. */
export const DOCUMENT_TASKS = ["registration", "insurance", "inspection"];

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  registration: "Registration",
  insurance: "Insurance card",
  inspection: "Inspection",
  lease: "Lease",
  title: "Title",
  other: "Other",
};

export function docKindLabel(kind: string): string {
  return (
    DOCUMENT_KIND_LABELS[kind] ??
    kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export const TASK_LABELS: Record<string, string> = {
  oil_change: "Oil change",
  tire_rotation: "Tire rotation",
  brake_inspection: "Brake inspection",
  brakes: "Brakes",
  inspection: "State inspection",
  registration: "Registration",
  insurance: "Insurance",
  recall: "Open recall",
};

export function taskLabel(task: string): string {
  if (TASK_LABELS[task]) return TASK_LABELS[task] as string;
  const t = task.startsWith("custom:") ? task.slice(7) : task;
  // Keep the user's casing ("DPF filter"); only capitalize the first letter.
  return t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Matching key for a service/reminder task: ignores case, spacing and `custom:`. */
export function taskMatchKey(task: string): string {
  return task
    .trim()
    .toLowerCase()
    .replace(/^custom:/, "")
    .replace(/[\s_]+/g, "_");
}

/**
 * Stored task for a typed name: a known task key when the name matches one
 * ("Oil change" → `oil_change`), else `custom:<name as typed>` so labels keep
 * their casing ("DPF filter", QA T3-23).
 */
export function taskFromInput(name: string): string {
  const typed = name.trim().replace(/\s+/g, " ");
  const key = taskMatchKey(typed);
  const known = Object.entries(TASK_LABELS).find(
    ([k, label]) => k === key || taskMatchKey(label) === key,
  );
  return known ? known[0] : `custom:${typed}`;
}

export interface ReminderRuleInput {
  task: string;
  intervalMiles: number | null;
  intervalDays: number | null;
  dueSoonMiles: number | null;
  dueSoonDays: number | null;
  lastDoneOn: string | null;
  lastDoneOdometer: number | null;
}

export interface ReminderForecast {
  nextDueOn: string | null;
  nextDueMiles: number | null;
  status: "ok" | "due_soon" | "overdue";
}

/** Whole days from date key a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) -
      Date.UTC(pa.year, pa.month - 1, pa.day)) /
      DAY_MS,
  );
}

/**
 * Whichever comes first of miles and days (SPEC M17, Fleetio model). The miles
 * due date is forecast from the trailing 30-day average daily miles. Document
 * tasks without intervals follow the latest approved document's expiry.
 */
export function forecastReminder(
  r: ReminderRuleInput,
  f: {
    odometer: number | null;
    avgDailyMiles: number | null;
    today: string;
    documentExpiresOn?: string | null;
  },
): ReminderForecast {
  const isDoc =
    DOCUMENT_TASKS.includes(r.task) &&
    r.intervalMiles == null &&
    r.intervalDays == null;
  if (isDoc) {
    const due = f.documentExpiresOn ?? null;
    if (!due) return { nextDueOn: null, nextDueMiles: null, status: "ok" };
    const left = daysBetween(f.today, due);
    const status =
      left < 0
        ? "overdue"
        : r.dueSoonDays != null && left <= r.dueSoonDays
          ? "due_soon"
          : "ok";
    return { nextDueOn: due, nextDueMiles: null, status };
  }

  let status: ReminderForecast["status"] = "ok";
  const bump = (s: ReminderForecast["status"]) => {
    if (s === "overdue" || (s === "due_soon" && status === "ok")) status = s;
  };

  // Miles
  let nextDueMiles: number | null = null;
  let milesDate: string | null = null;
  if (r.intervalMiles != null && r.lastDoneOdometer != null) {
    nextDueMiles = r.lastDoneOdometer + r.intervalMiles;
    if (f.odometer != null) {
      const left = nextDueMiles - f.odometer;
      if (left <= 0) bump("overdue");
      else if (r.dueSoonMiles != null && left <= r.dueSoonMiles)
        bump("due_soon");
      if (f.avgDailyMiles != null && f.avgDailyMiles > 0) {
        milesDate = addDaysToKey(
          f.today,
          Math.max(0, Math.ceil(left / f.avgDailyMiles)),
        );
      }
    }
  }
  // Days
  let timeDate: string | null = null;
  if (r.intervalDays != null && r.lastDoneOn) {
    timeDate = addDaysToKey(r.lastDoneOn, r.intervalDays);
    const left = daysBetween(f.today, timeDate);
    if (left < 0) bump("overdue");
    else if (r.dueSoonDays != null && left <= r.dueSoonDays) bump("due_soon");
  }
  // A miles forecast landing inside the due-soon days window also counts as due soon.
  if (milesDate && r.dueSoonDays != null) {
    if (daysBetween(f.today, milesDate) <= r.dueSoonDays) bump("due_soon");
  }
  const dates = [milesDate, timeDate].filter((d): d is string => !!d).sort();
  return { nextDueOn: dates[0] ?? null, nextDueMiles, status };
}

/**
 * Trailing 30-day average daily miles from approved readings (value + time).
 * Baseline = the latest reading at or before the window start (else the first
 * in the window). Null with fewer than two usable readings.
 */
export function trailingAvgDailyMiles(
  readings: readonly { value: number; at: Date }[],
  now: Date,
  windowDays = 30,
): number | null {
  if (readings.length < 2) return null;
  const sorted = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());
  const start = now.getTime() - windowDays * DAY_MS;
  let baseline = sorted[0] as { value: number; at: Date };
  for (const r of sorted) if (r.at.getTime() <= start) baseline = r;
  const last = sorted[sorted.length - 1] as { value: number; at: Date };
  if (last === baseline) return null;
  const days = Math.max(
    1,
    (last.at.getTime() - baseline.at.getTime()) / DAY_MS,
  );
  const miles = last.value - baseline.value;
  if (miles < 0) return null;
  return Math.round((miles / days) * 100) / 100;
}

/** IRS-rate reimbursement: miles × (millicents per mile) → cents, half away. */
export function mileageReimbursementCents(
  miles: number,
  millicentsPerMile: number,
): number {
  const tenths = Math.round(miles * 10);
  return divRoundHalfAway(tenths * millicentsPerMile, 10_000);
}

/** Is a document due to warn today (30/14/3 days before expiry by default)? */
export function documentWarningDay(
  expiresOn: string,
  today: string,
  thresholds: readonly number[] = [30, 14, 3],
): number | null {
  const left = daysBetween(today, expiresOn);
  return thresholds.includes(left) ? left : null;
}

/**
 * Window-based expiry warning (QA T6-08). The document is "inside" the tightest
 * threshold T with daysLeft ≤ T. Warn once per threshold: only when that window is
 * tighter than the last one already alerted for this document. A missed cron day or
 * a document added inside a window still gets its warning; it never repeats.
 * Expired documents (daysLeft < 0) don't warn here.
 */
export function documentWarningDue(
  expiresOn: string,
  today: string,
  thresholds: readonly number[] = [30, 14, 3],
  lastAlerted: number | null = null,
): { threshold: number; daysLeft: number } | null {
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft < 0) return null;
  const threshold = documentWindow(daysLeft, thresholds);
  if (threshold == null) return null;
  if (lastAlerted != null && lastAlerted <= threshold) return null;
  return { threshold, daysLeft };
}

/** The tightest threshold a document with `daysLeft` is inside, or null. */
export function documentWindow(
  daysLeft: number,
  thresholds: readonly number[],
): number | null {
  let hit: number | null = null;
  for (const t of thresholds)
    if (
      Number.isFinite(t) &&
      t >= 0 &&
      daysLeft <= t &&
      (hit == null || t < hit)
    )
      hit = t;
  return hit;
}

/** Today's date key in the company zone (thin wrapper so callers import one module). */
export function todayKey(now: Date, tz: string): string {
  return dateKey(now, tz);
}

// ------------------------------------------------------------------ inspections

/** DVIR-lite checklist (SPEC M17). */
export const INSPECTION_ITEMS: readonly { key: string; label: string }[] = [
  { key: "tires", label: "Tires & wheels" },
  { key: "lights", label: "Lights & signals" },
  { key: "fluids", label: "Fluids & leaks" },
  { key: "wipers", label: "Wipers & windshield" },
  { key: "brakes", label: "Brakes feel" },
  { key: "mirrors", label: "Mirrors & horn" },
  { key: "damage", label: "Body (no new damage)" },
];
