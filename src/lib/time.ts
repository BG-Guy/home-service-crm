// Time-zone helpers built on Intl only (no date libraries — SPEC §14).
// Timestamps are stored in UTC and rendered in the company time zone, except
// customer-facing quiet hours, which use the recipient's zone.
// Isomorphic: safe for server and client.

export const DEFAULT_TIMEZONE = "America/New_York";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFmtCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fall back to the default zone when `tz` is missing/invalid. */
export function safeTimeZone(
  tz: string | null | undefined,
  fallback = DEFAULT_TIMEZONE,
): string {
  return isValidTimeZone(tz) ? tz : fallback;
}

export function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(
  date: Date | string | number,
  timeZone: string,
): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(toDate(date))) {
    out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (New York in winter → -300). */
export function tzOffsetMinutes(
  date: Date | string | number,
  timeZone: string,
): number {
  const d = toDate(date);
  const p = zonedParts(d, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const ms = d.getTime() - (d.getTime() % 1000);
  return Math.round((asUtc - ms) / 60_000);
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date. Nonexistent times
 * (spring-forward gap) resolve forward; ambiguous times (fall-back) pick the earlier.
 */
export function zonedTimeToUtc(
  wall: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = wall;
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two-pass offset correction handles DST transitions.
  const off1 = tzOffsetMinutes(guess, timeZone);
  let ts = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(ts, timeZone);
  if (off2 !== off1) {
    const alt = guess - off2 * 60_000;
    const p = zonedParts(alt, timeZone);
    ts =
      p.hour === hour && p.minute === minute
        ? Math.min(ts, alt)
        : Math.max(ts, alt);
  }
  return new Date(ts);
}

/** 'YYYY-MM-DD' for `date` in `timeZone` (calendar day key). */
export function dateKey(
  date: Date | string | number,
  timeZone: string,
): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Parse 'YYYY-MM-DD' into numbers. */
export function parseDateKey(key: string): {
  year: number;
  month: number;
  day: number;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`invalid date key: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Add calendar days to a 'YYYY-MM-DD' key. */
export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/** UTC instant of local midnight starting the day that contains `date` in `timeZone`. */
export function startOfDayInTz(
  date: Date | string | number,
  timeZone: string,
): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** UTC instant of the next local midnight (exclusive end of the day). */
export function endOfDayInTz(
  date: Date | string | number,
  timeZone: string,
): Date {
  const next = addDaysToKey(dateKey(date, timeZone), 1);
  return zonedTimeToUtc(parseDateKey(next), timeZone);
}

/** Same wall-clock time `days` calendar days later in `timeZone` (DST-safe). */
export function addDaysInTz(
  date: Date | string | number,
  days: number,
  timeZone: string,
): Date {
  const p = zonedParts(date, timeZone);
  const key = addDaysToKey(dateKey(date, timeZone), days);
  return zonedTimeToUtc(
    { ...parseDateKey(key), hour: p.hour, minute: p.minute, second: p.second },
    timeZone,
  );
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(
  locale: string,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
) {
  const key = `${locale}|${timeZone}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export function formatInTz(
  date: Date | string | number | null | undefined,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
  locale = "en-US",
): string {
  if (date == null) return "";
  return formatter(locale, safeTimeZone(timeZone), opts).format(toDate(date));
}

/** "Oct 14, 2026" */
export const formatDate = (
  d: Date | string | number | null | undefined,
  tz: string,
  locale?: string,
) =>
  formatInTz(
    d,
    tz,
    { month: "short", day: "numeric", year: "numeric" },
    locale,
  );

/** "Tue, Oct 14" */
export const formatDayShort = (
  d: Date | string | number | null | undefined,
  tz: string,
  locale?: string,
) =>
  formatInTz(
    d,
    tz,
    { weekday: "short", month: "short", day: "numeric" },
    locale,
  );

/** "3:45 PM" */
export const formatTime = (
  d: Date | string | number | null | undefined,
  tz: string,
  locale?: string,
) => formatInTz(d, tz, { hour: "numeric", minute: "2-digit" }, locale);

/** "Oct 14, 2026, 3:45 PM" */
export const formatDateTime = (
  d: Date | string | number | null | undefined,
  tz: string,
  locale?: string,
) =>
  formatInTz(
    d,
    tz,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    locale,
  );

/** Arrival window "9:00 – 11:00 AM" (Intl formatRange). */
export function formatTimeRange(
  start: Date | string | number,
  end: Date | string | number,
  tz: string,
  locale = "en-US",
): string {
  const f = formatter(locale, safeTimeZone(tz), {
    hour: "numeric",
    minute: "2-digit",
  });
  return f.formatRange(toDate(start), toDate(end));
}

/** Format a 'YYYY-MM-DD' calendar date (no zone shifting). */
export function formatDateKey(
  key: string,
  locale = "en-US",
  opts?: Intl.DateTimeFormatOptions,
): string {
  const { year, month, day } = parseDateKey(key);
  return formatter(
    locale,
    "UTC",
    opts ?? { month: "short", day: "numeric", year: "numeric" },
  ).format(new Date(Date.UTC(year, month - 1, day)));
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "in 5 min", "2 days ago" (Intl.RelativeTimeFormat). */
export function formatRelative(
  date: Date | string | number,
  now: Date | number = Date.now(),
  locale = "en-US",
): string {
  const diffSec =
    (toDate(date).getTime() - (now instanceof Date ? now.getTime() : now)) /
    1000;
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (Math.abs(diffSec) >= secs || unit === "second") {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return rtf.format(0, "second");
}

/** Bind helpers to a time zone (e.g. the company's). */
export function tzHelpers(timeZone: string | null | undefined) {
  const tz = safeTimeZone(timeZone);
  return {
    tz,
    parts: (d: Date | string | number) => zonedParts(d, tz),
    dateKey: (d: Date | string | number) => dateKey(d, tz),
    startOfDay: (d: Date | string | number) => startOfDayInTz(d, tz),
    endOfDay: (d: Date | string | number) => endOfDayInTz(d, tz),
    addDays: (d: Date | string | number, n: number) => addDaysInTz(d, n, tz),
    toUtc: (wall: Parameters<typeof zonedTimeToUtc>[0]) =>
      zonedTimeToUtc(wall, tz),
    date: (d: Date | string | number | null | undefined) => formatDate(d, tz),
    time: (d: Date | string | number | null | undefined) => formatTime(d, tz),
    dateTime: (d: Date | string | number | null | undefined) =>
      formatDateTime(d, tz),
    dayShort: (d: Date | string | number | null | undefined) =>
      formatDayShort(d, tz),
  };
}
