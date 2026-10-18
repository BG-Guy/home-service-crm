// Insights period selector (SPEC M20; BUILD_PLAN Appendix A `/insights?period=`).
// Pure and client-safe. A period is a run of whole calendar days in the company
// time zone: [fromKey, toKey] inclusive, i.e. instants [from, to). "This week" and
// "This month" run to date; the previous period has the same shape just before.
import {
  addDaysToKey,
  dateKey,
  formatDateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";

export const PERIODS = ["today", "week", "month", "last30", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
  last30: "30 days",
  custom: "Custom",
};

/** Headline names ("This week · compared with last week"); the segments use PERIOD_LABELS. */
const PERIOD_TITLES: Record<Exclude<PeriodKey, "custom">, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  last30: "Last 30 days",
};

/** "Oct 17, 2026", "Oct 12 – 17, 2026", "Dec 28, 2026 – Jan 3, 2027" (no ISO keys on screen). */
export function rangeText(fromKey: string, toKey: string): string {
  if (fromKey === toKey) return formatDateKey(fromKey);
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  if (a.year !== b.year)
    return `${formatDateKey(fromKey)} – ${formatDateKey(toKey)}`;
  const start = formatDateKey(fromKey, "en-US", {
    month: "short",
    day: "numeric",
  });
  const end =
    a.month === b.month
      ? `${b.day}, ${b.year}`
      : formatDateKey(toKey, "en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  return `${start} – ${end}`;
}

export interface DayRange {
  fromKey: string;
  toKey: string;
  /** Inclusive start instant (local midnight of fromKey). */
  from: Date;
  /** Exclusive end instant (local midnight after toKey). */
  to: Date;
  days: number;
}

export interface Period extends DayRange {
  key: PeriodKey;
  label: string;
  /** "vs yesterday", "vs last week" … */
  compareLabel: string;
  prev: DayRange;
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayCount(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  return (
    Math.round(
      (Date.UTC(b.year, b.month - 1, b.day) -
        Date.UTC(a.year, a.month - 1, a.day)) /
        86_400_000,
    ) + 1
  );
}

export function dayRange(fromKey: string, toKey: string, tz: string): DayRange {
  return {
    fromKey,
    toKey,
    from: zonedTimeToUtc(parseDateKey(fromKey), tz),
    to: zonedTimeToUtc(parseDateKey(addDaysToKey(toKey, 1)), tz),
    days: dayCount(fromKey, toKey),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Resolve `?period=&from=&to=` into concrete ranges. Invalid or missing input falls
 * back to `fallback` (default "week"); a custom range is clamped to 366 days and
 * never ends after today.
 */
export function resolvePeriod(
  q: { period?: string | null; from?: string | null; to?: string | null },
  now: Date,
  tz: string,
  opts: { weekStartsOn?: number; fallback?: PeriodKey } = {},
): Period {
  const today = dateKey(now, tz);
  const weekStartsOn = opts.weekStartsOn ?? 1;
  let key = (PERIODS as readonly string[]).includes(q.period ?? "")
    ? (q.period as PeriodKey)
    : (opts.fallback ?? "week");
  if (key === "custom" && !(q.from && KEY_RE.test(q.from))) key = "week";

  let fromKey = today;
  let toKey = today;
  let prev: DayRange;
  let compareLabel = "vs previous period";
  switch (key) {
    case "today": {
      const y = addDaysToKey(today, -1);
      prev = dayRange(y, y, tz);
      compareLabel = "vs yesterday";
      break;
    }
    case "week": {
      const { year, month, day } = parseDateKey(today);
      const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const back = (dow - weekStartsOn + 7) % 7;
      fromKey = addDaysToKey(today, -back);
      prev = dayRange(addDaysToKey(fromKey, -7), addDaysToKey(toKey, -7), tz);
      compareLabel = "vs last week";
      break;
    }
    case "month": {
      const { year, month, day } = parseDateKey(today);
      fromKey = `${year}-${pad(month)}-01`;
      const py = month === 1 ? year - 1 : year;
      const pm = month === 1 ? 12 : month - 1;
      const pEnd = Math.min(day, daysInMonth(py, pm));
      prev = dayRange(
        `${py}-${pad(pm)}-01`,
        `${py}-${pad(pm)}-${pad(pEnd)}`,
        tz,
      );
      compareLabel = "vs last month";
      break;
    }
    case "last30": {
      fromKey = addDaysToKey(today, -29);
      prev = dayRange(
        addDaysToKey(fromKey, -30),
        addDaysToKey(fromKey, -1),
        tz,
      );
      compareLabel = "vs prior 30 days";
      break;
    }
    case "custom": {
      fromKey = q.from as string;
      toKey = q.to && KEY_RE.test(q.to) ? q.to : fromKey;
      if (toKey < fromKey) [fromKey, toKey] = [toKey, fromKey];
      if (toKey > today) toKey = today;
      if (fromKey > toKey) fromKey = toKey;
      if (dayCount(fromKey, toKey) > 366) fromKey = addDaysToKey(toKey, -365);
      const n = dayCount(fromKey, toKey);
      prev = dayRange(addDaysToKey(fromKey, -n), addDaysToKey(fromKey, -1), tz);
      compareLabel = `vs prior ${n} day${n === 1 ? "" : "s"}`;
      break;
    }
  }
  const r = dayRange(fromKey, toKey, tz);
  return {
    ...r,
    key,
    label: key === "custom" ? rangeText(fromKey, toKey) : PERIOD_TITLES[key],
    compareLabel,
    prev,
  };
}

/** Query string for a period (drill-down links keep the period). */
export function periodQuery(
  p: Pick<Period, "key" | "fromKey" | "toKey">,
): string {
  return p.key === "custom"
    ? `period=custom&from=${p.fromKey}&to=${p.toKey}`
    : `period=${p.key}`;
}

/** `from=&to=` for list pages (Appendix A takes YYYY-MM-DD, inclusive). */
export function rangeQuery(p: Pick<DayRange, "fromKey" | "toKey">): string {
  return `from=${p.fromKey}&to=${p.toKey}`;
}
