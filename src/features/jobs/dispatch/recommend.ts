// Assign hub recommendation engine (pure, client-safe, no I/O). Ranks technicians
// for one job on one day by how little the job bends their route, then by load.
// Golden tests: tests/golden/dispatch-recommend.test.ts.
//
// ⚖️ Fairness rule: the engine only knows what a dispatcher needs to plan a
// route — locations, time windows, the day's load, clock status and listed
// skills. It deliberately has NO field for age, date of birth, or anything
// derived from them, and `toTechInput` copies only the fields below, so extra
// properties on a caller's object (a team record with `birthDate`) can never
// leak into a score. Ranking people by age for work assignment is age
// discrimination (ADEA and state law); keep it that way. Experience and tenure
// are shown to the dispatcher but are not scored either.

import { milesBetween } from "@/lib/geo";
//
// Score (lower is better), in "mile equivalents":
//   score = extraMiles (or NO_ROUTE_MILES when nothing can be measured)
//         + OVERLAP_PENALTY   when the job can't fit without overlapping a stop
//         + OVERLOAD_PENALTY  when the tech is at or over the daily job cap
//         + LOAD_PER_JOB × jobs already that day        (spreads the work)
//         + NOT_CLOCKED_PENALTY when the day is today and they're not clocked in
//         + NO_SKILL_PENALTY  when their skill list doesn't include the service
//         + TIGHT_PENALTY     when the drive is longer than the gap around the slot
// extraMiles = d(prev, job) + d(job, next) − d(prev, next) at the cheapest
// feasible slot (haversine, straight lines; no routing API, free by default).
//
// `arrivalFit` (bottom of the file) is the booking calendar's timing check for a
// 2-hour arrival window (src/features/jobs/availability/engine.ts): the job's
// length plus the drive from the previous stop must start inside the window,
// inside the tech's working hours and around time off, without pushing a later
// job past its own window. The calendar runs it next to `recommendTechs` (same
// stops, haversine and speed), which still supplies the score and the overlap and
// cap rules, so the calendar and the Assign hub agree.

export const NO_ROUTE_MILES = 10;
export const OVERLAP_PENALTY = 25;
export const OVERLOAD_PENALTY = 20;
export const LOAD_PER_JOB = 1.5;
export const NOT_CLOCKED_PENALTY = 8;
export const NO_SKILL_PENALTY = 6;
export const TIGHT_PENALTY = 3;
export const DEFAULT_MAX_JOBS = 6;
export const DEFAULT_MPH = 30;
const MIN = 60_000;
const SLOT_STEP = 15 * MIN;

export interface LatLng {
  lat: number;
  lng: number;
}

/** One stop already on a tech's day (epoch ms; `end` defaults to start + 60 min). */
export interface RecStop {
  id: string;
  lat: number | null;
  lng: number | null;
  start: number | null;
  end: number | null;
}

/** What the engine knows about a technician. Nothing else is read. */
export interface RecTech {
  id: string;
  /** Active user who can take work that day (not deactivated / not on time off). */
  available: boolean;
  clockedIn: boolean;
  /** Home base (or the company address); null → the first stop is the start. */
  start: LatLng | null;
  stops: readonly RecStop[];
  /** Service type ids the tech is listed for; empty = no restriction. */
  skills?: readonly string[];
}

export interface RecJob {
  id: string;
  lat: number | null;
  lng: number | null;
  /** Fixed arrival window (epoch ms), or null when the job has no time yet. */
  start: number | null;
  end: number | null;
  /** Expected time on site (window length or service type default). */
  durationMin: number;
  serviceTypeId?: string | null;
  /** For the skill reason ("Not listed for Rekey"). */
  serviceName?: string | null;
}

export interface RecContext {
  /** The planned day is today (clock status matters). */
  isToday: boolean;
  /** Working day bounds for untimed jobs (epoch ms). */
  dayStart: number;
  dayEnd: number;
  /** Not before this instant (now, on today). */
  notBefore?: number;
  maxJobsPerDay?: number;
  mph?: number;
  /** Clock-time label for reasons ("1:30 PM"); default UTC HH:MM. */
  timeLabel?: (ms: number) => string;
}

export interface Recommendation {
  techId: string;
  score: number;
  /** Extra straight-line miles; null when the job or route has no location. */
  extraMiles: number | null;
  /** Stop id the job goes after, or "start". */
  insertAfter: string;
  /** Stop id the job goes before, or null (end of the day). */
  insertBefore: string | null;
  fits: boolean;
  reasons: string[];
  rank: number;
  /** Proposed arrival for an untimed job (epoch ms), else the job's own start. */
  suggestedStart: number | null;
}

/** Haversine distance in miles (shared in `@/lib/geo`; re-exported for callers here). */
export { milesBetween };

