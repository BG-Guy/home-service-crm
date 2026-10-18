// Speed-to-lead SLA math (SPEC M04). Pure and client-safe.

import { zonedParts, zonedTimeToUtc } from "@/lib/time";

export interface BusinessHours {
  day: number; // 0 = Sunday
  open: string; // HH:MM
  close: string; // HH:MM
}

/** SLA breach thresholds in minutes (escalation pushes come from automations). */
export const SLA_THRESHOLDS = [5, 15] as const;

/**
 * Minutes between `from` and `to` that fall inside business hours (company TZ).
 * Used when `settings.leads.sla_business_hours` is on, so an overnight lead is not
 * "breached" before anyone could answer. Scans at most 14 days.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  hours: readonly BusinessHours[],
  tz: string,
): number {
  if (to <= from || hours.length === 0) return 0;
  let total = 0;
  const start = zonedParts(from, tz);
  // Walk calendar days in the company time zone.
  let y = start.year;
  let m = start.month;
  let d = start.day;
  for (let i = 0; i < 15; i++) {
    const dayStart = zonedTimeToUtc(
      { year: y, month: m, day: d, hour: 0, minute: 0 },
      tz,
    );
    if (dayStart > to) break;
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    for (const h of hours.filter((x) => x.day === weekday)) {
      const [oh, om] = h.open.split(":").map(Number) as [number, number];
      const [ch, cm] = h.close.split(":").map(Number) as [number, number];
      const open = zonedTimeToUtc(
        { year: y, month: m, day: d, hour: oh, minute: om },
        tz,
      );
      const close = zonedTimeToUtc(
        { year: y, month: m, day: d, hour: ch, minute: cm },
        tz,
      );
      const a = Math.max(open.getTime(), from.getTime());
      const b = Math.min(close.getTime(), to.getTime());
      if (b > a) total += (b - a) / 60_000;
    }
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return Math.floor(total);
}

/** Elapsed SLA minutes for an unanswered lead. */
export function slaMinutes(
  createdAt: Date,
  now: Date,
  opts: {
    businessHoursOnly: boolean;
    hours: readonly BusinessHours[];
    tz: string;
  },
): number {
  if (!opts.businessHoursOnly)
    return Math.max(
      0,
      Math.floor((now.getTime() - createdAt.getTime()) / 60_000),
    );
  return businessMinutesBetween(createdAt, now, opts.hours, opts.tz);
}
