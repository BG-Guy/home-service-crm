// Custom reminder recurrence (SPEC M13 "Custom reminders"). Pure + isomorphic: the
// cron hook advances `reminders.next_at`, the editor previews "Next: Mon 8:00 AM".
//
//   once          { type:'once', at: ISO }
//   daily         { type:'daily', time:'HH:MM' }
//   weekly        { type:'weekly', days:[0-6], time }          (0 = Sunday)
//   monthly       { type:'monthly', day:1-31, time }           (clamped to month end)
//   every_n_days  { type:'every_n_days', n, time, start?:'YYYY-MM-DD' }
//   every_n_months{ type:'every_n_months', n, time, start:'YYYY-MM-DD' }  (yearly = 12)
//   every_n_miles { type:'every_n_miles', miles, vehicle_id, base_odometer? }
//
// Times are local wall-clock in the company time zone (DST-safe).
import { z } from "zod";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/time";

const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const RecurrenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), at: z.string().min(1) }),
  z.object({ type: z.literal("daily"), time: hhmm }),
  z.object({
    type: z.literal("weekly"),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    time: hhmm,
  }),
  z.object({
    type: z.literal("monthly"),
    day: z.number().int().min(1).max(31),
    time: hhmm,
  }),
  z.object({
    type: z.literal("every_n_days"),
    n: z.number().int().min(1).max(3650),
    time: hhmm,
    start: dayKey.optional(),
  }),
  z.object({
    type: z.literal("every_n_months"),
    n: z.number().int().min(1).max(120),
    time: hhmm,
    start: dayKey,
  }),
  z.object({
    type: z.literal("every_n_miles"),
    miles: z.number().int().min(1).max(1_000_000),
    vehicle_id: z.string().uuid(),
    base_odometer: z.number().int().min(0).nullable().optional(),
  }),
]);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export { RECURRENCE_LABELS } from "./recurrence-labels";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function at(key: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  return zonedTimeToUtc(
    { ...parseDateKey(key), hour: h ?? 0, minute: m ?? 0 },
    tz,
  );
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthKey(y: number, m: number, day: number): string {
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * First occurrence strictly after `after` (null: never again, or mileage-based —
 * those are checked against the odometer instead of the clock).
 */
export function nextOccurrence(
  r: Recurrence,
  after: Date,
  tz: string,
): Date | null {
  const today = dateKey(after, tz);
  switch (r.type) {
    case "once": {
      const t = new Date(r.at);
      return Number.isNaN(t.getTime()) || t <= after ? null : t;
    }
    case "daily": {
      const t = at(today, r.time, tz);
      return t > after ? t : at(addDaysToKey(today, 1), r.time, tz);
    }
    case "weekly": {
      for (let i = 0; i <= 7; i++) {
        const key = addDaysToKey(today, i);
        const dow = zonedParts(at(key, "12:00", tz), tz).weekday;
        if (!r.days.includes(dow)) continue;
        const t = at(key, r.time, tz);
        if (t > after) return t;
      }
      return null;
    }
    case "monthly": {
      const { year, month } = parseDateKey(today);
      for (let i = 0; i < 3; i++) {
        const total = year * 12 + (month - 1) + i;
        const key = monthKey(Math.floor(total / 12), (total % 12) + 1, r.day);
        const t = at(key, r.time, tz);
        if (t > after) return t;
      }
      return null;
    }
    case "every_n_days": {
      const start = r.start ?? today;
      let diff = daysBetween(start, today);
      if (diff < 0) {
        const t = at(start, r.time, tz);
        return t > after ? t : at(addDaysToKey(start, r.n), r.time, tz);
      }
      diff = diff % r.n === 0 ? diff : diff + (r.n - (diff % r.n));
      const t = at(addDaysToKey(start, diff), r.time, tz);
      return t > after ? t : at(addDaysToKey(start, diff + r.n), r.time, tz);
    }
    case "every_n_months": {
      const s = parseDateKey(r.start);
      const { year, month } = parseDateKey(today);
      let k = Math.max(0, (year - s.year) * 12 + (month - s.month));
      k -= k % r.n;
      for (let i = 0; i < 3; i++) {
        const total = s.year * 12 + (s.month - 1) + k + i * r.n;
        const key = monthKey(Math.floor(total / 12), (total % 12) + 1, s.day);
        const t = at(key, r.time, tz);
        if (t > after) return t;
      }
      return null;
    }
    case "every_n_miles":
      return null;
  }
}

/** Mileage reminder due? (odometer has moved `miles` past the base reading). */
export function milesDue(
  r: Extract<Recurrence, { type: "every_n_miles" }>,
  odometer: number | null,
): boolean {
  if (odometer === null || odometer === undefined) return false;
  if (r.base_odometer === null || r.base_odometer === undefined) return false;
  return odometer - r.base_odometer >= r.miles;
}

/** "Every Mon, Wed at 8:00" style summary for lists. */
export function describeRecurrence(r: Recurrence): string {
  const t = (time: string) => {
    const [h = 0, m = 0] = time.split(":").map(Number);
    const ap = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${h12}:${String(m).padStart(2, "0")} ${ap}` : `${h12} ${ap}`;
  };
  switch (r.type) {
    case "once":
      return `Once`;
    case "daily":
      return `Every day at ${t(r.time)}`;
    case "weekly":
      return `Every ${[...r.days]
        .sort()
        .map((d) => DOW[d])
        .join(", ")} at ${t(r.time)}`;
    case "monthly":
      return `Monthly on day ${r.day} at ${t(r.time)}`;
    case "every_n_days":
      return r.n === 1
        ? `Every day at ${t(r.time)}`
        : `Every ${r.n} days at ${t(r.time)}`;
    case "every_n_months":
      return r.n === 12
        ? `Every year at ${t(r.time)}`
        : `Every ${r.n} months at ${t(r.time)}`;
    case "every_n_miles":
      return `Every ${r.miles.toLocaleString("en-US")} miles`;
  }
}
