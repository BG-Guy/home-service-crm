// Schedule map helpers (pure, client-safe, no I/O): route order and miles, job
// phase (done / live / late / unassigned), compact window labels, keyboard
// stepping and timeline lanes. Marker decluttering is the shared
// src/lib/declutter.ts (canvas chunk). Tests: tests/jobs/schedule-map.test.ts.

import type { JobStatus } from "../contracts";
import { milesBetween } from "../dispatch/recommend";
import type { SmPoint } from "./types";

/* ------------------------------------------------------------------ routes */

interface Orderable {
  id: string;
  startMin: number;
  createdAt: string;
}

/** Route order: window start, then created time, then id (stable). */
export function compareStops(a: Orderable, b: Orderable): number {
  return (
    a.startMin - b.startMin ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

interface Locatable {
  lat: number | null;
  lng: number | null;
}

const located = (p: Locatable): p is { lat: number; lng: number } =>
  p.lat != null && p.lng != null;

/**
 * The drawn route: the start (home base) when known, then every stop that has a
 * location, in route order. Stops without a location are skipped, not guessed.
 */
export function routePoints(
  start: SmPoint | null,
  stops: readonly Locatable[],
): SmPoint[] {
  const pts: SmPoint[] = start ? [{ lat: start.lat, lng: start.lng }] : [];
  for (const s of stops) if (located(s)) pts.push({ lat: s.lat, lng: s.lng });
  return pts;
}

/** Sum of the straight-line legs (haversine), rounded to 0.1 mi. */
export function routeMiles(points: readonly SmPoint[]): number {
  let mi = 0;
  for (let i = 1; i < points.length; i++)
    mi += milesBetween(points[i - 1] as SmPoint, points[i] as SmPoint);
  return Math.round(mi * 10) / 10;
}

export interface TechDay {
  jobIds: string[];
  miles: number;
  firstMin: number | null;
  lastMin: number | null;
}

/**
 * Each tech's day: their jobs (any assignee role) in route order, the route
 * miles from their start, and the first window start / last window end.
 */
export function buildTechDays<
  J extends Orderable & Locatable & { endMin: number; techIds: string[] },
>(
  techs: readonly { id: string; start: SmPoint | null }[],
  jobs: readonly J[],
): Map<string, TechDay> {
  const out = new Map<string, TechDay>();
  for (const t of techs) {
    const mine = jobs.filter((j) => j.techIds.includes(t.id));
    mine.sort(compareStops);
    out.set(t.id, {
      jobIds: mine.map((j) => j.id),
      miles: routeMiles(routePoints(t.start, mine)),
      firstMin: mine.length ? Math.min(...mine.map((j) => j.startMin)) : null,
      lastMin: mine.length ? Math.max(...mine.map((j) => j.endMin)) : null,
    });
  }
  return out;
}

export interface StopRef {
  techId: string;
  /** 1-based position in that tech's day. */
  seq: number;
  /** Stops in that tech's day. */
  of: number;
}

/** Where each job sits: on its primary tech's route (the first assignee). */
export function stopIndex(
  techs: readonly { id: string; jobIds: readonly string[] }[],
  jobs: readonly { id: string; techIds: readonly string[] }[],
): Map<string, StopRef> {
  const byTech = new Map(techs.map((t) => [t.id, t.jobIds]));
  const out = new Map<string, StopRef>();
  for (const j of jobs) {
    for (const techId of j.techIds) {
      const order = byTech.get(techId);
      const i = order ? order.indexOf(j.id) : -1;
      if (order && i >= 0) {
        out.set(j.id, { techId, seq: i + 1, of: order.length });
        break;
      }
    }
  }
  return out;
}

/** Arrow-key stepping through a route: the next/previous stop (clamped). */
export function neighborStop(
  order: readonly string[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i < 0) return (dir > 0 ? order[0] : order[order.length - 1]) ?? null;
  return order[Math.min(order.length - 1, Math.max(0, i + dir))] ?? null;
}

/* ------------------------------------------------------------------ phase */

export type DayRel = "past" | "today" | "future";

export interface JobPhase {
  done: boolean;
  /** On the way, arrived or in progress (pulsing ring). */
  live: boolean;
  /** The window has passed and nobody has arrived (red outline). */
  late: boolean;
  unassigned: boolean;
}

const DONE: readonly JobStatus[] = ["completed", "closed"];
const LIVE: readonly JobStatus[] = ["en_route", "arrived", "in_progress"];
const NOT_ARRIVED: readonly JobStatus[] = [
  "unscheduled",
  "scheduled",
  "confirmed",
  "en_route",
];

export function jobPhase(
  j: { status: JobStatus; endMin: number; techIds: readonly string[] },
  nowMin: number,
  day: DayRel,
): JobPhase {
  const passed = day === "past" || (day === "today" && nowMin > j.endMin);
  return {
    done: DONE.includes(j.status),
    live: LIVE.includes(j.status),
    late: passed && NOT_ARRIVED.includes(j.status),
    unassigned: j.techIds.length === 0,
  };
}

/** Marker / bar status tokens for CSS (`data-st~=late`). */
export function stTokens(p: JobPhase | undefined): string {
  if (!p) return "";
  return [
    p.done && "done",
    p.live && "live",
    p.late && "late",
    p.unassigned && "un",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Timeline lanes for one row: overlapping windows (a double booking) stack in
 * separate lanes instead of hiding each other. Greedy interval partitioning.
 */
export function lanes(
  items: readonly { id: string; startMin: number; endMin: number }[],
): { lane: Map<string, number>; count: number } {
  const lane = new Map<string, number>();
  const ends: number[] = [];
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  for (const it of sorted) {
    let i = ends.findIndex((e) => e <= it.startMin);
    if (i < 0) {
      i = ends.length;
      ends.push(it.endMin);
    } else ends[i] = it.endMin;
    lane.set(it.id, i);
  }
  return { lane, count: Math.max(1, ends.length) };
}

/* ------------------------------------------------------------------ labels */

const wrap = (min: number) => ((Math.round(min) % 1440) + 1440) % 1440;

/** "8", "8:30", "12"; with `ampm` "8a", "8:30a", "12p". */
export function clock(min: number, ampm = false): string {
  const m = wrap(min);
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h = h24 % 12 || 12;
  const base = mm ? `${h}:${String(mm).padStart(2, "0")}` : String(h);
  return ampm ? `${base}${h24 < 12 ? "a" : "p"}` : base;
}

/** Map box window: "8–10", "8:30–10", "11–1". */
export function compactWindow(startMin: number, endMin: number): string {
  return `${clock(startMin)}–${clock(endMin)}`;
}

/** Tech row day span: "8a–5p". */
export function compactRange(startMin: number, endMin: number): string {
  return `${clock(startMin, true)}–${clock(endMin, true)}`;
}

const long = (min: number) => {
  const m = wrap(min);
  const h24 = Math.floor(m / 60);
  return {
    t: `${h24 % 12 || 12}:${String(m % 60).padStart(2, "0")}`,
    pm: h24 >= 12,
  };
};

/** Details window: "8:00 – 10:00 AM", "11:00 AM – 1:00 PM". */
export function longWindow(startMin: number, endMin: number): string {
  const a = long(startMin);
  const b = long(endMin);
  const sa = a.pm ? "PM" : "AM";
  const sb = b.pm ? "PM" : "AM";
  return a.pm === b.pm
    ? `${a.t} – ${b.t} ${sb}`
    : `${a.t} ${sa} – ${b.t} ${sb}`;
}

/** Timeline hour tick: "8a", "12p", "5p". */
export const hourTick = (min: number) => clock(Math.floor(min / 60) * 60, true);

/**
 * Timeline span in whole hours: the earliest to the latest window ± 1 h (and
 * `now` on today), so the bars get the width; business hours on an empty day.
 */
export function timelineSpan(
  jobs: readonly { startMin: number; endMin: number }[],
  startHour: number,
  endHour: number,
  nowMin?: number | null,
): { startMin: number; endMin: number } {
  if (!jobs.length) {
    const s = Math.max(0, Math.min(23, startHour)) * 60;
    return {
      startMin: s,
      endMin: Math.max(s + 60, Math.min(24, endHour) * 60),
    };
  }
  let s = Math.min(...jobs.map((j) => j.startMin));
  let e = Math.max(...jobs.map((j) => j.endMin));
  if (nowMin != null && nowMin >= 0 && nowMin <= 1440) {
    s = Math.min(s, nowMin);
    e = Math.max(e, nowMin);
  }
  const startMin = Math.max(0, Math.floor(s / 60) * 60 - 60);
  const endMin = Math.min(48 * 60, Math.ceil(e / 60) * 60 + 60);
  return { startMin, endMin: Math.max(endMin, startMin + 180) };
}

const BUSINESS =
  /\b(llc|inc|co|corp|company|group|hoa|realty|homes?|properties|property|management|mgmt|services?|apartments?|associates|partners|trust|church|school|hotel|cafe|restaurant)\b\.?/i;

/**
 * "Dana Whitfield" → "Dana W."; companies keep their first words ("Oakridge
 * Realty"). `type` is the customer type; without it, business words decide.
 */
export function shortName(name: string, type?: string | null): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] ?? "";
  const business = type ? type !== "residential" : BUSINESS.test(name);
  if (business) {
    const two = `${words[0]} ${words[1]}`;
    return (words[0] as string).length >= 8 || two.length > 16
      ? (words[0] as string)
      : two;
  }
  const last = words[words.length - 1] as string;
  return `${words[0]} ${Array.from(last)[0]?.toUpperCase() ?? ""}.`;
}

export const plural = (n: number, w: string) =>
  `${n} ${w}${n === 1 ? "" : "s"}`;

/** Tech row meta: "4 jobs · 8a–5p · 23.4 mi" (without the count: `count=false`). */
export function techLine(
  t: {
    jobIds: readonly string[];
    firstMin: number | null;
    lastMin: number | null;
    miles: number;
  },
  count = true,
): string {
  if (!t.jobIds.length) return "No jobs";
  const parts = count ? [plural(t.jobIds.length, "job")] : [];
  if (t.firstMin != null && t.lastMin != null)
    parts.push(compactRange(t.firstMin, t.lastMin));
  if (t.miles > 0) parts.push(`${t.miles} mi`);
  return parts.join(" · ");
}
