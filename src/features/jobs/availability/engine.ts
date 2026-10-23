// Booking availability engine (pure, client-safe, no I/O): which 2-hour arrival
// windows can be offered for a job, day by day (leads-flow redesign, item 8).
// The loader (./index.ts) reads the data; golden tests:
// tests/golden/availability.test.ts.
//
// A window is open when at least one tech fits:
//   1. Works then: their weekly hours for that weekday (their own, else business
//      hours; resolved by the loader), minus time off. The day's windows are the
//      2-hour grid over the team's working hours, so weekends and evenings are
//      closed unless someone is set to work them. With after-hours booking on, the
//      evening and weekend windows around them are offered too, to anyone not on
//      time off (on call), within the schedule board's hours.
//   2. Skills: a tech whose list is empty takes any job (as in the Assign hub); a
//      tech with a list must be listed for the job's service type. When nobody on
//      the team lists that service type (or nobody lists skills at all), skills
//      don't block.
//   3. Under the daily cap (one cap for everyone).
//   4. Fits the route: `recommendTechs` (the Assign hub's engine) places the job in
//      their day by its window and must not see an overlap; `arrivalFit` checks
//      the job's length plus the drive from the previous stop can start inside the
//      window, inside their hours and around time off, without pushing a later job
//      past its own window.
//   5. Not far: the job adds at most `maxExtraMiles` of driving for that tech.
//      When every tech who fits is far, the window is hidden (full, reason "far").
// A job whose ZIP is outside the service ZIPs (when that list is set) gets no
// windows at all (reason "outside_area"). Booked jobs nobody is assigned to yet
// still take room: each is placed, in window order, with the tech the hub would
// rank first, before the new job is fitted.
//
// Day status: open = 2+ open windows, limited = 1, full = 0; best = the top 3
// open days ranked by closeness to the requested day (else the soonest), then by
// the least extra driving. Best days are ranked over a fixed horizon from today
// (`rankHorizonEnd`), so one day asked alone gets the same status as in the range.
//
// Times are local minutes of the day in the company zone (0–1440); the route math
// runs on minutes × 60 000 (ms since local midnight).
//
// ⚖️ Fairness: like the Assign hub, the engine only knows what route planning
// needs. `EngineTech` has no field for age or date of birth, and `pickTech` copies
// only the fields below, so a richer object passed in can never change a result.

import { addDaysToKey } from "@/lib/time";
import type { WorkHoursDay } from "@/lib/work-hours";
import { hhmmMinutes } from "@/lib/work-hours";
import {
  type ArrivalStop,
  arrivalFit,
  type LatLng,
  NO_ROUTE_MILES,
  type Recommendation,
  type RecTech,
  recommendTechs,
  type TimeSpan,
} from "../dispatch/recommend";
import type {
  DayAvailability,
  DayReason,
  DayStatus,
  TechSuggestion,
  WindowReason,
  WindowSlot,
} from "./types";
import {
  afterHoursGrid,
  type BusinessHours,
  gridWindows,
  isAfterHoursWindow,
  toHHMM,
  toMin,
  weekdayOf,
} from "./windows";

/** Today, nobody is expected sooner than this many minutes from now. */
export const LEAD_MIN = 30;
/** How many days are marked best. */
export const BEST_DAYS = 3;
/** Best days are ranked over this many days from today (more when the range is longer). */
export const RANK_DAYS = 60;
/** …and at least this many days past the requested day. */
export const REQUEST_PAD_DAYS = 14;
/** Hard stop for a range (days from today). */
export const MAX_DAYS = 400;
/** Other techs listed per window, after the suggested one. */
export const MAX_ALTERNATIVES = 4;
/** Used when the company has no business hours at all. */
const FALLBACK_OPEN_MIN = 8 * 60;
const MIN = 60_000;
const NEW_JOB = "__new__";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A technician as the engine sees them. Nothing else is read. */
export interface EngineTech {
  id: string;
  name: string;
  /** Hex route color. */
  color: string;
  avatarUrl: string | null;
  /** Weekly working hours, resolved (their own, else business hours). */
  hours: readonly WorkHoursDay[];
  /** Service type ids they're listed for; empty = any job. */
  skills: readonly string[];
  /** Route start: home base, else the shop; null = their first stop. */
  start: LatLng | null;
  /** Clocked in now (scored on today only, as in the Assign hub). */
  clockedIn: boolean;
}