const round1 = (n: number) => Math.round(n * 10) / 10;
const pt = (s: { lat: number | null; lng: number | null }): LatLng | null =>
  s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
const endOf = (s: RecStop): number | null =>
  s.end ?? (s.start != null ? s.start + 60 * MIN : null);
const defaultLabel = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * Copies only the fields the engine is allowed to use. Callers may pass a richer
 * object (a team record); anything else on it — including date of birth — is
 * dropped here, before scoring.
 */
export function toTechInput(t: RecTech): RecTech {
  return {
    id: t.id,
    available: t.available,
    clockedIn: t.clockedIn,
    start: t.start ? { lat: t.start.lat, lng: t.start.lng } : null,
    stops: t.stops.map((s) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      start: s.start,
      end: s.end,
    })),
    skills: t.skills ? [...t.skills] : [],
  };
}

interface Slot {
  /** Index in the sorted stops the job goes before (0 … n). */
  at: number;
  extra: number | null;
  fits: boolean;
  tight: boolean;
  overlapWith: string | null;
  start: number | null;
  gapFrom: number | null;
  gapTo: number | null;
}

function evaluateSlots(
  job: RecJob,
  tech: RecTech,
  stops: RecStop[],
  ctx: RecContext,
): Slot[] {
  const mph = ctx.mph ?? DEFAULT_MPH;
  const jp = pt(job);
  const driveMs = (a: LatLng | null, b: LatLng | null) =>
    a && b ? (milesBetween(a, b) / mph) * 60 * MIN : 0;
  const dur = Math.max(15, job.durationMin) * MIN;
  const out: Slot[] = [];
  // Candidate positions: a timed job goes where its start falls; an untimed one
  // may go in any gap.
  const positions: number[] = [];
  const jobStart = job.start;
  if (jobStart != null) {
    let at = stops.findIndex((s) => s.start != null && s.start > jobStart);
    if (at < 0) at = stops.length;
    positions.push(at);
  } else for (let i = 0; i <= stops.length; i++) positions.push(i);

  for (const at of positions) {
    const prevStop = at > 0 ? (stops[at - 1] as RecStop) : null;
    const nextStop = at < stops.length ? (stops[at] as RecStop) : null;
    // Nearest located point before / after the slot (stops without a location
    // still count for time, not for distance).
    let prevPt: LatLng | null = tech.start;
    for (let i = at - 1; i >= 0; i--) {
      const p = pt(stops[i] as RecStop);
      if (p) {
        prevPt = p;
        break;
      }
    }
    let nextPt: LatLng | null = null;
    for (let i = at; i < stops.length; i++) {
      const p = pt(stops[i] as RecStop);
      if (p) {
        nextPt = p;
        break;
      }
    }
    let extra: number | null = null;
    if (jp && (prevPt || nextPt)) {
      const a = prevPt ? milesBetween(prevPt, jp) : 0;
      const b = nextPt ? milesBetween(jp, nextPt) : 0;
      const ab = prevPt && nextPt ? milesBetween(prevPt, nextPt) : 0;
      extra = Math.max(0, a + b - ab);
    }
    // Time feasibility.
    const prevEnd = prevStop ? endOf(prevStop) : null;
    const gapFrom = Math.max(
      prevEnd ?? ctx.dayStart,
      ctx.dayStart,
      ctx.notBefore ?? Number.NEGATIVE_INFINITY,
    );
    const gapTo = Math.min(nextStop?.start ?? ctx.dayEnd, ctx.dayEnd);
    const inDrive = driveMs(prevStop ? pt(prevStop) : null, jp);
    const outDrive = driveMs(jp, nextStop ? pt(nextStop) : null);
    let fits: boolean;
    let tight = false;
    let overlapWith: string | null = null;
    let start: number | null;
    if (job.start != null) {
      const jEnd = job.end ?? job.start + dur;
      start = job.start;
      for (const s of stops) {
        const ss = s.start;
        const se = endOf(s);
        if (ss != null && se != null && job.start < se && ss < jEnd) {
          overlapWith = s.id;
          break;
        }
      }
      fits = overlapWith == null;
      if (fits)
        tight =
          (prevEnd != null && prevEnd + inDrive > job.start) ||
          (nextStop?.start != null && jEnd + outDrive > nextStop.start);
    } else {
      const earliest =
        Math.ceil((gapFrom + (prevStop ? inDrive : 0)) / SLOT_STEP) * SLOT_STEP;
      start = earliest;
      fits = earliest + dur + (nextStop ? outDrive : 0) <= gapTo;
    }
    out.push({ at, extra, fits, tight, overlapWith, start, gapFrom, gapTo });
  }
  return out;
}

