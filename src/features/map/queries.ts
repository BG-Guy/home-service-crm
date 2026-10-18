import "server-only";
import { and, asc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { cache } from "react";
import { getMapConfig } from "@/adapters/maps";
import { db } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  properties,
  techLocations,
} from "@/db/schema";
import { listUsers } from "@/features/team/api";
import { getClockStatuses } from "@/features/time/api";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { endOfDayInTz, startOfDayInTz } from "@/lib/time";
import { initials } from "@/ui/components/Avatar";
import type { LiveJob, LiveJobBrief, LiveMapData, LiveTech } from "./contracts";
import { ACTIVE_JOB_STATUSES } from "./engine";
import { roughEtaMinutes, techMapStatus } from "./rules";

// Read DAL for the live map (SPEC M19). `map.view` (admin/office) only.

const DONE = ["completed", "closed", "cancelled"];

/** Today's jobs (company TZ) plus any job still active from earlier. */
async function todaysJobs(): Promise<LiveJob[]> {
  const tz = await getCompanyTimezone();
  const now = new Date();
  const from = startOfDayInTz(now, tz);
  const to = endOfDayInTz(now, tz);
  const when = sql`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;
  const rows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      windowStart: jobs.windowStart,
      windowEnd: jobs.windowEnd,
      scheduledStart: jobs.scheduledStart,
      etaAt: jobs.etaAt,
      street: properties.street,
      city: properties.city,
      lat: properties.lat,
      lng: properties.lng,
      customerName: customers.displayName,
    })
    .from(jobs)
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(
      and(
        ne(jobs.status, "cancelled"),
        or(
          and(gte(when, from), lt(when, to)),
          inArray(jobs.status, [...ACTIVE_JOB_STATUSES]),
        ),
      ),
    )
    .orderBy(asc(when))
    .limit(300);
  const ids = rows.map((r) => r.id);
  const assigns = ids.length
    ? await db
        .select({
          jobId: jobAssignments.jobId,
          userId: jobAssignments.userId,
          role: jobAssignments.role,
        })
        .from(jobAssignments)
        .where(inArray(jobAssignments.jobId, ids))
        .orderBy(asc(jobAssignments.role))
    : [];
  const byJob = new Map<string, string[]>();
  for (const a of assigns) {
    const list = byJob.get(a.jobId) ?? [];
    list.push(a.userId);
    byJob.set(a.jobId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    windowStart: (r.windowStart ?? r.scheduledStart)?.toISOString() ?? null,
    windowEnd: r.windowEnd?.toISOString() ?? null,
    etaAt: r.etaAt?.toISOString() ?? null,
    address: `${r.street}, ${r.city}`,
    lat: r.lat,
    lng: r.lng,
    customerName: r.customerName,
    techIds: byJob.get(r.id) ?? [],
    techNames: [],
  }));
}

const brief = (j: LiveJob | undefined): LiveJobBrief | null =>
  j
    ? {
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        windowStart: j.windowStart,
        windowEnd: j.windowEnd,
        etaAt: j.etaAt,
        address: j.address,
        lat: j.lat,
        lng: j.lng,
      }
    : null;

export const getLiveMap = cache(async (): Promise<LiveMapData> => {
  const viewer = await requireUser("map.view");
  const [settings, staff, jobList, tz] = await Promise.all([
    getSettings(),
    listUsers(),
    todaysJobs(),
    getCompanyTimezone(),
  ]);
  const techs = staff.filter((u) => u.baseRole === "tech");
  const ids = techs.map((t) => t.id);
  const [clock, locs] = await Promise.all([
    getClockStatuses(ids),
    ids.length
      ? db
          .select()
          .from(techLocations)
          .where(inArray(techLocations.userId, ids))
      : Promise.resolve([]),
  ]);
  const locBy = new Map(locs.map((l) => [l.userId, l]));
  const nameBy = new Map(staff.map((u) => [u.id, u.name]));
  for (const j of jobList)
    j.techNames = j.techIds.map((id) => nameBy.get(id) ?? "—");
  const now = Date.now();
  const out: LiveTech[] = techs.map((t) => {
    const mine = jobList.filter((j) => j.techIds.includes(t.id));
    const current = mine.find((j) =>
      (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status),
    );
    const next = mine.find(
      (j) =>
        j !== current &&
        !DONE.includes(j.status) &&
        !(ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status) &&
        (!j.windowStart ||
          new Date(j.windowStart).getTime() > now - 2 * 3600_000),
    );
    const l = locBy.get(t.id);
    const clockedIn = !!clock[t.id]?.clockedIn;
    const target =
      current?.status === "en_route" ? current : current ? null : next;
    let eta: number | null = null;
    if (target?.etaAt && current?.status === "en_route")
      eta = Math.max(
        1,
        Math.round((new Date(target.etaAt).getTime() - now) / 60_000),
      );
    else if (l && target?.lat != null && target.lng != null)
      eta = roughEtaMinutes(l, { lat: target.lat, lng: target.lng });
    return {
      id: t.id,
      name: t.name,
      initials: initials(t.name),
      color: t.color,
      clockedIn,
      status: techMapStatus({
        clockedIn,
        currentJobStatus: current?.status ?? null,
      }),
      location: l
        ? {
            lat: l.lat,
            lng: l.lng,
            accuracyM: l.accuracyM,
            recordedAt: l.recordedAt.toISOString(),
            source: l.source,
          }
        : null,
      currentJob: brief(current),
      nextJob: brief(next),
      etaMinutes: eta,
    };
  });
  const map = getMapConfig();
  return {
    generatedAt: new Date().toISOString(),
    techs: out,
    jobs: jobList,
    staleMinutes: settings.map.stale_minutes,
    hideAfterMinutes: settings.map.hide_after_minutes,
    tileUrl: map.tileUrl,
    attribution: map.attribution,
    canAssign: viewer.perms.has("jobs.assign"),
    timeZone: tz,
    canSetup: viewer.perms.has("settings.manage"),
  };
});