/** Time off on one day, in local minutes (end exclusive). */
export interface EngineTimeOff {
  techId: string;
  date: string;
  start: number;
  end: number;
}

/** A job already booked, in local minutes of its day. */
export interface EngineBooking {
  id: string;
  date: string;
  /** Arrival start. */
  start: number;
  /** Arrival window end (or scheduled end); null = a fixed time. */
  end: number | null;
  /** Time on site. */
  minutes: number;
  lat: number | null;
  lng: number | null;
  serviceTypeId: string | null;
  /** Assigned techs (primary and helpers); empty = booked, needs a tech. */
  techIds: readonly string[];
}

/** The job being booked. */
export interface EngineJob {
  lat: number | null;
  lng: number | null;
  /** ZIP for the service-area check; null when unknown (never blocks). */
  zip: string | null;
  /** Time on site. */
  durationMin: number;
  serviceTypeId: string | null;
  serviceName?: string | null;
}

export interface EngineSettings {
  /** Most jobs one tech takes in a day. */
  dailyCap: number;
  /** Far-job limit: extra miles of driving the job may add for a tech. */
  maxExtraMiles: number;
  /** Offer windows outside everyone's working hours (on call). */
  afterHoursBooking: boolean;
  /** Service ZIPs; empty = everywhere. */
  serviceZips: readonly string[];
  businessHours: readonly BusinessHours[];
  weekendsAfterHours: boolean;
  /** Schedule board hours: the bounds of after-hours windows. */
  boardStartHour: number;
  boardEndHour: number;
}

export interface EngineInput {
  /** First and last day asked for, inclusive. Days before today are skipped. */
  from: string;
  to: string;
  todayKey: string;
  /** Local minute of the day now. */
  nowMin: number;
  requestedDate?: string | null;
  withWindows?: boolean;
  /** Last day ranked for Best (default `rankHorizonEnd`). */
  horizonEnd?: string;
  job: EngineJob;
  techs: readonly EngineTech[];
  bookings: readonly EngineBooking[];
  timeOff: readonly EngineTimeOff[];
  settings: EngineSettings;
  /** Average driving speed (default: the hub's). */
  mph?: number;
}

/** Last day the Best ranking looks at: 60 days from today, the asked range, and two weeks past the requested day. */
export function rankHorizonEnd(
  todayKey: string,
  to: string,
  requestedDate?: string | null,
): string {
  let end = addDaysToKey(todayKey, RANK_DAYS - 1);
  if (to > end) end = to;
  if (requestedDate && DATE_RE.test(requestedDate)) {
    const pad = addDaysToKey(requestedDate, REQUEST_PAD_DAYS);
    if (pad > end) end = pad;
  }
  const cap = addDaysToKey(todayKey, MAX_DAYS - 1);
  return end > cap ? cap : end;
}

/** Copies only the fields the engine may use (⚖️ see the header). */
export function pickTech(t: EngineTech): EngineTech {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    avatarUrl: t.avatarUrl,
    hours: t.hours.map((h) => ({ day: h.day, start: h.start, end: h.end })),
    skills: [...t.skills],
    start: t.start ? { lat: t.start.lat, lng: t.start.lng } : null,
    clockedIn: t.clockedIn === true,
  };
}

/** 5-digit ZIP, or null. */
export function zip5(zip: string | null | undefined): string | null {
  const m = /^\s*(\d{5})/.exec(zip ?? "");
  return m ? (m[1] as string) : null;
}

/** True when the job's ZIP is known and outside a non-empty service ZIP list. */
export function outsideArea(
  zip: string | null | undefined,
  serviceZips: readonly string[],
): boolean {
  const list = serviceZips.map(zip5).filter((z): z is string => !!z);
  const z = zip5(zip);
  return list.length > 0 && z != null && !list.includes(z);
}

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5,
  );

