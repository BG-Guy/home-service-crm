// Pure KPI helpers (SPEC M20). Client-safe; golden-tested in tests/insights.

/** a ÷ b, or null when b is 0 (UI shows "—", never NaN or ∞). */
export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/** Relative change (0.12 = +12%); null without a meaningful base. */
export function change(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / Math.abs(prev);
}

/** Absolute change for rates (0.03 = +3 percentage points). */
export function pointChange(
  cur: number | null,
  prev: number | null,
): number | null {
  return cur == null || prev == null ? null : cur - prev;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function mean(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

export function stdev(values: readonly number[]): number | null {
  const m = mean(values);
  if (m == null || values.length < 2) return null;
  return Math.sqrt(
    values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1),
  );
}

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: readonly AgingBucket[] = [
  "0-30",
  "31-60",
  "61-90",
  "90+",
];

/** AR aging bucket by whole days since issue (SPEC M20: by `issued_at`). */
export function agingBucket(issuedAt: Date, now: Date): AgingBucket {
  const days = Math.floor((now.getTime() - issuedAt.getTime()) / 86_400_000);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/**
 * Cash-share outlier (anomaly report): above company mean + 2σ, or above 1.5× the
 * mean when there are fewer than 10 techs (σ is meaningless on tiny teams).
 */
export function isCashShareOutlier(
  share: number,
  all: readonly number[],
): boolean {
  const m = mean(all);
  if (m == null || m === 0) return false;
  if (all.length < 10) return share > 1.5 * m;
  const sd = stdev(all) ?? 0;
  return share > m + 2 * sd;
}

export interface BusinessDay {
  /** 0 = Sunday. */
  day: number;
  open: string; // HH:MM
  close: string; // HH:MM
}

function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Local wall-clock parts of an instant in a zone. */
function local(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "0";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    get("weekday"),
  );
  return {
    weekday: wd,
    minutes:
      Number(get("hour")) * 60 +
      Number(get("minute")) +
      Number(get("second")) / 60,
  };
}

/**
 * Minutes between two instants that fall inside business hours (speed-to-lead when
 * `leads.sla_business_hours`). Walks minute-accurate per local day; a lead that
 * arrives after hours starts counting at the next opening. Capped at 14 days.
 */
export function businessMinutesBetween(
  start: Date,
  end: Date,
  hours: readonly BusinessDay[],
  tz: string,
): number {
  if (end <= start) return 0;
  if (hours.length === 0) return (end.getTime() - start.getTime()) / 60_000;
  const byDay = new Map<number, [number, number][]>();
  for (const h of hours) {
    const list = byDay.get(h.day) ?? [];
    list.push([hm(h.open), hm(h.close)]);
    byDay.set(h.day, list);
  }
  let total = 0;
  let cursor = start.getTime();
  const stop = Math.min(end.getTime(), start.getTime() + 14 * 86_400_000);
  // Step one local day at a time: from cursor to the end of its local day.
  for (let guard = 0; cursor < stop && guard < 20; guard++) {
    const l = local(new Date(cursor), tz);
    const dayStartMs = cursor - l.minutes * 60_000;
    const dayEndMs = Math.min(dayStartMs + 1440 * 60_000, stop);
    const fromMin = l.minutes;
    const toMin = (dayEndMs - dayStartMs) / 60_000;
    for (const [o, c] of byDay.get(l.weekday) ?? []) {
      const a = Math.max(o, fromMin);
      const b = Math.min(c, toMin);
      if (b > a) total += b - a;
    }
    cursor = dayStartMs + 1440 * 60_000;
  }
  return total;
}
