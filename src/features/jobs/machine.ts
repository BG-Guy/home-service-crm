// Job status machine, guards and small scheduling helpers (SPEC M05). Pure and
// isomorphic: no DB, no server imports, so it is golden-tested and safe to import
// from client components (labels, which buttons to show).
//
//   unscheduled ─► scheduled ─► confirmed ─► en_route ─► arrived ─► in_progress ─► completed ─► closed
//                                                          │            │  ▲
//                                                          ▼            ▼  │
//                                                        on_hold ◄──────┘  │ (return visit → scheduled)
//   any open status ──► cancelled{reason}            completed/closed ──► in_progress (reopen)
import { zonedTimeToUtc } from "@/lib/time";
import type { JobStatus } from "./contracts";

export const JOB_STATUS_ORDER: readonly JobStatus[] = [
  "unscheduled",
  "scheduled",
  "confirmed",
  "en_route",
  "arrived",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
  "cancelled",
];

/** Allowed edges. `closed` is reached only through `closeJobIfEligible`. */
export const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  unscheduled: ["scheduled", "cancelled"],
  // Arrived straight from scheduled/confirmed: the tech forgot "On my way".
  scheduled: ["confirmed", "en_route", "arrived", "unscheduled", "cancelled"],
  confirmed: ["scheduled", "en_route", "arrived", "unscheduled", "cancelled"],
  en_route: ["arrived", "cancelled"],
  arrived: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["completed", "on_hold", "cancelled"],
  on_hold: ["in_progress", "scheduled", "cancelled"],
  completed: ["closed", "in_progress"],
  closed: ["in_progress"],
  cancelled: [],
};

/** Statuses where work is still open (lists, "jobs left open", reassign). */
export const OPEN_STATUSES: readonly JobStatus[] = [
  "unscheduled",
  "scheduled",
  "confirmed",
  "en_route",
  "arrived",
  "in_progress",
  "on_hold",
];
export const DONE_STATUSES: readonly JobStatus[] = [
  "completed",
  "closed",
  "cancelled",
];
/** The field-flow statuses a tech moves through with `jobs.status_own`. */
export const FIELD_STATUSES: readonly JobStatus[] = [
  "en_route",
  "arrived",
  "in_progress",
  "on_hold",
  "completed",
];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isOpenStatus(s: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(s);
}

/** On site or later (cancel needs the after-arrival rules). */
export function isAfterArrival(job: {
  status: JobStatus;
  arrivedAt: Date | string | null;
}): boolean {
  return (
    job.status === "arrived" ||
    job.status === "in_progress" ||
    (job.status === "on_hold" && job.arrivedAt != null)
  );
}

// ------------------------------------------------------------------ guards

export interface GuardMiss {
  key: string;
  label: string;
  /** `jobs.override_requirements` may bypass it (with a reason). */
  overridable: boolean;
  action?:
    | "sign_estimate"
    | "capture_photos"
    | "completion_signature"
    | "collect_deposit"
    | "request_start_approval"
    | "change_order"
    | "prepay"
    | "checklist"
    | "ownership_check";
}

export interface GuardInput {
  from: JobStatus;
  to: JobStatus;
  actor: {
    isAssignee: boolean;
    statusOwn: boolean;
    statusAny: boolean;
    cancel: boolean;
    cancelAfterArrival: boolean;
    reopen: boolean;
    override: boolean;
  };
  job: {
    hasWindow: boolean;
    assigneeCount: number;
    arrivedAt: Date | string | null;
  };
  input?: {
    hasGeo?: boolean;
    distanceM?: number | null;
    reason?: string | null;
    note?: string | null;
    photoCount?: number;
    hasNewWindow?: boolean;
    /** Override reason; present = the actor asks to bypass overridable items. */
    overrideReason?: string | null;
  };
  settings?: { arrivalRadiusM: number };
  /** Required checklist items still open (labels). */
  checklistOpen?: readonly string[];
  /** Ownership-check items still open (labels), when the service type requires it. */
  ownershipOpen?: readonly string[];
  /** Risk/evidence controls from B4 `evaluateTransitionControls`. */
  controls?: readonly GuardMiss[];
}

export interface GuardResult {
  ok: boolean;
  /** Hard failures (permissions, invalid edge, missing reason/note/photo). */
  errors: GuardMiss[];
  /** Requirements that block unless overridden. */
  missing: GuardMiss[];
  /** Soft warnings shown to the user (never block). */
  warnings: string[];
  /** Stored on the status event / job (e.g. far_from_property, override). */
  flags: string[];
}

const hard = (key: string, label: string): GuardMiss => ({
  key,
  label,
  overridable: false,
});