/** "10:30 AM", "1 PM". */
const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  return `${h24 % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
};

/** One tech's day: working spans, time off and stops (ms since local midnight). */
interface TechDay {
  tech: EngineTech;
  shifts: TimeSpan[];
  blocks: TimeSpan[];
  stops: ArrivalStop[];
}

interface Slot {
  start: number;
  end: number;
  /** Outside everyone's working hours (offered with after-hours booking on). */
  onCall: boolean;
}

interface Candidate {
  day: TechDay;
  rec: Recommendation;
  arrival: number;
  far: boolean;
}

interface Fitted {
  candidates: Candidate[];
  /** Somebody works in the window at all (net of time off). */
  anyoneWorks: boolean;
}

interface BuiltDay {
  date: string;
  status: DayStatus;
  openings: number;
  windows: WindowSlot[];
  reason?: DayReason;
  /** Least extra driving among the open windows (Best tie-break). */
  drive: number;
}

/** Does the tech work any time in [s, e] (ms), net of time off? */
function worksIn(d: TechDay, s: number, e: number, onCall: boolean): boolean {
  const spans = onCall ? [{ start: s, end: e }] : d.shifts;
  for (const sp of spans) {
    let from = Math.max(sp.start, s);
    const to = Math.min(sp.end, e);
    // Walk the free time between blocks inside [from, to).
    for (const b of [...d.blocks].sort((x, y) => x.start - y.start)) {
      if (b.end <= from || b.start >= to) continue;
      if (b.start > from) return true;
      from = Math.max(from, b.end);
    }
    if (from < to) return true;
  }
  return false;
}

/** Availability for every day from `from` to `to` (today onward). */
export function computeAvailability(input: EngineInput): DayAvailability[] {
  const today = input.todayKey;
  const first = input.from < today ? today : input.from;
  const lastAsked = (() => {
    const cap = addDaysToKey(today, MAX_DAYS - 1);
    return input.to > cap ? cap : input.to;
  })();
  if (lastAsked < first) return [];
  const s = input.settings;
  const asked = (fn: (date: string) => DayAvailability) => {
    const out: DayAvailability[] = [];
    for (let d = first; d <= lastAsked; d = addDaysToKey(d, 1)) out.push(fn(d));
    return out;
  };
  if (outsideArea(input.job.zip, s.serviceZips))
    return asked((date) => ({
      date,
      status: "full",
      openings: 0,
      windows: [],
      reason: "outside_area",
    }));

  const techs = input.techs.map(pickTech);
  const horizon =
    input.horizonEnd ?? rankHorizonEnd(today, lastAsked, input.requestedDate);
  const last = horizon > lastAsked ? horizon : lastAsked;
  const bookingsOn = new Map<string, EngineBooking[]>();
  for (const b of input.bookings)
    bookingsOn.set(b.date, [...(bookingsOn.get(b.date) ?? []), b]);
  const offOn = new Map<string, EngineTimeOff[]>();
  for (const t of input.timeOff)
    offOn.set(t.date, [...(offOn.get(t.date) ?? []), t]);

  const ctxBase = {
    lo: Math.max(0, Math.min(23, s.boardStartHour)) * 60,
    hi: Math.max(1, Math.min(24, s.boardEndHour)) * 60,
  };
  const businessOpen = (wd: number) => {
    const own = s.businessHours
      .filter((h) => h.day === wd)
      .map((h) => toMin(h.open));
    if (own.length) return Math.min(...own);
    const all = s.businessHours.map((h) => toMin(h.open));
    return all.length ? Math.min(...all) : FALLBACK_OPEN_MIN;
  };
  // Skills (see the header): who may take a job of this service type.
  const listed = new Set(techs.flatMap((t) => t.skills));
  const skillOk = (t: EngineTech, serviceTypeId: string | null) =>
    !serviceTypeId ||
    t.skills.length === 0 ||
    t.skills.includes(serviceTypeId) ||
    !listed.has(serviceTypeId);

  const buildDay = (date: string): BuiltDay => {
    const wd = weekdayOf(date);
    const isToday = date === today;
    const days: TechDay[] = techs.map((tech) => ({
      tech,
      shifts: tech.hours
        .filter((h) => h.day === wd)
        .map((h) => ({
          start: (hhmmMinutes(h.start) ?? 0) * MIN,
          end: (hhmmMinutes(h.end) ?? 0) * MIN,
        }))
        .filter((x) => x.end > x.start),
      blocks: (offOn.get(date) ?? [])
        .filter((o) => o.techId === tech.id && o.end > o.start)
        .map((o) => ({ start: o.start * MIN, end: o.end * MIN })),
      stops: [],
    }));
    const byTech = new Map(days.map((d) => [d.tech.id, d]));
    const booked = [...(bookingsOn.get(date) ?? [])].sort(
      (a, b) => a.start - b.start || a.id.localeCompare(b.id),
    );
    const toStop = (b: EngineBooking): ArrivalStop => ({
      id: b.id,
      lat: b.lat,
      lng: b.lng,
      start: b.start * MIN,
      end:
        (b.end != null && b.end > b.start ? b.end : b.start + b.minutes) * MIN,
      minutes: b.minutes,
    });
    for (const b of booked)
      for (const id of new Set(b.techIds))
        byTech.get(id)?.stops.push(toStop(b));

    // The day's windows: the grid over everyone's working hours, plus the
    // after-hours windows around it when that's on.
    const working = gridWindows(
      days.flatMap((d) =>
        d.shifts.map((x) => [x.start / MIN, x.end / MIN] as [number, number]),
      ),
    );
    const slots: Slot[] = working.map(([start, end]) => ({
      start,
      end,
      onCall: false,
    }));
    if (s.afterHoursBooking)
      for (const [start, end] of afterHoursGrid(
        working,
        ctxBase.lo,
        ctxBase.hi,
        businessOpen(wd),
      ))
        slots.push({ start, end, onCall: true });
    slots.sort((a, b) => a.start - b.start);

    const ctx = {
      isToday,
      dayStart: ctxBase.lo * MIN,
      dayEnd: ctxBase.hi * MIN,
      maxJobsPerDay: s.dailyCap,
      mph: input.mph,
      timeLabel: (ms: number) => clock(ms / MIN),
    };
    const fit = (
      job: {
        id: string;
        lat: number | null;
        lng: number | null;
        from: number;
        to: number;
        durationMin: number;
        serviceTypeId: string | null;
        serviceName?: string | null;
      },
      onCall: boolean,
      notBefore: number | undefined,
    ): Fitted => {
      const eligible = days.filter((d) => skillOk(d.tech, job.serviceTypeId));
      const anyoneWorks = days.some((d) =>
        worksIn(d, job.from, job.to, onCall),
      );
      const recTechs: RecTech[] = eligible.map((d) => ({
        id: d.tech.id,
        available: true,
        clockedIn: d.tech.clockedIn,
        start: d.tech.start,
        stops: d.stops,
        skills: d.tech.skills,
      }));
      const recs = recommendTechs(
        {
          id: job.id,
          lat: job.lat,
          lng: job.lng,
          start: job.from,
          end: job.to,
          durationMin: job.durationMin,
          serviceTypeId: job.serviceTypeId,
          serviceName: job.serviceName ?? null,
        },
        recTechs,
        { ...ctx, notBefore },
      );
      const candidates: Candidate[] = [];
      for (const rec of recs) {
        const day = byTech.get(rec.techId);
        // Overlaps a booked window, or at the daily cap.
        if (!day || !rec.fits) continue;
        const f = arrivalFit(
          {
            lat: job.lat,
            lng: job.lng,
            from: job.from,
            to: job.to,
            durationMin: job.durationMin,
          },
          {
            shifts: onCall ? null : day.shifts,
            blocks: day.blocks,
            stops: day.stops,
          },
          {
            dayStart: ctx.dayStart,
            dayEnd: ctx.dayEnd,
            notBefore,
            mph: input.mph,
          },
        );
        if (!f.fits || f.arrival == null) continue;
        candidates.push({
          day,
          rec,
          arrival: f.arrival,
          far: rec.extraMiles != null && rec.extraMiles > s.maxExtraMiles,
        });
      }
      return { candidates, anyoneWorks };
    };

    // Booked jobs nobody is on yet take room first: each goes, in window order,
    // to the tech the hub would rank first (far or not), else to the best-ranked
    // tech who works that day.
    for (const b of booked) {
      if (b.techIds.length > 0) continue;
      const from = b.start * MIN;
      const to = (b.end != null && b.end > b.start ? b.end : b.start) * MIN;
      const job = {
        id: b.id,
        lat: b.lat,
        lng: b.lng,
        from,
        to,
        durationMin: b.minutes,
        serviceTypeId: b.serviceTypeId,
      };
      const { candidates } = fit(job, false, undefined);
      let pick = candidates[0]?.day;
      if (!pick) {
        const pool = days.filter((d) => skillOk(d.tech, b.serviceTypeId));
        const working = pool.filter((d) => d.shifts.length > 0);
        const ranked = recommendTechs(
          { ...job, start: from, end: to },
          (working.length ? working : pool).map((d) => ({
            id: d.tech.id,
            available: true,
            clockedIn: d.tech.clockedIn,
            start: d.tech.start,
            stops: d.stops,
            skills: d.tech.skills,
          })),
          ctx,
        );
        pick = ranked[0] ? byTech.get(ranked[0].techId) : undefined;
      }
      pick?.stops.push(toStop(b));
    }

    const lead = isToday ? (input.nowMin + LEAD_MIN) * MIN : undefined;
    const windows: WindowSlot[] = slots.map((slot) => {
      const base: WindowSlot = {
        start: toHHMM(slot.start),
        end: toHHMM(slot.end),
        status: "full",
        alternatives: [],
      };
      if (
        isAfterHoursWindow(
          wd,
          slot.start,
          slot.end,
          s.businessHours,
          s.weekendsAfterHours,
        )
      )
        base.afterHours = true;
      // Today: a window that already started isn't offered.
      if (isToday && slot.start <= input.nowMin)
        return { ...base, reason: "closed" };
      const { candidates, anyoneWorks } = fit(
        {
          id: NEW_JOB,
          lat: input.job.lat,
          lng: input.job.lng,
          from: slot.start * MIN,
          to: slot.end * MIN,
          durationMin: input.job.durationMin,
          serviceTypeId: input.job.serviceTypeId,
          serviceName: input.job.serviceName ?? null,
        },
        slot.onCall,
        lead,
      );
      const near = candidates.filter((c) => !c.far);
      const [first, ...rest] = near.map((c) => suggestion(c, isToday));
      if (!first) {
        const reason: WindowReason = !anyoneWorks
          ? "closed"
          : candidates.length > 0
            ? "far"
            : "full";
        return { ...base, reason };
      }
      return {
        ...base,
        status: "open",
        suggested: first,
        alternatives: rest.slice(0, MAX_ALTERNATIVES),
      };
    });

    const open = windows.filter((w) => w.status === "open");
    const openings = open.length;
    const status: DayStatus =
      openings >= 2 ? "open" : openings === 1 ? "limited" : "full";
    let reason: DayReason | undefined;
    if (openings === 0)
      reason = windows.some((w) => w.reason === "far")
        ? "far"
        : windows.some((w) => w.reason === "full")
          ? "full"
          : "closed";
    const drive = open.length
      ? Math.min(...open.map((w) => w.suggested?.extraMiles ?? NO_ROUTE_MILES))
      : Number.POSITIVE_INFINITY;
    return { date, status, openings, windows, reason, drive };
  };

  const built: BuiltDay[] = [];
  for (let d = today; d <= last; d = addDaysToKey(d, 1))
    built.push(buildDay(d));

  // Best: the top open days by closeness to the requested day (else the soonest),
  // then the least extra driving, then the earlier day.
  const req =
    input.requestedDate && DATE_RE.test(input.requestedDate)
      ? input.requestedDate < today
        ? today
        : input.requestedDate
      : today;
  const best = new Set(
    built
      .filter((b) => b.status === "open" && b.date <= horizon)
      .map((b) => ({ b, gap: Math.abs(daysBetween(req, b.date)) }))
      .sort(
        (x, y) =>
          x.gap - y.gap ||
          x.b.drive - y.b.drive ||
          x.b.date.localeCompare(y.b.date),
      )
      .slice(0, BEST_DAYS)
      .map((x) => x.b.date),
  );
  return built
    .filter((b) => b.date >= first && b.date <= lastAsked)
    .map((b) => ({
      date: b.date,
      status: best.has(b.date) ? "best" : b.status,
      openings: b.openings,
      windows: input.withWindows ? b.windows : [],
      ...(b.reason ? { reason: b.reason } : {}),
    }));
}

/** A fitting tech as the calendar shows them: distance, arrival, load. */
function suggestion(c: Candidate, isToday: boolean): TechSuggestion {
  const { rec, day } = c;
  const reasons: string[] = [];
  if (rec.extraMiles == null) reasons.push("No route to compare");
  else
    reasons.push(
      rec.extraMiles < 0.5 ? "On the way" : `Adds ${rec.extraMiles} mi`,
    );
  // Arrival rounded up to 5 minutes.
  reasons.push(`Free at ${clock(Math.ceil(c.arrival / MIN / 5) * 5)}`);
  const n = day.stops.length;
  reasons.push(
    n === 0 ? "Nothing booked yet" : `${n} job${n === 1 ? "" : "s"} that day`,
  );
  if (isToday && !day.tech.clockedIn) reasons.push("Not clocked in");
  return {
    techId: day.tech.id,
    name: day.tech.name,
    color: day.tech.color,
    avatarUrl: day.tech.avatarUrl,
    extraMiles: rec.extraMiles,
    reasons,
  };
}
