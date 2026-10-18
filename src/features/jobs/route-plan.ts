// Route map planning for the schedule's map layout and the tech's "Today's route"
// card (SPEC M05). Pure and client-safe: no DB, no React. Stops are numbered per
// technician in visit order (window start; ties keep the input order). A tech's
// route line joins their located stops in that order with straight segments: no
// routing service and no paid maps API. A job without coordinates keeps its number
// but gets no pin, so the list can show it in a "not on the map" group.
import { TONE_VAR, type Tone, toneFor } from "@/ui/tone";

const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * A tech's calendar color, the same rule as the schedule board: a hex `users.color`,
 * a tone name, else a stable tone from the user id. Always a safe CSS color string
 * (a hex or `var(--…)`), so it can go into marker HTML.
 */
export function techColor(
  color: string | null | undefined,
  id: string,
): string {
  if (color && HEX.test(color)) return color;
  if (color && Object.hasOwn(TONE_VAR, color)) return TONE_VAR[color as Tone];
  return TONE_VAR[toneFor(id)];
}

/** Pins of jobs nobody is assigned to ("?"). */
export const UNASSIGNED_COLOR = TONE_VAR.gray;

export interface RouteJob {
  id: string;
  /** Window start (ISO): the visit order. */
  start: string | null;
  techIds: readonly string[];
  lat: number | null;
  lng: number | null;
}

export interface RouteLayerJob extends RouteJob {
  number: string;
  title: string;
  status: string;
}

export interface RouteStop<J> {
  job: J;
  techId: string;
  /** Visit number in this tech's day (1-based). Stops without coordinates keep theirs. */
  n: number;
}

export interface TechRoute<J> {
  techId: string;
  /** Every stop in visit order, located or not. */
  stops: RouteStop<J>[];
}

export interface RoutePlan<J> {
  /** Techs with at least one stop, in `techOrder`, then first appearance. */
  routes: TechRoute<J>[];
  /** Jobs nobody is assigned to, in visit order. */
  unassigned: J[];
}

export interface RoutePin {
  /** One pin per tech and stop (a shared job gets one pin per tech). */
  key: string;
  jobId: string;
  lat: number;
  lng: number;
  /** The stop number, or "?" for an unassigned job. */
  label: string;
  /** CSS color (hex or `var(--…)`). */
  color: string;
  /** Accessible name and tooltip. */
  title: string;
  /** Completed or closed: drawn faded. */
  done: boolean;
  /** Horizontal nudge in px so pins at the same spot sit side by side. */
  dx: number;
}

export interface RouteLine {
  key: string;
  color: string;
  /** The tech's located stops in visit order. */
  points: [number, number][];
}

const DONE = new Set(["completed", "closed"]);

/** Completed or closed (the visit already happened). */
export const isDoneStatus = (status: string) => DONE.has(status);

