// Arrival windows for a day (pure, client-safe). Working hours are split into
// 2-hour windows from the start of each span; a trailing piece of at least an hour
// is kept ("4–5"). Days nobody works get no windows (closed). The booking engine
// (./engine.ts) builds the day's grid from the team's working hours
// (`gridWindows`) and, with after-hours booking on, adds the evening and weekend
// windows around them (`afterHoursGrid`).

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

/** Shortest piece of a span kept as a window (a trailing "4–5"). */
export const MIN_WINDOW_MIN = 60;

/** Merge overlapping or touching [start, end) minute spans, sorted by start. */
export function mergeSpans(
  spans: readonly (readonly [number, number])[],
): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of [...spans]
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** 2-hour windows (minutes) over spans: from each merged span's start, a trailing piece of ≥ 1 h kept. */
export function gridWindows(
  spans: readonly (readonly [number, number])[],
): [number, number][] {
  const out: [number, number][] = [];
  for (const [open, close] of mergeSpans(spans))
    for (let s = open; close - s >= MIN_WINDOW_MIN; s += WINDOW_MIN)
      out.push([s, Math.min(s + WINDOW_MIN, close)]);
  return out;
}

/**
 * After-hours windows (minutes) inside [lo, hi] that don't overlap the working
 * windows: 2-hour steps forward from the end of a working window ("5–7", "7–8"),
 * backward from the start of one ("7–8" before an 8 AM start), and on a day nobody
 * works, a grid through `anchor` (the usual opening time). Pieces under an hour
 * are dropped.
 */
export function afterHoursGrid(
  working: readonly (readonly [number, number])[],
  lo: number,
  hi: number,
  anchor: number,
): [number, number][] {
  const taken = mergeSpans(working);
  const out: [number, number][] = [];
  const keep = (s: number, e: number) => {
    if (e - s >= MIN_WINDOW_MIN) out.push([s, e]);
  };
  const forward = (from: number, to: number) => {
    for (let s = from; s < to; s += WINDOW_MIN)
      keep(s, Math.min(s + WINDOW_MIN, to));
  };
  const backward = (from: number, to: number) => {
    for (let e = to; e > from; e -= WINDOW_MIN)
      keep(Math.max(e - WINDOW_MIN, from), e);
  };
  // Free gaps of [lo, hi] around the working windows.
  let cursor = lo;
  const gaps: [number, number, boolean, boolean][] = [];
  for (const [s, e] of taken) {
    if (s > cursor) gaps.push([cursor, Math.min(s, hi), cursor > lo, true]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < hi) gaps.push([cursor, hi, taken.length > 0, false]);
  for (const [from, to, afterWork, beforeWork] of gaps) {
    if (to <= from) continue;
    if (afterWork) forward(from, to);
    else if (beforeWork) backward(from, to);
    else {
      const a = Math.min(Math.max(anchor, from), to);
      backward(from, a);
      forward(a, to);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Outside business hours (the after-hours price applies): the window isn't inside
 * one of the weekday's business spans, or it's a weekend and weekends count as
 * after-hours (Settings → Company).
 */
export function isAfterHoursWindow(
  weekday: number,
  start: number,
  end: number,
  hours: readonly BusinessHours[],
  weekendsAfterHours: boolean,
): boolean {
  if (weekendsAfterHours && (weekday === 0 || weekday === 6)) return true;
  return !hours.some(
    (h) => h.day === weekday && toMin(h.open) <= start && end <= toMin(h.close),
  );
}
