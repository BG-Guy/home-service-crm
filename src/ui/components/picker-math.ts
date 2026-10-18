// Pure date/time math for DatePicker and TimePicker (client-safe, no React).
// Dates are 'YYYY-MM-DD' keys (calendar days, no zone); times are 'HH:MM' (24 h),
// the same strings native date/time inputs use.

import { addDaysToKey, formatDateKey, parseDateKey } from "@/lib/time";

export interface YearMonth {
  /** Full year, e.g. 2026. */
  y: number;
  /** 1–12. */
  m: number;
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/;

export const isDateKey = (s: string | null | undefined): s is string =>
  !!s && KEY.test(s);

/** Today in the browser's zone as a date key. */
export function localTodayKey(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function monthOf(key: string): YearMonth {
  const { year, month } = parseDateKey(key);
  return { y: year, m: month };
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const i = ym.y * 12 + (ym.m - 1) + n;
  return { y: Math.floor(i / 12), m: (((i % 12) + 12) % 12) + 1 };
}

/** Months from `a` to `b` (positive when `b` is later). */
export const monthDiff = (a: YearMonth, b: YearMonth) =>
  b.y * 12 + b.m - (a.y * 12 + a.m);

export const monthKey = (ym: YearMonth) =>
  `${ym.y}-${String(ym.m).padStart(2, "0")}`;

export const firstOfMonth = (ym: YearMonth) => `${monthKey(ym)}-01`;

/** 0 = Sunday … 6 = Saturday, for a date key (no zone involved). */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export interface GridDay {
  key: string;
  /** Day of month, 1–31. */
  day: number;
  inMonth: boolean;
}

/**
 * Always 6 weeks (42 days) so the calendar never changes height between months.
 * `weekStartsOn` 0 = Sunday (US), 1 = Monday.
 */
export function monthGrid(ym: YearMonth, weekStartsOn: 0 | 1 = 0): GridDay[] {
  const first = firstOfMonth(ym);
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const start = addDaysToKey(first, -lead);
  const out: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const key = addDaysToKey(start, i);
    const p = parseDateKey(key);
    out.push({ key, day: p.day, inMonth: p.month === ym.m && p.year === ym.y });
  }
  return out;
}

/**
 * How date fields show their value: "Sun, Oct 18" this year, "Oct 18, 2027" otherwise
 * (short enough for half-width fields on a phone).
 */
export function formatFieldDate(
  key: string,
  todayKey = localTodayKey(),
): string {
  return key.slice(0, 4) === todayKey.slice(0, 4)
    ? formatDateKey(key, "en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : formatDateKey(key, "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

/** Keys compare correctly as strings ('YYYY-MM-DD'). */
export function inRange(
  key: string,
  min?: string | null,
  max?: string | null,
): boolean {
  return !(isDateKey(min) && key < min) && !(isDateKey(max) && key > max);
}

export function clampKey(
  key: string,
  min?: string | null,
  max?: string | null,
): string {
  if (isDateKey(min) && key < min) return min;
  if (isDateKey(max) && key > max) return max;
  return key;
}

/** Start/end of the key's week (for Home / End in the grid). */
export function weekEdge(
  key: string,
  edge: "start" | "end",
  weekStartsOn: 0 | 1 = 0,
): string {
  const offset = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDaysToKey(key, edge === "start" ? -offset : 6 - offset);
}

/** Same day of month `n` months later, clamped to the month's last day. */
export function addMonthsToKey(key: string, n: number): string {
  const { year, month, day } = parseDateKey(key);
  const ym = addMonths({ y: year, m: month }, n);
  const last = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  return `${monthKey(ym)}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ time */

export interface Hm {
  /** 0–23 */
  h: number;
  /** 0–59 */
  m: number;
}

export function parseHm(s: string | null | undefined): Hm | null {
  const r = s ? HM.exec(s) : null;
  return r ? { h: Number(r[1]), m: Number(r[2]) } : null;
}

export const formatHm = ({ h, m }: Hm) =>
  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** 0–23 → 1–12 + PM flag. */
export function to12(h: number): { h12: number; pm: boolean } {
  return { h12: h % 12 === 0 ? 12 : h % 12, pm: h >= 12 };
}

/** 1–12 + PM flag → 0–23. */
export const to24 = (h12: number, pm: boolean) => (h12 % 12) + (pm ? 12 : 0);

/** "14:05" → "2:05 PM" (empty string for an invalid value). */
export function formatTime12(s: string | null | undefined): string {
  const t = parseHm(s);
  if (!t) return "";
  const { h12, pm } = to12(t.h);
  return `${h12}:${String(t.m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/** Minute values offered for a `step` in seconds (e.g. 900 → 0, 15, 30, 45). */
export function minuteOptions(stepSeconds?: number | string | null): number[] {
  const step = Math.round(Number(stepSeconds) / 60);
  const by = Number.isFinite(step) && step >= 1 && step <= 30 ? step : 1;
  const out: number[] = [];
  for (let m = 0; m < 60; m += by) out.push(m);
  return out;
}

/** The minute option nearest to `m` (wrapping), e.g. 52 with 15-min steps → 45. */
export function nearestMinute(m: number, options: readonly number[]): number {
  let best = options[0] ?? 0;
  for (const o of options) if (Math.abs(o - m) < Math.abs(best - m)) best = o;
  return best;
}