/** Evaluate one transition (M05 guard table). Pure. */
export function evaluateTransition(g: GuardInput): GuardResult {
  const errors: GuardMiss[] = [];
  const missing: GuardMiss[] = [];
  const warnings: string[] = [];
  const flags: string[] = [];
  const { from, to, actor, job } = g;
  const input = g.input ?? {};

  if (!canTransition(from, to)) {
    errors.push(
      hard("invalid_transition", `Can't move a job from ${from} to ${to}.`),
    );
    return { ok: false, errors, missing, warnings, flags };
  }

  const fieldActor = actor.statusAny || (actor.statusOwn && actor.isAssignee);

  switch (to) {
    case "scheduled":
    case "unscheduled":
    case "confirmed": {
      if (to === "scheduled") {
        if (from === "on_hold") {
          if (!fieldActor && !actor.statusAny)
            errors.push(hard("forbidden", "You can't schedule this job."));
          if (!input.hasNewWindow)
            errors.push(
              hard(
                "window_required",
                "Pick a date and window for the return visit.",
              ),
            );
        }
        if (!job.hasWindow && !input.hasNewWindow)
          errors.push(
            hard("window_required", "Pick a date and arrival window."),
          );
        if (job.assigneeCount < 1)
          errors.push(
            hard("assignee_required", "Assign at least one technician."),
          );
      }
      break;
    }
    case "en_route": {
      if (!(actor.isAssignee && actor.statusOwn) && !actor.statusAny)
        errors.push(
          hard("assignee_only", "Only an assigned technician can head out."),
        );
      break;
    }
    case "arrived": {
      if (!fieldActor)
        errors.push(hard("forbidden", "You can't update this job."));
      if (!input.hasGeo) {
        flags.push("no_geo");
        warnings.push(
          "Location unavailable — arrival saved without a geostamp.",
        );
      } else if (
        input.distanceM != null &&
        g.settings &&
        input.distanceM > g.settings.arrivalRadiusM
      ) {
        flags.push("far_from_property");
        warnings.push(
          `You're ${formatDistance(input.distanceM)} from the property.`,
        );
      }
      break;
    }
    case "in_progress": {
      if (from === "completed" || from === "closed") {
        if (!actor.reopen)
          errors.push(hard("forbidden", "Reopening a job needs admin access."));
        if (!input.reason?.trim())
          errors.push(hard("reason_required", "Say why the job is reopened."));
        break;
      }
      if (!fieldActor)
        errors.push(hard("forbidden", "You can't update this job."));
      if (from !== "on_hold") {
        for (const label of g.ownershipOpen ?? [])
          missing.push({
            key: "ownership_check",
            label: `Ownership check: ${label}`,
            overridable: true,
            action: "ownership_check",
          });
        for (const c of g.controls ?? []) missing.push(c);
      }
      break;
    }
    case "on_hold": {
      if (!fieldActor)
        errors.push(hard("forbidden", "You can't update this job."));
      if (!input.reason?.trim())
        errors.push(hard("reason_required", "Pick why the job is on hold."));
      break;
    }
    case "completed": {
      if (!fieldActor)
        errors.push(hard("forbidden", "You can't update this job."));
      for (const label of g.checklistOpen ?? [])
        missing.push({
          key: "checklist",
          label: `Checklist: ${label}`,
          overridable: true,
          action: "checklist",
        });
      for (const c of g.controls ?? []) missing.push(c);
      break;
    }
    case "cancelled": {
      const after = isAfterArrival({ status: from, arrivedAt: job.arrivedAt });
      if (after) {
        if (!actor.cancelAfterArrival)
          errors.push(
            hard("forbidden", "You can't cancel a job after arrival."),
          );
        if (!input.note?.trim())
          errors.push(
            hard("note_required", "Add a note explaining the cancellation."),
          );
        if (!input.photoCount)
          errors.push(hard("photo_required", "Take at least one photo."));
      } else if (!actor.cancel) {
        errors.push(hard("forbidden", "You can't cancel jobs."));
      }
      if (!input.reason?.trim())
        errors.push(hard("reason_required", "Pick a cancellation reason."));
      break;
    }
    case "closed":
      break;
  }

  // Overrides (jobs.override_requirements): bypass overridable items with a reason.
  if (missing.length > 0 && input.overrideReason?.trim()) {
    if (!actor.override) {
      errors.push(hard("forbidden", "You can't override job requirements."));
    } else if (missing.every((m) => m.overridable)) {
      flags.push("override");
      return { ok: errors.length === 0, errors, missing, warnings, flags };
    }
  }
  return {
    ok: errors.length === 0 && missing.length === 0,
    errors,
    missing,
    warnings,
    flags,
  };
}

// ------------------------------------------------------------------ checklist

export interface ChecklistItemLike {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  answer?: unknown;
}

export function isAnswered(item: ChecklistItemLike): boolean {
  const a = item.answer;
  if (a == null) return false;
  if (item.type === "check") return a === true;
  if (typeof a === "string") return a.trim() !== "";
  if (Array.isArray(a)) return a.length > 0;
  return true;
}

export const OWNERSHIP_PREFIX = "own:";

/** Required open items, split into ownership-check items and the rest. */
export function openChecklist(items: readonly ChecklistItemLike[]): {
  required: string[];
  ownership: string[];
} {
  const required: string[] = [];
  const ownership: string[] = [];
  for (const i of items) {
    if (isAnswered(i)) continue;
    if (i.id.startsWith(OWNERSHIP_PREFIX)) ownership.push(i.label);
    else if (i.required) required.push(i.label);
  }
  return { required, ownership };
}