/** A usable coordinate: finite, in range and not 0,0. */
export function isLocated(p: {
  lat?: number | null;
  lng?: number | null;
}): boolean {
  const { lat, lng } = p;
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

const startMs = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** Compare two window starts: earlier first, missing starts last. */
export function compareStart(a: string | null, b: string | null): number {
  const ta = startMs(a);
  const tb = startMs(b);
  if (ta === tb) return 0;
  return ta < tb ? -1 : 1;
}

/** Visit order: window start ascending, jobs without a start last; ties keep input order. */
export function byVisitOrder<J extends { start: string | null }>(
  jobs: readonly J[],
): J[] {
  // Array#sort is stable, so equal starts keep their input order.
  return [...jobs].sort((a, b) => compareStart(a.start, b.start));
}

/**
 * Group one day's jobs into a route per tech, numbered in visit order. A job with a
 * helper is a stop on both techs' routes. Filter the jobs to one day first.
 */
export function planRoutes<J extends RouteJob>(
  jobs: readonly J[],
  techOrder: readonly string[] = [],
): RoutePlan<J> {
  const byTech = new Map<string, RouteStop<J>[]>();
  const unassigned: J[] = [];
  for (const job of byVisitOrder(jobs)) {
    if (job.techIds.length === 0) {
      unassigned.push(job);
      continue;
    }
    for (const techId of new Set(job.techIds)) {
      const stops = byTech.get(techId) ?? [];
      stops.push({ job, techId, n: stops.length + 1 });
      byTech.set(techId, stops);
    }
  }
  const rank = new Map(techOrder.map((id, i) => [id, i]));
  const routes = [...byTech].map(([techId, stops], i) => ({
    techId,
    stops,
    order: rank.get(techId) ?? techOrder.length + i,
  }));
  routes.sort((a, b) => a.order - b.order);
  return {
    routes: routes.map(({ techId, stops }) => ({ techId, stops })),
    unassigned,
  };
}

/** One tech's day as a plan, numbered in the given (already visit-ordered) order. */
export function singleRoute<J extends RouteJob>(
  techId: string,
  jobs: readonly J[],
): RoutePlan<J> {
  return {
    routes: jobs.length
      ? [{ techId, stops: jobs.map((job, i) => ({ job, techId, n: i + 1 })) }]
      : [],
    unassigned: [],
  };
}

/**
 * Map layers for a plan: a numbered pin per located stop in the tech's color, a "?"
 * pin per located unassigned job, and one line per tech with two or more located
 * stops. Pins at the same spot (a shared job, two jobs at one address) are nudged
 * apart so every number stays visible.
 */
export function routeLayers<J extends RouteLayerJob>(
  plan: RoutePlan<J>,
  look: { color: (techId: string) => string; name: (techId: string) => string },
): { pins: RoutePin[]; lines: RouteLine[] } {
  const pins: RoutePin[] = [];
  const lines: RouteLine[] = [];
  for (const route of plan.routes) {
    const color = look.color(route.techId);
    const name = look.name(route.techId);
    const points: [number, number][] = [];
    for (const s of route.stops) {
      if (!isLocated(s.job)) continue;
      const lat = s.job.lat as number;
      const lng = s.job.lng as number;
      points.push([lat, lng]);
      pins.push({
        key: `${route.techId}:${s.job.id}`,
        jobId: s.job.id,
        lat,
        lng,
        label: String(s.n),
        color,
        title: `Stop ${s.n}${name ? `, ${name}` : ""}: ${s.job.number} · ${s.job.title}`,
        done: isDoneStatus(s.job.status),
        dx: 0,
      });
    }
    if (points.length > 1) lines.push({ key: route.techId, color, points });
  }
  for (const job of plan.unassigned) {
    if (!isLocated(job)) continue;
    pins.push({
      key: `unassigned:${job.id}`,
      jobId: job.id,
      lat: job.lat as number,
      lng: job.lng as number,
      label: "?",
      color: UNASSIGNED_COLOR,
      title: `Unassigned: ${job.number} · ${job.title}`,
      done: isDoneStatus(job.status),
      dx: 0,
    });
  }
  const spots = new Map<string, RoutePin[]>();
  for (const p of pins) {
    const k = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    spots.set(k, [...(spots.get(k) ?? []), p]);
  }
  for (const group of spots.values())
    group.forEach((p, i) => {
      p.dx = (i - (group.length - 1) / 2) * 18;
    });
  return { pins, lines };
}

export interface UnlocatedStop<J> {
  job: J;
  /** The tech stops this job is (empty when unassigned). */
  stops: { techId: string; n: number }[];
}

/** Jobs in the plan that have no usable coordinates, in visit order (one entry per job). */
export function unlocatedStops<J extends RouteJob>(
  plan: RoutePlan<J>,
): UnlocatedStop<J>[] {
  const out = new Map<string, UnlocatedStop<J>>();
  for (const route of plan.routes)
    for (const s of route.stops) {
      if (isLocated(s.job)) continue;
      const entry = out.get(s.job.id) ?? { job: s.job, stops: [] };
      entry.stops.push({ techId: route.techId, n: s.n });
      out.set(s.job.id, entry);
    }
  for (const job of plan.unassigned)
    if (!isLocated(job) && !out.has(job.id))
      out.set(job.id, { job, stops: [] });
  return [...out.values()].sort((a, b) =>
    compareStart(a.job.start, b.job.start),
  );
}
