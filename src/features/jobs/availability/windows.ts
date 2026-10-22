// Arrival windows for a day (pure, client-safe). Business hours from Settings →
// Company are split into 2-hour windows; a trailing piece of at least an hour is
// kept ("4–5"). Days without hours get no windows (closed).

export interface BusinessHours {
  day: number;
  open: string;
  close: string;
}

export const WINDOW_MIN = 120;
/** Used when the company has no business hours at all: 8–10 … 4–6. */
export const DEFAULT_WINDOWS: readonly [string, string][] = [
  ["08:00", "10:00"],
  ["10:00", "12:00"],
  ["12:00", "14:00"],
  ["14:00", "16:00"],
  ["16:00", "18:00"],
];

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};
export const toHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 0 = Sunday, for a 'YYYY-MM-DD' key. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, d)).getUTCDay();
}

/** The day's arrival windows ([start, end] local HH:MM). */
export function windowsForDay(
  key: string,
  hours: readonly BusinessHours[],
): [string, string][] {
  if (hours.length === 0) return DEFAULT_WINDOWS.map((w) => [...w]);
  const wd = weekdayOf(key);
  const out: [string, string][] = [];
  for (const h of hours.filter((x) => x.day === wd)) {
    const close = toMin(h.close);
    for (let s = toMin(h.open); close - s >= 60; s += WINDOW_MIN)
      out.push([toHHMM(s), toHHMM(Math.min(s + WINDOW_MIN, close))]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

const hour12 = (min: number) => {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : String(h);
};

/** Compact window label: "8–10", "12–2", "4:30–6". */
export function windowLabel(start: string, end: string): string {
  return `${hour12(toMin(start))}–${hour12(toMin(end))}`;
}

/** "10:00 AM – 12:00 PM" style with am/pm, for screen readers and detail lines. */
export function windowLabelLong(start: string, end: string): string {
  const f = (min: number) =>
    `${hour12(min)} ${Math.floor(min / 60) % 24 < 12 ? "AM" : "PM"}`;
  return `${f(toMin(start))} – ${f(toMin(end))}`;
}

/** Morning / Midday / Afternoon / Evening, from the window start. */
export function windowPart(start: string): string {
  const m = toMin(start);
  if (m < 12 * 60) return "Morning";
  if (m < 14 * 60) return "Midday";
  if (m < 16 * 60) return "Afternoon";
  return "Evening";
}