// ------------------------------------------------------------------ time helpers

/** 'YYYY-MM-DD' + 'HH:MM' + minutes in a zone → UTC window. */
export function buildWindow(
  date: string,
  start: string,
  minutes: number,
  tz: string,
): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(start);
  if (!m || !t) throw new RangeError("bad date or time");
  const s = zonedTimeToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(t[1]),
      minute: Number(t[2]),
    },
    tz,
  );
  return { start: s, end: new Date(s.getTime() + minutes * 60_000) };
}

export interface Recurrence {
  every: "weeks" | "months";
  n: number;
  until?: string;
}

/** Next occurrence date key, or null when past `until`. Months clamp to month end. */
export function nextRecurrenceDate(
  dateKey: string,
  r: Recurrence,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m || !(r.n >= 1)) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let next: Date;
  if (r.every === "weeks") {
    next = new Date(Date.UTC(y, mo - 1, d + 7 * r.n));
  } else {
    const target = new Date(Date.UTC(y, mo - 1 + r.n, 1));
    const last = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next = new Date(
      Date.UTC(
        target.getUTCFullYear(),
        target.getUTCMonth(),
        Math.min(d, last),
      ),
    );
  }
  const key = next.toISOString().slice(0, 10);
  if (r.until && key > r.until) return null;
  return key;
}

/** Active contact window (SPEC §4.2): scheduled_start − 2 h (or en_route_at) → completed_at + 24 h. */
export function contactWindow(job: {
  status: string;
  scheduledStart: Date | null;
  windowStart: Date | null;
  enRouteAt: Date | null;
  completedAt: Date | null;
}): { from: Date; until: Date } | null {
  if (job.status === "cancelled") return null;
  const start = job.scheduledStart ?? job.windowStart;
  if (!job.enRouteAt && !start) return null;
  const twoHoursBefore = start ? start.getTime() - 2 * 3600_000 : Infinity;
  const fromMs = Math.min(job.enRouteAt?.getTime() ?? Infinity, twoHoursBefore);
  const until = job.completedAt
    ? new Date(job.completedAt.getTime() + 24 * 3600_000)
    : new Date(8.64e15);
  return { from: new Date(fromMs), until };
}

/** Haversine distance in meters. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371e3;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line travel estimate (SPEC M05: distance ÷ 30 mph), minutes. */
export function travelMinutes(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  mph = 30,
): number {
  const miles = distanceMeters(a, b) / 1609.344;
  return Math.round((miles / mph) * 60);
}

export function formatDistance(m: number): string {
  const miles = m / 1609.344;
  return miles >= 0.2
    ? `${miles.toFixed(miles < 10 ? 1 : 0)} mi`
    : `${Math.round(m * 3.281)} ft`;
}

export function rangesOverlap(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && b.start < a.end;
}

// ------------------------------------------------------------------ cancellation fee

export interface CancellationPolicy {
  late_cancel_hours: number;
  late_cancel_fee_cents: number;
  no_show_fee_cents: number;
}

/** Fee for a cancellation (M05 cancellation policy), or null. */
export function cancellationFee(a: {
  reason: string;
  windowStart: Date | null;
  at: Date;
  policy: CancellationPolicy;
}): { kind: "no_show" | "late_cancel"; cents: number } | null {
  if (a.reason === "customer_no_show") {
    return a.policy.no_show_fee_cents > 0
      ? { kind: "no_show", cents: a.policy.no_show_fee_cents }
      : null;
  }
  if (a.reason === "customer_cancelled" && a.windowStart) {
    const hoursBefore = (a.windowStart.getTime() - a.at.getTime()) / 3600_000;
    if (
      hoursBefore < a.policy.late_cancel_hours &&
      a.policy.late_cancel_fee_cents > 0
    )
      return { kind: "late_cancel", cents: a.policy.late_cancel_fee_cents };
  }
  return null;
}

// ------------------------------------------------------------------ labels

export const CANCEL_REASON_LABEL: Record<string, string> = {
  customer_cancelled: "Customer cancelled",
  customer_no_show: "Customer no-show",
  no_access: "No access",
  price: "Price",
  duplicate: "Duplicate",
  tech_unavailable: "Tech unavailable",
  weather: "Weather",
  other: "Other",
};

export const HOLD_REASON_LABEL: Record<string, string> = {
  waiting_parts: "Waiting for parts",
  customer_approval: "Waiting for customer approval",
  second_day: "Needs another day",
  other: "Other",
};

export const PRIORITY_LABEL: Record<string, string> = {
  normal: "Normal",
  urgent: "Urgent",
  emergency: "Emergency",
};

export const CALLBACK_REASON_LABEL: Record<string, string> = {
  workmanship: "Workmanship",
  part: "Part failure",
  customer: "Customer issue",
  other: "Other",
};

export const ETA_CHOICES = [15, 30, 45, 60] as const;
