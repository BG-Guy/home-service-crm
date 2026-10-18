// Pay period boundaries (SPEC M16 "Pay periods"). Pure; dates are 'YYYY-MM-DD'
// calendar keys in the company time zone.
import { addDaysToKey, parseDateKey } from "@/lib/time";

export interface PeriodConfig {
  period: "weekly" | "biweekly" | "semimonthly";
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
  /** Any first day of a bi-weekly period (aligns the 14-day grid). */
  biweeklyAnchor?: string;
}

export interface PeriodRange {
  startsOn: string;
  endsOn: string;
}

function weekday(key: string): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysBetween(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) -
      Date.UTC(pa.year, pa.month - 1, pa.day)) /
      86_400_000,
  );
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The period containing `day`. */
export function periodFor(day: string, cfg: PeriodConfig): PeriodRange {
  if (cfg.period === "semimonthly") {
    const { year, month, day: d } = parseDateKey(day);
    const mm = String(month).padStart(2, "0");
    if (d <= 15)
      return { startsOn: `${year}-${mm}-01`, endsOn: `${year}-${mm}-15` };
    return {
      startsOn: `${year}-${mm}-16`,
      endsOn: `${year}-${mm}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`,
    };
  }
  const back = (weekday(day) - cfg.weekStartsOn + 7) % 7;
  let start = addDaysToKey(day, -back);
  if (cfg.period === "biweekly") {
    const anchor = cfg.biweeklyAnchor ?? "2026-01-05";
    const aBack = (weekday(anchor) - cfg.weekStartsOn + 7) % 7;
    const a = addDaysToKey(anchor, -aBack);
    const diff = daysBetween(a, start);
    const mod = ((diff % 14) + 14) % 14;
    start = addDaysToKey(start, -mod);
    return { startsOn: start, endsOn: addDaysToKey(start, 13) };
  }
  return { startsOn: start, endsOn: addDaysToKey(start, 6) };
}

/** The period right after `p`. */
export function nextPeriod(p: PeriodRange, cfg: PeriodConfig): PeriodRange {
  return periodFor(addDaysToKey(p.endsOn, 1), cfg);
}

/** Every period overlapping [from, to]. */
export function periodsBetween(
  from: string,
  to: string,
  cfg: PeriodConfig,
): PeriodRange[] {
  const out: PeriodRange[] = [];
  let p = periodFor(from, cfg);
  while (p.startsOn <= to) {
    out.push(p);
    p = nextPeriod(p, cfg);
  }
  return out;
}

/** Calendar weeks (for the W-2 weekly OT check) inside a period. */
export function weeksIn(p: PeriodRange, weekStartsOn: number): PeriodRange[] {
  return periodsBetween(p.startsOn, p.endsOn, {
    period: "weekly",
    weekStartsOn,
  }).map((w) => ({
    startsOn: w.startsOn < p.startsOn ? p.startsOn : w.startsOn,
    endsOn: w.endsOn > p.endsOn ? p.endsOn : w.endsOn,
  }));
}

/** Day of week of a 'YYYY-MM-DD' key (0 = Sunday … 6 = Saturday). */
function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** ACH settles Monday–Friday (bank holidays aren't modeled). */
export function isBusinessDay(day: string): boolean {
  const w = weekdayOf(day);
  return w !== 0 && w !== 6;
}

/** The first business day strictly after `day` (NACHA effective date default, QA T3-16). */
export function nextBusinessDay(day: string): string {
  let d = addDaysToKey(day, 1);
  while (!isBusinessDay(d)) d = addDaysToKey(d, 1);
  return d;
}
