// Automation step timing (SPEC §7.2, M13). Pure and isomorphic so it is golden-tested
// and reused by the editor's "next send" preview.
//
// send_at = anchor time + delay (negative allowed). Days are calendar days in the
// company time zone (DST-safe); hours/minutes are absolute. `at: "HH:MM"` (or the
// `fixed_time_local HH:MM` anchor) then pins the local wall-clock time on that day.
// When send_at is already past at schedule time:
//   - the anchor passed more than `expires_after_minutes` ago → `expired` (never sent late);
//   - otherwise → send now.
import type { AutomationStep } from "@/db/schema/messaging";
import {
  addDaysInTz,
  dateKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/time";

export type StepDelay = { minutes?: number; hours?: number; days?: number };

/**
 * A step as stored in `automations.steps` (jsonb). Extends the frozen schema type with
 * optional engine fields (all optional, so old rows stay valid).
 */
export interface EngineStep extends AutomationStep {
  delay?: StepDelay;
  /** See ANCHORS; `fixed_time_local HH:MM` is accepted too. Default `event_time`. */
  anchor?: string;
  /** Pin the local wall-clock time after the delay ("09:00"). */
  at?: string;
  /** `sms` | `email` | `push` | `in_app` | `whatsapp` | `customer_preferred`; `+` joins several. */
  channel: string;
  /** See AUDIENCES; `+` joins several (e.g. `admins+subject_user`). */
  audience: string;
  template_key: string;
  /**
   * Dedupe scope: `entity` (default: once per entity + step + recipient), `event`
   * (once per triggering event — for things that legitimately repeat, e.g. reschedules),
   * `batch` (one per recipient per `batch_minutes` window).
   */
  dedupe?: "entity" | "event" | "batch";
  batch_minutes?: number;
  /** Only run this step for these trigger events (multi-trigger automations). */
  only_on?: string[];
  /** Extra per-step condition (same grammar as automation conditions). */
  when?: unknown;
  /** Add N calendar months taken from a context field (e.g. `service_type.maintenance_interval_months`). */
  delay_months_field?: string;
}

export const ANCHORS = [
  "event_time",
  "job.scheduled_start",
  "job.window_start",
  "job.window_end",
  "job.completed_at",
  "invoice.due_at",
  "dispute.due_by",
  "deposit.capture_before",
  "entity.expires_on",
] as const;
export type AnchorKey = (typeof ANCHORS)[number];

export const ANCHOR_LABELS: Record<AnchorKey, string> = {
  event_time: "When it happens",
  "job.scheduled_start": "Job start",
  "job.window_start": "Arrival window start",
  "job.window_end": "Arrival window end",
  "job.completed_at": "Job completed",
  "invoice.due_at": "Invoice due date",
  "dispute.due_by": "Dispute response deadline",
  "deposit.capture_before": "Card hold expiry",
  "entity.expires_on": "Expiry date",
};

export type ParsedAnchor =
  | { kind: "event_time" }
  | { kind: "field"; key: Exclude<AnchorKey, "event_time"> }
  | { kind: "fixed_time_local"; time: string };

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseAnchor(anchor: string | undefined | null): ParsedAnchor {
  // "a|b" = fallback chain; the first entry decides the kind for parsing purposes.
  const a = ((anchor ?? "event_time").split("|")[0] ?? "").trim();
  if (a === "" || a === "event_time") return { kind: "event_time" };
  const fixed = /^fixed_time_local\s+(\d{1,2}:\d{2})$/.exec(a);
  if (fixed?.[1] && HHMM.test(fixed[1]))
    return { kind: "fixed_time_local", time: fixed[1] };
  if ((ANCHORS as readonly string[]).includes(a))
    return { kind: "field", key: a as Exclude<AnchorKey, "event_time"> };
  throw new RangeError(`Unknown anchor "${a}"`);
}

/** Absolute part of a delay (hours + minutes) in ms. */
export function delayClockMs(d: StepDelay | undefined): number {
  return ((d?.hours ?? 0) * 60 + (d?.minutes ?? 0)) * 60_000;
}

/** Human label: "+90 min", "−24 h", "+2 d", "now". */
export function formatDelay(d: StepDelay | undefined): string {
  const parts: string[] = [];
  const total =
    (d?.days ?? 0) * 1440 + (d?.hours ?? 0) * 60 + (d?.minutes ?? 0);
  if (total === 0) return "Immediately";
  const sign = total < 0 ? "−" : "+";
  const abs = Math.abs;
  if (d?.days) parts.push(`${abs(d.days)} d`);
  if (d?.hours) parts.push(`${abs(d.hours)} h`);
  if (d?.minutes) parts.push(`${abs(d.minutes)} min`);
  return `${sign}${parts.join(" ")}`;
}

function setLocalTime(base: Date, hhmm: string, tz: string): Date {
  const m = HHMM.exec(hhmm.trim());
  if (!m) throw new RangeError(`invalid time "${hhmm}"`);
  return zonedTimeToUtc(
    {
      ...parseDateKey(dateKey(base, tz)),
      hour: Number(m[1]),
      minute: Number(m[2]),
    },
    tz,
  );
}

export interface ComputeSendInput {
  step: Pick<EngineStep, "delay" | "anchor" | "at">;
  /** Extra calendar months (resolved `delay_months_field`). */
  months?: number;
  /** When the triggering event happened. */
  eventAt: Date;
  /** Values for field anchors (null/undefined = not available). */
  anchors?: Partial<Record<AnchorKey, Date | string | null | undefined>>;
  /** Company time zone (calendar-day delays and `at`). */
  timeZone: string;
}

export interface ComputedSend {
  /** Anchor instant (null when the anchor value is missing → the step is skipped). */
  anchorAt: Date | null;
  /** Planned send time (anchor + delay, with `at` applied). */
  sendAt: Date | null;
}

/** Anchor + delay (+ `at`). Pure; no "now" handling (see `resolveSendTime`). */
function resolveAnchor(
  anchor: string | undefined,
  i: ComputeSendInput,
): { parsed: ParsedAnchor; at: Date } | null {
  for (const part of (anchor ?? "event_time").split("|")) {
    const parsed = parseAnchor(part);
    if (parsed.kind !== "field") return { parsed, at: i.eventAt };
    const raw = i.anchors?.[parsed.key];
    const d = raw ? new Date(raw) : null;
    if (d && !Number.isNaN(d.getTime())) return { parsed, at: d };
  }
  return null;
}

/** `months` calendar months later, same local wall clock (day clamped to month end). */
export function addMonthsInTz(date: Date, months: number, tz: string): Date {
  if (!months) return date;
  const key = dateKey(date, tz);
  const { year, month, day } = parseDateKey(key);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const target = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  const diffDays = Math.round(
    (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) /
      86_400_000,
  );
  return addDaysInTz(date, diffDays, tz);
}

export function computeSendAt(i: ComputeSendInput): ComputedSend {
  const r = resolveAnchor(i.step.anchor, i);
  if (!r) return { anchorAt: null, sendAt: null };
  const { parsed } = r;
  const anchorAt = r.at;
  let at = i.step.at;
  if (parsed.kind === "fixed_time_local") at = parsed.time;
  let t = anchorAt;
  if (i.months) t = addMonthsInTz(t, i.months, i.timeZone);
  const days = i.step.delay?.days ?? 0;
  if (days) t = addDaysInTz(t, days, i.timeZone);
  t = new Date(t.getTime() + delayClockMs(i.step.delay));
  if (at) {
    const pinned = setLocalTime(t, at, i.timeZone);
    // `fixed_time_local` with no day delay means "the next HH:MM after the event".
    t =
      parsed.kind === "fixed_time_local" && days === 0 && pinned <= anchorAt
        ? addDaysInTz(pinned, 1, i.timeZone)
        : pinned;
  }
  return { anchorAt, sendAt: t };
}

export type SendDecision =
  | { status: "scheduled"; sendAt: Date; expiresAt: Date | null }
  | { status: "expired"; sendAt: Date; expiresAt: Date | null }
  | { status: "skip"; reason: "no_anchor" };

/**
 * Apply the "already past" rules of §7.2 to a computed send:
 *  - send_at in the future → scheduled at send_at;
 *  - past, and the anchor passed more than `expiresAfterMinutes` ago → expired;
 *  - past, and the card's lifetime (planned send_at + expiry) is over → expired;
 *  - past otherwise → scheduled now.
 * expiresAt = planned send_at + expiresAfterMinutes (the outbox card's lifetime; e.g.
 * the 2 h reminder (−2 h, 120 min) expires exactly at window start).
 */
export function resolveSendTime(
  c: ComputedSend,
  now: Date,
  expiresAfterMinutes: number | null | undefined,
): SendDecision {
  if (!c.anchorAt || !c.sendAt) return { status: "skip", reason: "no_anchor" };
  const exp =
    expiresAfterMinutes != null && expiresAfterMinutes > 0
      ? expiresAfterMinutes * 60_000
      : null;
  const expiresAt = exp !== null ? new Date(c.sendAt.getTime() + exp) : null;
  if (c.sendAt.getTime() > now.getTime())
    return { status: "scheduled", sendAt: c.sendAt, expiresAt };
  if (exp !== null && now.getTime() - c.anchorAt.getTime() > exp)
    return { status: "expired", sendAt: c.sendAt, expiresAt };
  if (expiresAt && expiresAt.getTime() <= now.getTime())
    return { status: "expired", sendAt: c.sendAt, expiresAt };
  return { status: "scheduled", sendAt: now, expiresAt };
}

/** True when a step's anchor is the event time (or fixed local time). */
export function isEventAnchored(step: Pick<EngineStep, "anchor">): boolean {
  return (step.anchor ?? "event_time")
    .split("|")
    .every((a) => parseAnchor(a).kind !== "field");
}

/**
 * Dedupe key for one scheduled send (unique in scheduled_messages):
 *   auto:<automationKey>:<entityId>:<stepIndex>:<recipient>[:<channel>][:<suffix>]
 * Field-anchored steps add the anchor epoch so a reschedule (new anchor) re-creates
 * the send after the old one was canceled, while a re-emitted event with the same
 * anchor is a no-op. `event` scope adds the event id; `batch` scope replaces the
 * entity with the batch window.
 */
export function dedupeKeyFor(i: {
  automationKey: string;
  entityId: string;
  stepIndex: number;
  recipient: string;
  channel: string;
  step: Pick<EngineStep, "anchor" | "dedupe" | "batch_minutes">;
  anchorAt: Date | null;
  eventId: number | string;
  now: Date;
}): string {
  const parts = ["auto", i.automationKey];
  if (i.step.dedupe === "batch") {
    const win = Math.max(1, i.step.batch_minutes ?? 15) * 60_000;
    parts.push(`batch${Math.floor(i.now.getTime() / win)}`);
  } else parts.push(i.entityId);
  parts.push(String(i.stepIndex), i.recipient, i.channel);
  if (i.step.dedupe === "event") parts.push(`e${i.eventId}`);
  if (!isEventAnchored(i.step) && i.anchorAt)
    parts.push(`a${i.anchorAt.getTime()}`);
  return parts.join(":");
}

/** Prefix that matches every send of an automation for one entity (cancellation). */
export function dedupePrefixFor(automationKey: string, entityId: string) {
  return `auto:${automationKey}:${entityId}:`;
}

/** Next window boundary for batched steps (sends at the end of the window). */
export function batchSendAt(now: Date, minutes: number): Date {
  const win = Math.max(1, minutes) * 60_000;
  return new Date((Math.floor(now.getTime() / win) + 1) * win);
}

/** Split "a+b" lists (channels, audiences), trimmed and de-duplicated. */
export function splitPlus(v: string | null | undefined): string[] {
  return [
    ...new Set(
      (v ?? "")
        .split("+")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** Split multi-trigger "a|b" event lists. */
export function splitTriggers(v: string | null | undefined): string[] {
  return [
    ...new Set(
      (v ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** Weekly opening hours row (settings.company.business_hours; day 0 = Sunday). */
export interface BusinessHoursRow {
  day: number;
  open: string;
  close: string;
}

function hhmmToMinutes(v: string): number | null {
  const m = HHMM.exec(v.trim());
  return m
    ? Number(m[1]) * 60 + Number(m[2])
    : v.trim() === "24:00"
      ? 1440
      : null;
}

/**
 * True when `at` falls inside the company's opening hours (company time zone).
 * Used by `lead_ack` to switch to the after-hours template (SPEC §7.3 note).
 * No rows configured → always "open" (never claim we're closed by accident).
 */
export function isWithinBusinessHours(
  at: Date,
  tz: string,
  hours: readonly BusinessHoursRow[] | null | undefined,
): boolean {
  if (!hours || hours.length === 0) return true;
  const p = zonedParts(at, tz);
  const minute = p.hour * 60 + p.minute;
  return hours.some((h) => {
    if (h.day !== p.weekday) return false;
    const open = hhmmToMinutes(h.open);
    const close = hhmmToMinutes(h.close);
    if (open === null || close === null) return false;
    return close > open
      ? minute >= open && minute < close
      : minute >= open || minute < close;
  });
}
