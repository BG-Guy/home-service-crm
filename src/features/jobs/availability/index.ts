import "server-only";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getGeocoder } from "@/adapters/geocode";
import { db } from "@/db";
import {
  jobAssignments,
  jobs,
  properties,
  roles,
  serviceTypes,
  timeOff,
  users,
} from "@/db/schema";
import { getMediaUrls } from "@/features/media/api";
import { getClockStatuses } from "@/features/time/api";
import { getCompany, getCompanyTimezone, getSettings } from "@/lib/settings";
import {
  addDaysToKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/time";
import { effectiveWorkHours, hhmmMinutes } from "@/lib/work-hours";
import { colorFor } from "../dispatch/colors";
import type { TimeSpan } from "../dispatch/recommend";
import { KIND_DEFAULTS, kindOf } from "../kinds";
import {
  computeAvailability,
  type EngineBooking,
  type EngineSettings,
  type EngineTech,
  type EngineTimeOff,
  outsideArea,
  rankHorizonEnd,
  zip5,
} from "./engine";
import type {
  AvailabilityAddress,
  AvailabilityInput,
  DayAvailability,
} from "./types";

// Booking availability (the booking flow's week strip and arrival windows; each
// open window also names the best tech and the alternatives). Loads, in a few
// batched queries for the whole range: active techs (working hours, skills, home
// base, avatar: never profile facts like birth date), their time off, every booked
// job from today to the end of the Best horizon (window, location, length,
// assignees), settings and the job's location; then runs the pure engine
// (./engine.ts). No per-day queries: the calendar asks per range, and per day for
// the windows. Callers check permissions first.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Bookings read for one call (a busy shop's two months fit easily). */
const BOOKING_LIMIT = 5000;
/** A typed address waits this long for the geocoder before going without. */
const GEOCODE_WAIT_MS = 2500;
const GEOCODE_HIT_TTL = 24 * 3600_000;
const GEOCODE_MISS_TTL = 10 * 60_000;
const GEOCODE_CACHE_MAX = 500;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A company-zone wall clock: day key and minute of the day. */
function wall(d: Date, tz: string): { date: string; min: number } {
  const p = zonedParts(d, tz);
  return {
    date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    min: p.hour * 60 + p.minute,
  };
}

/** Active technicians with only what availability needs (⚖️ no profile facts). */
function loadTechs() {
  return db
    .select({
      id: users.id,
      name: users.name,
      color: users.color,
      skills: users.skills,
      homeBase: users.homeBase,
      avatarMediaId: users.avatarMediaId,
      workHours: users.workHours,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(
      and(
        eq(users.status, "active"),
        or(eq(roles.baseRole, "tech"), eq(users.role, "tech")),
      ),
    )
    .orderBy(asc(users.name));
}

/** Every job with an arrival in [from, to), every status but cancelled, with its assignees. */
async function loadBookings(
  from: Date,
  to: Date,
  tz: string,
  defaultMinutes: number,
): Promise<EngineBooking[]> {
  const arrival = sql`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;
  const rows = await db
    .select({
      id: jobs.id,
      windowStart: jobs.windowStart,
      windowEnd: jobs.windowEnd,
      scheduledStart: jobs.scheduledStart,
      scheduledEnd: jobs.scheduledEnd,
      serviceTypeId: jobs.serviceTypeId,
      serviceMinutes: serviceTypes.defaultDurationMin,
      lat: properties.lat,
      lng: properties.lng,
      techIds: sql<
        string | null
      >`(select string_agg(${jobAssignments.userId}::text, ',') from ${jobAssignments} where ${jobAssignments.jobId} = ${jobs.id})`,
    })
    .from(jobs)
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(
      and(
        ne(jobs.status, "cancelled"),
        sql`${arrival} >= ${from.toISOString()}::timestamptz`,
        sql`${arrival} < ${to.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(arrival), asc(jobs.id))
    .limit(BOOKING_LIMIT);
  const out: EngineBooking[] = [];
  for (const r of rows) {
    const s = r.windowStart ?? r.scheduledStart;
    if (!s) continue;
    // The same start and end the Assign hub reads (dispatch/queries.ts).
    const e = r.windowEnd ?? r.scheduledEnd;
    const a = wall(s, tz);
    let end: number | null = null;
    if (e && e.getTime() > s.getTime()) {
      const b = wall(e, tz);
      end = b.date === a.date ? b.min : 1440;
      if (end <= a.min) end = null;
    }
    const span = e ? Math.round((e.getTime() - s.getTime()) / 60_000) : 0;
    out.push({
      id: r.id,
      date: a.date,
      start: a.min,
      end,
      // The job's own length (its type's), else its booked span, else the default.
      minutes: Math.max(
        15,
        r.serviceMinutes ?? (span > 0 ? span : defaultMinutes),
      ),
      lat: r.lat,
      lng: r.lng,
      serviceTypeId: r.serviceTypeId,
      techIds: r.techIds ? r.techIds.split(",") : [],
    });
  }
  return out;
}

/** Time off overlapping [from, to), split into company-zone days (local minutes). */
async function loadTimeOff(
  techIds: string[],
  from: Date,
  to: Date,
  tz: string,
): Promise<EngineTimeOff[]> {
  if (techIds.length === 0) return [];
  const rows = await db
    .select({
      userId: timeOff.userId,
      startsAt: timeOff.startsAt,
      endsAt: timeOff.endsAt,
    })
    .from(timeOff)
    .where(
      and(
        inArray(timeOff.userId, techIds),
        lt(timeOff.startsAt, to),
        gt(timeOff.endsAt, from),
      ),
    );
  const out: EngineTimeOff[] = [];
  for (const r of rows) {
    const s = r.startsAt < from ? from : r.startsAt;
    const e = r.endsAt > to ? to : r.endsAt;
    const a = wall(s, tz);
    const b = wall(new Date(e.getTime() - 1), tz);
    for (let d = a.date; d <= b.date; d = addDaysToKey(d, 1)) {
      const next = zonedTimeToUtc(parseDateKey(addDaysToKey(d, 1)), tz);
      const start = d === a.date ? a.min : 0;
      const end = e >= next ? 1440 : wall(e, tz).min;
      if (end > start) out.push({ techId: r.userId, date: d, start, end });
    }
  }
  return out;
}

type LatLngOrNull = { lat: number | null; lng: number | null };
const NOWHERE: LatLngOrNull = { lat: null, lng: null };

const geocodeCache = new Map<
  string,
  { at: number; v: { lat: number; lng: number } | null }
>();

/** The geocoder (Settings → GEOCODER), cached per address, waiting at most GEOCODE_WAIT_MS. */
async function geocodeCached(a: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): Promise<LatLngOrNull> {
  const g = getGeocoder();
  if (g.id === "none" || !a.street.trim()) return NOWHERE;
  const key = [a.street, a.city, a.state, a.zip]
    .map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
  const hit = geocodeCache.get(key);
  if (hit && Date.now() - hit.at < (hit.v ? GEOCODE_HIT_TTL : GEOCODE_MISS_TTL))
    return hit.v ?? NOWHERE;
  const store = (v: { lat: number; lng: number } | null) => {
    if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest !== undefined) geocodeCache.delete(oldest);
    }
    geocodeCache.set(key, { at: Date.now(), v });
    return v;
  };
  // The lookup keeps going after the wait, so the next call (the day's windows)
  // finds it in the cache.
  const lookup = g
    .geocode(a)
    .then((r) => store(r ? { lat: r.lat, lng: r.lng } : null))
    .catch(() => store(null));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), GEOCODE_WAIT_MS);
  });
  try {
    return (await Promise.race([lookup, timeout])) ?? NOWHERE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Coordinates for an address: a saved property at the same street and ZIP, else
 * the geocoder, else the middle of the geocoded properties in that ZIP.
 */
async function locate(a: AvailabilityAddress): Promise<LatLngOrNull> {
  const street = a.street.trim().replace(/\s+/g, " ");
  const zip = zip5(a.zip);
  if (street && zip) {
    const [same] = await db
      .select({ lat: properties.lat, lng: properties.lng })
      .from(properties)
      .where(
        and(
          eq(properties.zip, zip),
          sql`lower(${properties.street}) = ${street.toLowerCase()}`,
          isNotNull(properties.lat),
          isNotNull(properties.lng),
          isNull(properties.deletedAt),
        ),
      )
      .limit(1);
    if (same?.lat != null && same.lng != null) return same;
  }
  const g = await geocodeCached({
    street,
    city: a.city ?? "",
    state: a.state ?? "",
    zip: a.zip.trim(),
  });
  if (g.lat != null) return g;
  if (!zip) return NOWHERE;
  const [mid] = await db
    .select({
      lat: sql<number | null>`avg(${properties.lat})::float8`,
      lng: sql<number | null>`avg(${properties.lng})::float8`,
    })
    .from(properties)
    .where(
      and(
        eq(properties.zip, zip),
        isNotNull(properties.lat),
        isNotNull(properties.lng),
      ),
    );
  return mid?.lat != null && mid.lng != null
    ? { lat: Number(mid.lat), lng: Number(mid.lng) }
    : NOWHERE;
}

/** Where the job is: the property's coordinates (or its address located), else the typed address. */
async function resolvePlace(
  i: AvailabilityInput,
): Promise<LatLngOrNull & { zip: string | null }> {
  if (i.propertyId && UUID_RE.test(i.propertyId)) {
    const [p] = await db
      .select({
        street: properties.street,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        lat: properties.lat,
        lng: properties.lng,
      })
      .from(properties)
      .where(eq(properties.id, i.propertyId))
      .limit(1);
    if (p) {
      const at =
        p.lat != null && p.lng != null
          ? { lat: p.lat, lng: p.lng }
          : await locate({
              street: p.street,
              city: p.city,
              state: p.state,
              zip: p.zip,
            });
      return { ...at, zip: zip5(p.zip) };
    }
  }
  const a = i.address;
  if (a && (a.street?.trim() || a.zip?.trim())) {
    const at = await locate({ ...a, street: a.street ?? "", zip: a.zip ?? "" });
    return { ...at, zip: zip5(a.zip) };
  }
  return { ...NOWHERE, zip: null };
}

async function loadServiceType(id: string | null | undefined) {
  if (!id || !UUID_RE.test(id)) return null;
  const [st] = await db
    .select({
      id: serviceTypes.id,
      name: serviceTypes.name,
      kind: serviceTypes.kind,
      defaultDurationMin: serviceTypes.defaultDurationMin,
    })
    .from(serviceTypes)
    .where(and(eq(serviceTypes.id, id), isNull(serviceTypes.deletedAt)))
    .limit(1);
  return st ?? null;
}

/** Bookable days (and, with `withWindows`, their arrival windows) for a job location. */
export async function getAvailability(
  input: AvailabilityInput,
): Promise<DayAvailability[]> {
  if (!DATE_RE.test(input.from) || !DATE_RE.test(input.to)) return [];
  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const now = new Date();
  const here = wall(now, tz);
  const todayKey = here.date;
  if (input.to < todayKey || input.to < input.from) return [];
  const requestedDate =
    input.requestedDate && DATE_RE.test(input.requestedDate)
      ? input.requestedDate
      : null;
  const engineSettings: EngineSettings = {
    dailyCap: settings.jobs.daily_job_cap,
    maxExtraMiles: settings.jobs.max_extra_miles,
    afterHoursBooking: settings.jobs.after_hours_booking,
    serviceZips: settings.company.service_zips,
    businessHours: settings.company.business_hours,
    weekendsAfterHours: settings.company.weekends_after_hours,
    boardStartHour: settings.jobs.board_start_hour,
    boardEndHour: settings.jobs.board_end_hour,
  };
  const [place, st, techRows, company] = await Promise.all([
    resolvePlace(input),
    loadServiceType(input.serviceTypeId),
    loadTechs(),
    getCompany(),
  ]);
  const durationMin =
    input.durationMin && input.durationMin >= 15 && input.durationMin <= 24 * 60
      ? Math.round(input.durationMin)
      : (st?.defaultDurationMin ??
        KIND_DEFAULTS[kindOf(input.kind)].durationMin);
  const base = {
    from: input.from,
    to: input.to,
    todayKey,
    nowMin: here.min,
    requestedDate,
    withWindows: input.withWindows,
    job: {
      lat: place.lat,
      lng: place.lng,
      zip: place.zip,
      durationMin,
      serviceTypeId: st?.id ?? null,
      serviceName: st?.name ?? null,
    },
    settings: engineSettings,
  };
  // Outside the service area: no windows, so nothing else to read.
  if (outsideArea(place.zip, engineSettings.serviceZips))
    return computeAvailability({
      ...base,
      techs: [],
      bookings: [],
      timeOff: [],
    });

  const horizonEnd = rankHorizonEnd(todayKey, input.to, requestedDate);
  const rangeFrom = zonedTimeToUtc(parseDateKey(todayKey), tz);
  const rangeTo = zonedTimeToUtc(parseDateKey(addDaysToKey(horizonEnd, 1)), tz);
  const techIds = techRows.map((t) => t.id);
  const avatarIds = techRows
    .map((t) => t.avatarMediaId)
    .filter((x): x is string => !!x);
  const [bookings, off, avatars, clocks] = await Promise.all([
    loadBookings(rangeFrom, rangeTo, tz, settings.jobs.default_window_min),
    loadTimeOff(techIds, rangeFrom, rangeTo, tz),
    avatarIds.length
      ? getMediaUrls(avatarIds, "thumb")
      : ({} as Record<string, string>),
    getClockStatuses(techIds),
  ]);
  const shop =
    company.address?.lat != null && company.address?.lng != null
      ? { lat: company.address.lat, lng: company.address.lng }
      : null;
  const techs: EngineTech[] = techRows.map((t) => ({
    id: t.id,
    name: t.name,
    color: colorFor(t.id, t.color),
    avatarUrl: t.avatarMediaId ? (avatars[t.avatarMediaId] ?? null) : null,
    hours: effectiveWorkHours(t.workHours, settings.company.business_hours),
    skills: t.skills ?? [],
    start:
      t.homeBase?.lat != null && t.homeBase?.lng != null
        ? { lat: t.homeBase.lat, lng: t.homeBase.lng }
        : shop,
    clockedIn: clocks[t.id]?.clockedIn ?? false,
  }));
  return computeAvailability({
    ...base,
    horizonEnd,
    techs,
    bookings,
    timeOff: off,
  });
}

/**
 * Each active tech's working spans and time off on one company-zone day (epoch
 * ms), for the Assign hub to check a booked window with `arrivalFit`
 * (../dispatch/recommend.ts) the way the calendar does. Techs who don't work that
 * day get no spans.
 */
export async function getTechWorkDays(
  date: string,
): Promise<Record<string, { shifts: TimeSpan[]; blocks: TimeSpan[] }>> {
  if (!DATE_RE.test(date)) return {};
  const [tz, settings, techRows] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
    loadTechs(),
  ]);
  const day = parseDateKey(date);
  const at = (min: number) =>
    min >= 1440
      ? zonedTimeToUtc(parseDateKey(addDaysToKey(date, 1)), tz).getTime()
      : zonedTimeToUtc(
          { ...day, hour: Math.floor(min / 60), minute: min % 60 },
          tz,
        ).getTime();
  const from = new Date(at(0));
  const to = new Date(at(1440));
  const off = await loadTimeOff(
    techRows.map((t) => t.id),
    from,
    to,
    tz,
  );
  const weekday = new Date(
    Date.UTC(day.year, day.month - 1, day.day),
  ).getUTCDay();
  const out: Record<string, { shifts: TimeSpan[]; blocks: TimeSpan[] }> = {};
  for (const t of techRows) {
    out[t.id] = {
      shifts: effectiveWorkHours(t.workHours, settings.company.business_hours)
        .filter((h) => h.day === weekday)
        .map((h) => ({
          start: at(hhmmMinutes(h.start) ?? 0),
          end: at(hhmmMinutes(h.end) ?? 0),
        })),
      blocks: off
        .filter((o) => o.techId === t.id)
        .map((o) => ({ start: at(o.start), end: at(o.end) })),
    };
  }
  return out;
}

/** One day with its windows (null when the day is out of range or in the past). */
export async function getDayAvailability(
  input: Omit<AvailabilityInput, "from" | "to" | "withWindows">,
  date: string,
): Promise<DayAvailability | null> {
  const [d] = await getAvailability({
    ...input,
    from: date,
    to: date,
    withWindows: true,
  });
  return d ?? null;
}

export type {
  AvailabilityInput,
  DayAvailability,
  DayReason,
  DayStatus,
  TechSuggestion,
  WindowReason,
  WindowSlot,
} from "./types";
