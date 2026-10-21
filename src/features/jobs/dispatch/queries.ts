import "server-only";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getMapConfig } from "@/adapters/maps";
import { db } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  properties,
  roles,
  serviceTypes,
  users,
} from "@/db/schema";
import { getUserBriefs } from "@/features/team/api";
import { getClockStatuses } from "@/features/time/api";
import { getAssignedVehicle } from "@/features/vehicles/api";
import { requireUser } from "@/lib/auth/current";
import { getCompany, getCompanyTimezone, getSettings } from "@/lib/settings";
import { ageOn, tenureLabel } from "@/lib/tenure";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { JobStatus } from "../contracts";
import { maskStreetLine, revealsJobAddress } from "../mask";
import { type RecTech, recommendTechs } from "./recommend";
import type { HubData, HubJob, HubStop, HubTech, HubTechState } from "./types";

// Assign hub reads (/dispatch): every active technician's day (route in window
// order, load, clock state, profile facts), the jobs that still need a tech, and
// for `?job=` the ranked recommendation. Gated by jobs.assign (admin, office).

const PALETTE = [
  "#0a84ff",
  "#34c759",
  "#ff9500",
  "#af52de",
  "#ff2d55",
  "#00b3c7",
  "#5856d6",
  "#d4a106",
];
const ON_JOB: readonly string[] = ["en_route", "arrived", "in_progress"];
const DONE: readonly string[] = ["completed", "closed", "cancelled"];
const DAY_HOURS = 8;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function colorFor(id: string, own: string | null): string {
  if (own && /^#[0-9a-f]{6}$/i.test(own)) return own;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length] as string;
}

const startExpr = sql<Date | null>`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;

const jobCols = {
  j: jobs,
  customerName: customers.displayName,
  street: properties.street,
  unit: properties.unit,
  city: properties.city,
  lat: properties.lat,
  lng: properties.lng,
  serviceName: serviceTypes.name,
  serviceMinutes: serviceTypes.defaultDurationMin,
};
type JobRow = {
  j: typeof jobs.$inferSelect;
  customerName: string;
  street: string;
  unit: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  serviceName: string | null;
  serviceMinutes: number | null;
};

function loadJobs(where: ReturnType<typeof and>, limit: number) {
  return db
    .select(jobCols)
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(where)
    .orderBy(asc(startExpr), asc(jobs.createdAt))
    .limit(limit) as Promise<JobRow[]>;
}

/** Load the Assign hub for a day (`?date=`), a selected job (`?job=`). */
export async function loadDispatchHub(params: {
  date?: string;
  job?: string;
}): Promise<HubData> {
  const viewer = await requireUser("jobs.assign");
  const [tz, settings, company] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
    getCompany(),
  ]);
  const now = new Date();
  const todayKey = dateKey(now, tz);

  // The job being assigned decides the day when it already has a window.
  let jobRow: JobRow | null = null;
  if (params.job && UUID_RE.test(params.job)) {
    const [r] = await loadJobs(
      and(eq(jobs.id, params.job), ne(jobs.status, "cancelled")),
      1,
    );
    jobRow = r ?? null;
  }
  const jobStart = jobRow
    ? (jobRow.j.windowStart ?? jobRow.j.scheduledStart)
    : null;
  const asked =
    params.date && DATE_RE.test(params.date) ? params.date : todayKey;
  const date = jobStart ? dateKey(jobStart, tz) : asked;
  const movedToJobDay = !!jobStart && !!params.date && params.date !== date;

  const from = zonedTimeToUtc(parseDateKey(date), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(date, 1)), tz);
  const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

  const techRows = await db
    .select({
      id: users.id,
      name: users.name,
      color: users.color,
      phone: users.phone,
      skills: users.skills,
      homeBase: users.homeBase,
      hireDate: users.hireDate,
      experienceYears: users.experienceYears,
      birthDate: users.birthDate,
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
  const techIds = techRows.map((t) => t.id);

  const [dayRows, queueRows, clocks, briefs, skillRows, vehicles] =
    await Promise.all([
      loadJobs(
        and(
          ne(jobs.status, "cancelled"),
          sql`${startExpr} >= ${ts(from)}`,
          sql`${startExpr} < ${ts(to)}`,
        ),
        400,
      ),
      loadJobs(
        and(
          eq(jobs.status, "unscheduled"),
          isNull(jobs.windowStart),
          isNull(jobs.scheduledStart),
        ),
        30,
      ),
      getClockStatuses(techIds),
      getUserBriefs(techIds),
      db
        .select({ id: serviceTypes.id, name: serviceTypes.name })
        .from(serviceTypes),
      Promise.all(
        techIds.map((id) => getAssignedVehicle(id).catch(() => null)),
      ),
    ]);
  const ids = [
    ...new Set([...dayRows, ...queueRows].map((r) => r.j.id)),
    ...(jobRow ? [jobRow.j.id] : []),
  ];
  const assigns = ids.length
    ? await db
        .select({
          jobId: jobAssignments.jobId,
          userId: jobAssignments.userId,
        })
        .from(jobAssignments)
        .where(inArray(jobAssignments.jobId, ids))
    : [];
  const byJob = new Map<string, string[]>();
  for (const a of assigns)
    byJob.set(a.jobId, [...(byJob.get(a.jobId) ?? []), a.userId]);
  const skillName = new Map(skillRows.map((s) => [s.id, s.name]));

  const reveal = (r: JobRow) =>
    revealsJobAddress(viewer, r.j, byJob.get(r.j.id) ?? [], now);
  const toHubJob = (r: JobRow): HubJob => {
    const s = r.j.windowStart ?? r.j.scheduledStart;
    const e = r.j.windowEnd ?? r.j.scheduledEnd;
    const minutes =
      s && e
        ? Math.max(15, Math.round((e.getTime() - s.getTime()) / 60_000))
        : (r.serviceMinutes ?? settings.jobs.default_window_min);
    const shown = reveal(r);
    const street = shown
      ? r.unit
        ? `${r.street} ${r.unit}`
        : r.street
      : maskStreetLine(r.street);
    return {
      id: r.j.id,
      number: r.j.number,
      title: r.j.title,
      status: r.j.status as JobStatus,
      start: s ? s.toISOString() : null,
      end: e
        ? e.toISOString()
        : s
          ? new Date(s.getTime() + minutes * 60_000).toISOString()
          : null,
      minutes,
      dayKey: s ? dateKey(s, tz) : null,
      address: [street, r.city].filter(Boolean).join(", "),
      customerName: r.customerName,
      lat: shown ? r.lat : null,
      lng: shown ? r.lng : null,
      serviceName: r.serviceName,
      assigneeIds: byJob.get(r.j.id) ?? [],
    };
  };
  const dayJobs = dayRows.map(toHubJob);
  const job = jobRow ? toHubJob(jobRow) : null;

  const manageTeam = viewer.perms.has("users.manage");
  const companyPt =
    company.address?.lat != null && company.address?.lng != null
      ? { lat: company.address.lat, lng: company.address.lng }
      : null;

  const techs: HubTech[] = techRows.map((t, i) => {
    const mine = dayJobs.filter((j) => j.assigneeIds.includes(t.id));
    const stops: HubStop[] = mine.map((j, k) => ({
      id: j.id,
      number: j.number,
      title: j.title,
      status: j.status,
      start: j.start,
      end: j.end,
      address: j.address,
      customerName: j.customerName,
      lat: j.lat,
      lng: j.lng,
      seq: k + 1,
    }));
    const hours =
      Math.round((mine.reduce((n, j) => n + j.minutes, 0) / 60) * 10) / 10;
    const clockedIn = clocks[t.id]?.clockedIn ?? false;
    const onJob =
      date === todayKey && mine.some((j) => ON_JOB.includes(j.status));
    const state: HubTechState = onJob
      ? "on_job"
      : clockedIn && date === todayKey
        ? "on_clock"
        : "off";
    const home =
      t.homeBase?.lat != null && t.homeBase?.lng != null
        ? { lat: t.homeBase.lat, lng: t.homeBase.lng }
        : null;
    const v = vehicles[i];
    return {
      id: t.id,
      name: t.name,
      color: colorFor(t.id, t.color),
      avatarUrl: briefs[t.id]?.avatarUrl ?? null,
      clockedIn,
      state,
      jobs: stops,
      hours,
      load: Math.min(1, hours / DAY_HOURS),
      start: home ?? companyPt,
      startLabel: home ? "Home base" : companyPt ? "Shop" : null,
      phone: t.phone,
      vehicle: v ? v.nickname : null,
      skills: (t.skills ?? [])
        .map((s) => skillName.get(s))
        .filter((s): s is string => !!s),
      experienceYears: t.experienceYears ?? null,
      hireDate: t.hireDate ?? null,
      tenure: tenureLabel(t.hireDate, todayKey),
      // ⚖️ Age only for team managers or the member themself; display only.
      age:
        manageTeam || viewer.id === t.id ? ageOn(t.birthDate, todayKey) : null,
    };
  });

  const toAssign = [
    ...dayJobs.filter(
      (j) => j.assigneeIds.length === 0 && !DONE.includes(j.status),
    ),
    ...queueRows.map(toHubJob).filter((j) => j.assigneeIds.length === 0),
  ];

  let recs: HubData["recs"] = [];
  if (job && !DONE.includes(job.status)) {
    const dayStart = zonedTimeToUtc(
      { ...parseDateKey(date), hour: settings.jobs.board_start_hour },
      tz,
    ).getTime();
    const dayEnd = zonedTimeToUtc(
      {
        ...parseDateKey(date),
        hour: Math.min(23, settings.jobs.board_end_hour),
      },
      tz,
    ).getTime();
    // Only route facts go in: never the profile fields above (see recommend.ts).
    const input: RecTech[] = techRows.map((t, i) => {
      const h = techs[i] as HubTech;
      return {
        id: t.id,
        available: true,
        clockedIn: h.clockedIn,
        start: h.start,
        skills: t.skills ?? [],
        stops: h.jobs
          .filter((s) => s.id !== job.id)
          .map((s) => ({
            id: s.id,
            lat: s.lat,
            lng: s.lng,
            start: s.start ? Date.parse(s.start) : null,
            end: s.end ? Date.parse(s.end) : null,
          })),
      };
    });
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    });
    recs = recommendTechs(
      {
        id: job.id,
        lat: job.lat,
        lng: job.lng,
        start: job.start ? Date.parse(job.start) : null,
        end: job.end && job.start ? Date.parse(job.end) : null,
        durationMin: job.minutes,
        serviceTypeId: jobRow?.j.serviceTypeId ?? null,
        serviceName: job.serviceName,
      },
      input,
      {
        isToday: date === todayKey,
        dayStart,
        dayEnd,
        notBefore: date === todayKey ? now.getTime() : undefined,
        timeLabel: (ms) => label.format(ms).replace(":00", ""),
      },
    );
  }

  const map = getMapConfig();
  return {
    date,
    todayKey,
    tz,
    isToday: date === todayKey,
    techs,
    toAssign,
    job,
    movedToJobDay,
    recs,
    tileUrl: map.tileUrl,
    attribution: map.attribution,
    canSetup: viewer.perms.has("settings.manage"),
    canReschedule: viewer.perms.has("jobs.reschedule"),
  };
}
