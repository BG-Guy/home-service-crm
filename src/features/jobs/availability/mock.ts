// MOCK availability engine (pure, deterministic, no I/O). Same input → same days,
// seeded by the date and the address, so the calendar looks real and stays stable
// between visits. Real tech names and colors come in through `techs`.
//
// TODO(algo): replaced by the real engine (route + calendar + skills aware) behind
// ./index.ts `getAvailability`. Keep the output shape (./types.ts) unchanged.

import type {
  DayAvailability,
  DayStatus,
  TechSuggestion,
  WindowSlot,
} from "./types";
import {
  type BusinessHours,
  toMin,
  weekdayOf,
  windowLabel,
  windowsForDay,
} from "./windows";

export interface MockTech {
  id: string;
  name: string;
  color: string;
  avatarUrl: string | null;
}

export interface MockInput {
  from: string;
  to: string;
  /** Stable key for the job's location (property id, or normalized street + ZIP). */
  addressKey: string;
  serviceTypeId?: string | null;
  techs: readonly MockTech[];
  hours: readonly BusinessHours[];
  /** Company-local today and the minute of the day now (windows starting within the hour are full). */
  todayKey: string;
  nowMin: number;
  withWindows?: boolean;
}

/** FNV-1a 32-bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** Deterministic 0–1 for a key. */
const rnd = (key: string) => {
  let t = (hash(key) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + n))
    .toISOString()
    .slice(0, 10);
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function techsFor(
  date: string,
  start: string,
  end: string,
  i: MockInput,
): TechSuggestion[] {
  return i.techs
    .map((t) => {
      const k = `${date}|${start}|${i.addressKey}|${t.id}`;
      const miles = round1(0.4 + rnd(`mi|${k}`) * 9);
      const jobs = Math.floor(rnd(`jobs|${date}|${t.id}`) * 5);
      const score = miles + jobs * 1.5;
      const reasons = [
        `Adds ${miles} mi`,
        `Free ${windowLabel(start, end)}`,
        jobs === 0
          ? "Nothing booked yet"
          : `${jobs} job${jobs === 1 ? "" : "s"} that day`,
      ];
      return {
        s: {
          techId: t.id,
          name: t.name,
          color: t.color,
          avatarUrl: t.avatarUrl,
          extraMiles: miles,
          reasons,
        },
        score,
        busy: rnd(`busy|${k}`) < 0.3,
      };
    })
    .filter((x) => !x.busy)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.s);
}

interface Built {
  day: DayAvailability;
  /** Lower is better (avg extra miles of the suggested techs + days out). */
  score: number;
}

function buildDay(date: string, i: MockInput, dayIndex: number): Built {
  const wd = weekdayOf(date);
  let wins = windowsForDay(date, i.hours);
  // Closed Saturday (no hours set): a short mock morning so weekends look "limited".
  if (wins.length === 0 && wd === 6 && i.hours.length > 0)
    wins = [
      ["09:00", "11:00"],
      ["11:00", "13:00"],
    ];
  const base = `${date}|${i.addressKey}|${i.serviceTypeId ?? ""}`;
  const fullDay =
    rnd(`full|${base}`) < (wd === 0 ? 0.85 : wd === 6 ? 0.4 : 0.1);
  const pOpen = wd === 0 || wd === 6 ? 0.35 : 0.72;
  const windows: WindowSlot[] = wins.map(([start, end]) => {
    const past = date === i.todayKey && toMin(start) <= i.nowMin + 60;
    const open = !fullDay && !past && rnd(`win|${base}|${start}`) < pOpen;
    const ranked = open ? techsFor(date, start, end, i) : [];
    const [suggested, ...alternatives] = ranked;
    return {
      start,
      end,
      status: open && (suggested || i.techs.length === 0) ? "open" : "full",
      ...(suggested ? { suggested } : {}),
      alternatives: suggested ? alternatives.slice(0, 4) : [],
    };
  });
  const openWins = windows.filter((w) => w.status === "open");
  const openings = openWins.length;
  const status: DayStatus =
    openings === 0
      ? "full"
      : openings <= 1 || openings / windows.length < 0.5
        ? "limited"
        : "open";
  const miles = openWins
    .map((w) => w.suggested?.extraMiles ?? 5)
    .reduce((a, b) => a + b, 0);
  const score = openings ? miles / openings + dayIndex * 0.12 : Infinity;
  return {
    day: { date, status, openings, windows: i.withWindows ? windows : [] },
    score,
  };
}

/** Days from `from` to `to` (inclusive, today onward) with the top 3 marked `best`. */
export function mockAvailability(i: MockInput): DayAvailability[] {
  const first = i.from < i.todayKey ? i.todayKey : i.from;
  const built: Built[] = [];
  // Best days are ranked over a fixed horizon from today, so asking for one day
  // gives the same status as asking for the whole calendar.
  const horizonEnd = addDays(i.todayKey, 59);
  const last = i.to > horizonEnd ? i.to : horizonEnd;
  for (let d = i.todayKey, n = 0; d <= last && n < 400; d = addDays(d, 1), n++)
    built.push(buildDay(d, i, n));
  const best = new Set(
    built
      .filter((b) => b.day.status === "open")
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((b) => b.day.date),
  );
  return built
    .filter((b) => b.day.date >= first && b.day.date <= i.to)
    .map((b) =>
      best.has(b.day.date) ? { ...b.day, status: "best" as const } : b.day,
    );
}