function pickSlot(slots: Slot[]): Slot {
  const cost = (s: Slot) => (s.extra ?? 0) + (s.fits ? 0 : 1000);
  let best = slots[0] as Slot;
  for (const s of slots.slice(1)) if (cost(s) < cost(best)) best = s;
  return best;
}

/** Rank every technician for `job` on the context's day (lowest score first). */
export function recommendTechs(
  job: RecJob,
  techs: readonly RecTech[],
  ctx: RecContext,
): Recommendation[] {
  const maxJobs = ctx.maxJobsPerDay ?? DEFAULT_MAX_JOBS;
  const label = ctx.timeLabel ?? defaultLabel;
  const jobLocated = pt(job) != null;
  const recs: Recommendation[] = [];
  for (const raw of techs) {
    const tech = toTechInput(raw);
    if (!tech.available) continue;
    const stops = tech.stops
      .filter((s) => s.id !== job.id)
      .slice()
      .sort(
        (a, b) =>
          (a.start ?? Number.MAX_SAFE_INTEGER) -
            (b.start ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
      );
    const slot = pickSlot(evaluateSlots(job, tech, stops, ctx));
    const reasons: string[] = [];
    let score = 0;
    let fits = slot.fits;

    if (!jobLocated) reasons.push("No location, ranked by load");
    if (slot.extra != null) {
      score += slot.extra;
      reasons.push(
        slot.extra < 0.5 ? "On the way" : `Adds ${round1(slot.extra)} mi`,
      );
    } else {
      score += NO_ROUTE_MILES;
      if (jobLocated) reasons.push("No route to compare");
    }

    if (!slot.fits) {
      score += OVERLAP_PENALTY;
      reasons.push(
        slot.overlapWith ? "Overlaps a scheduled job" : "No free time that day",
      );
    } else if (job.start == null && slot.start != null) {
      const to = slot.gapTo ?? ctx.dayEnd;
      reasons.push(`Free ${label(slot.start)}–${label(to)}`);
    } else if (job.start != null) {
      reasons.push(`Free at ${label(job.start)}`);
    }
    if (slot.fits && slot.tight) {
      score += TIGHT_PENALTY;
      reasons.push("Tight drive between stops");
    }

    const n = stops.length;
    if (n >= maxJobs) {
      score += OVERLOAD_PENALTY;
      fits = false;
      reasons.push(`Already ${n} jobs`);
    } else {
      score += LOAD_PER_JOB * n;
      if (n === 0) reasons.push("Nothing booked yet");
      else if (n >= maxJobs - 1) reasons.push(`Already ${n} jobs`);
    }

    if (ctx.isToday && !tech.clockedIn) {
      score += NOT_CLOCKED_PENALTY;
      reasons.push("Not clocked in");
    }
    if (
      job.serviceTypeId &&
      tech.skills &&
      tech.skills.length > 0 &&
      !tech.skills.includes(job.serviceTypeId)
    ) {
      score += NO_SKILL_PENALTY;
      reasons.push(
        job.serviceName
          ? `Not listed for ${job.serviceName}`
          : "Not listed for this service",
      );
    }

    const prev = slot.at > 0 ? (stops[slot.at - 1] as RecStop).id : "start";
    const next = slot.at < stops.length ? (stops[slot.at] as RecStop).id : null;
    recs.push({
      techId: tech.id,
      score: round1(score),
      extraMiles: slot.extra == null ? null : round1(slot.extra),
      insertAfter: prev,
      insertBefore: next,
      fits,
      reasons,
      rank: 0,
      suggestedStart: slot.start,
    });
  }
  recs.sort(
    (a, b) =>
      a.score - b.score ||
      Number(b.fits) - Number(a.fits) ||
      a.techId.localeCompare(b.techId),
  );
  recs.forEach((r, i) => {
    r.rank = i + 1;
  });
  return recs;
}

// ── Arrival windows (booking availability) ──────────────────────────────────

/** A stop on a tech's day with its time on site, for arrival planning. */
export interface ArrivalStop extends RecStop {
  /** Minutes on site; default: end − start, else 60. */
  minutes?: number | null;
}

/** A span of time (epoch ms, end exclusive). */
export interface TimeSpan {
  start: number;
  end: number;
}

/** What `arrivalFit` knows about a tech's day. Nothing else is read. */
export interface ArrivalTech {
  /**
   * Working spans that day: the job must start and finish inside one. null = on
   * call (an after-hours window): bounded by the context's day instead.
   */
  shifts: readonly TimeSpan[] | null;
  /** Time off that day: the job may not overlap it. */
  blocks?: readonly TimeSpan[];
  stops: readonly ArrivalStop[];
}

export interface ArrivalJob {
  lat: number | null;
  lng: number | null;
  /**
   * The arrival window (epoch ms): the job must start in [from, to), before the
   * window ends; a fixed time (to = from) must start right then.
   */
  from: number;
  to: number;
  /** Time on site. */
  durationMin: number;
}

export interface ArrivalContext {
  /** Day bounds for an on-call tech (shifts null). */
  dayStart: number;
  dayEnd: number;
  /** Not before this instant (now plus a little lead time, on today). */
  notBefore?: number;
  mph?: number;
}

/**
 * Why a job doesn't fit: not working in the window ("off"), time off in the way,
 * no room in the window after the previous stop or before the shift ends
 * ("no_time"), or it would push a later job past its own window ("bumps").
 */
export type ArrivalMiss = "off" | "time_off" | "no_time" | "bumps";

export interface ArrivalFit {
  fits: boolean;
  /** Earliest arrival inside the window (epoch ms) when it fits. */
  arrival: number | null;
  miss: ArrivalMiss | null;
}

/**
 * Can `tech` start `job` inside its arrival window? Plans the day as booked
 * (each stop at max(its start, previous done + drive)), puts the job after the
 * stops that start no later than the window (where `recommendTechs` puts a timed
 * job), takes the earliest start in the window after the previous stop's work and
 * drive, inside a working span and clear of time off, then checks every later stop
 * can still be reached by the end of its own window.
 */
export function arrivalFit(
  job: ArrivalJob,
  tech: ArrivalTech,
  ctx: ArrivalContext,
): ArrivalFit {
  const mph = ctx.mph ?? DEFAULT_MPH;
  const drive = (a: LatLng | null, b: LatLng | null) =>
    a && b ? (milesBetween(a, b) / mph) * 60 * MIN : 0;
  const onSite = (s: ArrivalStop, start: number) =>
    s.minutes != null && s.minutes > 0
      ? s.minutes * MIN
      : s.end != null && s.end > start
        ? s.end - start
        : 60 * MIN;
  const stops = tech.stops
    .filter((s): s is ArrivalStop & { start: number } => s.start != null)
    .slice()
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  // The day as booked: earliest arrival at each stop.
  const plan: { at: number; done: number }[] = [];
  stops.forEach((s, i) => {
    const prev = i > 0 ? (stops[i - 1] as ArrivalStop) : null;
    const before = plan[i - 1];
    const at = Math.max(
      s.start,
      prev && before ? before.done + drive(pt(prev), pt(s)) : s.start,
    );
    plan.push({ at, done: at + onSite(s, s.start) });
  });
  let k = stops.findIndex((s) => s.start > job.from);
  if (k < 0) k = stops.length;
  const jp = pt(job);
  const dur = Math.max(15, job.durationMin) * MIN;
  let earliest = Math.max(job.from, ctx.notBefore ?? job.from);
  const prevStop = k > 0 ? (stops[k - 1] as ArrivalStop) : null;
  const prevPlan = k > 0 ? plan[k - 1] : undefined;
  if (prevStop && prevPlan)
    earliest = Math.max(earliest, prevPlan.done + drive(pt(prevStop), jp));
  const spans = (tech.shifts ?? [{ start: ctx.dayStart, end: ctx.dayEnd }])
    .filter((s) => s.end > s.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const blocks = tech.blocks ?? [];
  const lastStart = job.to > job.from ? job.to - 1 : job.to;
  // Earliest start ≥ `from` inside a span (start and finish), optionally clear of time off.
  const firstStart = (from: number, avoid: readonly TimeSpan[]) => {
    let at = from;
    for (let guard = 0; guard < 64; guard++) {
      const span = spans.find((s) => Math.max(at, s.start) + dur <= s.end);
      if (!span) return null;
      const start = Math.max(at, span.start);
      if (start > lastStart) return null;
      const hit = avoid.filter((b) => b.start < start + dur && b.end > start);
      if (hit.length === 0) return start;
      at = Math.max(...hit.map((b) => b.end));
    }
    return null;
  };
  const worksThen = spans.some((s) => s.start < job.to && s.end > job.from);
  if (firstStart(earliest, []) == null)
    return { fits: false, arrival: null, miss: worksThen ? "no_time" : "off" };
  const at = firstStart(earliest, blocks);
  if (at == null) return { fits: false, arrival: null, miss: "time_off" };
  // Later stops: each must still be reachable by the end of its window (or by the
  // time it was already planned for, when that was later).
  let done = at + dur;
  let from = jp;
  for (let j = k; j < stops.length; j++) {
    const s = stops[j] as ArrivalStop & { start: number };
    const was = plan[j] as { at: number; done: number };
    const arrive = Math.max(s.start, done + drive(from, pt(s)));
    if (arrive <= was.at) break;
    if (arrive > Math.max(s.end ?? s.start, was.at))
      return { fits: false, arrival: null, miss: "bumps" };
    done = arrive + onSite(s, s.start);
    from = pt(s);
  }
  return { fits: true, arrival: at, miss: null };
}
