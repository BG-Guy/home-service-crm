// Weekly working hours (users.work_hours) — pure, client-safe helpers shared by the
// team screen (Working hours) and booking availability. Company time zone; day 0 =
// Sunday; times "HH:MM" 24 h ("24:00" allowed as an end). A member with no list of
// their own (null) works the company's business hours (settings.company.business_hours).

export interface WorkHoursDay {
  day: number;
  start: string;
  end: string;
}

/** settings.company.business_hours row. */
export interface BusinessHoursDay {
  day: number;
  open: string;
  close: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for "HH:MM" ("24:00" → 1440), or null when malformed. */
export function hhmmMinutes(v: string): number | null {
  if (v === "24:00") return 1440;
  const m = HHMM.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** True for a usable row: day 0–6, both times valid, end after start. */
export function isValidWorkDay(r: WorkHoursDay): boolean {
  const s = hhmmMinutes(r.start);
  const e = hhmmMinutes(r.end);
  return (
    Number.isInteger(r.day) &&
    r.day >= 0 &&
    r.day <= 6 &&
    s !== null &&
    s < 1440 &&
    e !== null &&
    e > s
  );
}

/** Valid rows only, sorted by day then start (same-day spans kept). */
export function normalizeWorkHours(
  rows: readonly WorkHoursDay[],
): WorkHoursDay[] {
  return rows
    .filter(isValidWorkDay)
    .map((r) => ({ day: r.day, start: r.start, end: r.end }))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}

/** Business hours as work-hours rows. */
export function businessAsWorkHours(
  business: readonly BusinessHoursDay[],
): WorkHoursDay[] {
  return normalizeWorkHours(
    business.map((b) => ({ day: b.day, start: b.open, end: b.close })),
  );
}

/** A member's hours: their own list when set (even empty), else business hours. */
export function effectiveWorkHours(
  own: readonly WorkHoursDay[] | null | undefined,
  business: readonly BusinessHoursDay[],
): WorkHoursDay[] {
  return own ? normalizeWorkHours(own) : businessAsWorkHours(business);
}

/** The spans worked on a weekday (0 = Sunday). */
export function hoursOn(
  rows: readonly WorkHoursDay[],
  day: number,
): WorkHoursDay[] {
  return rows.filter((r) => r.day === day);
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "8 AM", "5:30 PM", "12 PM", "12 AM" (midnight, also for "24:00"). */
export function clockLabel(hhmm: string): string {
  const min = hhmmMinutes(hhmm);
  if (min === null) return hhmm;
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 || 12;
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * Short summary for lists: "Mon–Fri 8 AM–5 PM", "Mon–Fri 8 AM–5 PM · Sat 9 AM–1 PM",
 * "No regular hours" for an empty list. Days run Monday first.
 */
export function workHoursSummary(rows: readonly WorkHoursDay[]): string {
  const list = normalizeWorkHours(rows);
  if (list.length === 0) return "No regular hours";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const spanOf = (day: number) =>
    hoursOn(list, day)
      .map((r) => `${clockLabel(r.start)}–${clockLabel(r.end)}`)
      .join(", ");
  const parts: string[] = [];
  let i = 0;
  while (i < order.length) {
    const day = order[i] as number;
    const span = spanOf(day);
    if (!span) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < order.length && spanOf(order[j + 1] as number) === span) j++;
    const first = DAY_SHORT[day];
    const last = DAY_SHORT[order[j] as number];
    parts.push(`${j > i ? `${first}–${last}` : first} ${span}`);
    i = j + 1;
  }
  return parts.join(" · ");
}
