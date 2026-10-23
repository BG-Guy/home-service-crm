import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { getMapConfig } from "@/adapters/maps";
import { execRows } from "@/db";
import { revealsJobAddress } from "@/features/jobs/mask";
import { NotFoundError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  formatTimeRange,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type {
  LeadsMapData,
  LeadsMapJob,
  LeadsMapPoint,
  MapCoverage,
  MissingReason,
} from "./components/map/types";
import type { LeadStatus } from "./contracts";
import { initialsOf, shortName } from "./rules";

// Lead map reads (leads-flow redesign item 10): the inbox's open leads that have a
// map position (through their property: properties.lat/lng, filled by the geocode
// worker in customers/workers.ts), today's jobs as small markers, and how many
// open leads can't show yet and why. Two queries, no per-row lookups. The page
// calls requireUser("leads.view") first; this checks the permission again so it
// is never only in the UI. Today's jobs follow the jobs permissions
// (jobs.view_all, else only the viewer's own) and the contact window (no pin
// outside it without customers.contact_view, SPEC §4.2).

/** Cap on today's job markers (a very busy day still draws fast). */
const JOB_LIMIT = 300;

export type LeadMapRow = {
  id: string;
  status: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  customer_id: string | null;
  property_id: string | null;
  created_at: Date | string;
  first_response_at: Date | string | null;
  service_name: string | null;
  service_text: string | null;
  lat: number | string | null;
  lng: number | string | null;
  geocode_status: string | null;
  has_address: boolean;
};

export type JobMapRow = {
  id: string;
  number: string;
  title: string;
  status: string;
  service_name: string | null;
  window_start: Date | string | null;
  window_end: Date | string | null;
  scheduled_start: Date | string | null;
  scheduled_end: Date | string | null;
  en_route_at: Date | string | null;
  completed_at: Date | string | null;
  lat: number | string;
  lng: number | string;
  assignees: string | null;
};

const iso = (d: Date | string | null): string | null =>
  d == null ? null : new Date(d).toISOString();
const date = (d: Date | string | null): Date | null =>
  d == null ? null : new Date(d);
const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Why a lead row has no map position (null: it has one). */
export function missingReason(r: LeadMapRow): MissingReason | null {
  if (num(r.lat) != null && num(r.lng) != null) return null;
  if (!r.property_id) return r.has_address ? "no_property" : "no_address";
  return r.geocode_status === "failed" ? "failed" : "pending";
}

/** Lead rows → pins (rows without a position left out) and the coverage counts. */
export function shapeLeadPins(rows: readonly LeadMapRow[]): {
  points: LeadsMapPoint[];
  coverage: MapCoverage;
} {
  const coverage: MapCoverage = {
    total: rows.length,
    placed: 0,
    missing: { no_address: 0, no_property: 0, pending: 0, failed: 0 },
  };
  const points: LeadsMapPoint[] = [];
  for (const r of rows) {
    const why = missingReason(r);
    if (why) {
      coverage.missing[why] += 1;
      continue;
    }
    coverage.placed += 1;
    // The lead box's name rule (queries.ts toLeadBox), so pin and box agree.
    const name =
      r.name?.trim() ||
      (r.phone ? formatPhone(r.phone) : null) ||
      r.email ||
      "Unknown";
    points.push({
      id: r.id,
      lat: num(r.lat) as number,
      lng: num(r.lng) as number,
      initials: initialsOf(name),
      status: r.status as LeadStatus,
      slaStart: iso(r.created_at) as string,
      respondedAt: iso(r.first_response_at),
      name: shortName(name),
      seed: r.customer_id ?? r.id,
      service: r.service_name ?? r.service_text,
    });
  }
  return { points, coverage };
}

/** "9 – 11 AM" (company zone), "9 AM" without an end. */
function windowLabel(start: Date, end: Date | null, tz: string): string {
  const text = end
    ? formatTimeRange(start, end, tz)
    : new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
      }).format(start);
  return text.replace(/:00/g, "");
}

/**
 * Job rows → markers: "J-1042 · Lockout · 9 – 11 AM". Jobs whose exact place the
 * viewer may not see right now (outside the contact window without
 * customers.contact_view) are left out.
 */
export function shapeJobMarkers(
  rows: readonly JobMapRow[],
  viewer: { id: string; perms: ReadonlySet<string> },
  tz: string,
  now: Date = new Date(),
): LeadsMapJob[] {
  const out: LeadsMapJob[] = [];
  for (const r of rows) {
    const lat = num(r.lat);
    const lng = num(r.lng);
    if (lat == null || lng == null) continue;
    const assignees = r.assignees ? r.assignees.split(",") : [];
    const job = {
      status: r.status,
      scheduledStart: date(r.scheduled_start),
      windowStart: date(r.window_start),
      enRouteAt: date(r.en_route_at),
      completedAt: date(r.completed_at),
    };
    if (!revealsJobAddress(viewer, job, assignees, now)) continue;
    const start = date(r.window_start) ?? date(r.scheduled_start);
    const end = r.window_start ? date(r.window_end) : date(r.scheduled_end);
    const what = r.service_name?.trim() || r.title.trim();
    out.push({
      id: r.id,
      lat,
      lng,
      label: [r.number, what, start ? windowLabel(start, end, tz) : null]
        .filter(Boolean)
        .join(" · "),
      state:
        r.status === "completed" || r.status === "closed"
          ? "done"
          : r.status === "en_route" ||
              r.status === "arrived" ||
              r.status === "in_progress"
            ? "live"
            : "planned",
    });
  }
  return out;
}

/** Open inbox leads ("Check" left out), with their property's position. */
function loadLeadRows(threshold: number) {
  return execRows<LeadMapRow>(sql`
    select l.id, l.status, l.name, l.phone, l.email, l.customer_id, l.property_id,
      l.created_at, l.first_response_at, st.name as service_name, l.service_text,
      p.lat, p.lng, p.geocode_status,
      (nullif(trim(l.address->>'street'), '') is not null
        and nullif(trim(l.address->>'zip'), '') is not null) as has_address
    from leads l
    left join properties p on p.id = l.property_id and p.deleted_at is null
    left join service_types st on st.id = l.service_type_id
    where l.status in ('new', 'contacted', 'qualified')
      and l.spam_score < ${threshold}
    order by l.created_at, l.id`);
}

/** Today's jobs (company zone, cancelled left out) that have a position. */
function loadJobRows(
  from: Date,
  to: Date,
  own: string | null,
): Promise<JobMapRow[]> {
  const start = sql`coalesce(j.window_start, j.scheduled_start)`;
  return execRows<JobMapRow>(sql`
    select j.id, j.number, j.title, j.status, st.name as service_name,
      j.window_start, j.window_end, j.scheduled_start, j.scheduled_end,
      j.en_route_at, j.completed_at, p.lat, p.lng,
      (select string_agg(a.user_id::text, ',') from job_assignments a
        where a.job_id = j.id) as assignees
    from jobs j
    join properties p on p.id = j.property_id
    left join service_types st on st.id = j.service_type_id
    where j.status <> 'cancelled'
      and ${start} >= ${from.toISOString()}::timestamptz
      and ${start} < ${to.toISOString()}::timestamptz
      and p.lat is not null and p.lng is not null
      ${
        own
          ? sql`and exists (select 1 from job_assignments a
              where a.job_id = j.id and a.user_id = ${own})`
          : sql``
      }
    order by ${start}, j.id
    limit ${JOB_LIMIT}`);
}

/**
 * The lead map: pins for the open leads that have a map position, today's jobs,
 * the coverage counts and the street map setup. Spread the result into
 * `<LazyLeadsMap {...data} layout=… />`.
 */
export const getLeadsMapData = cache(
  async (viewer: SessionUser): Promise<LeadsMapData> => {
    if (!viewer.perms.has("leads.view")) throw new NotFoundError("Lead");
    const [settings, tz] = await Promise.all([
      getSettings(),
      getCompanyTimezone(),
    ]);
    const now = new Date();
    const today = dateKey(now, tz);
    const from = zonedTimeToUtc(parseDateKey(today), tz);
    const to = zonedTimeToUtc(parseDateKey(addDaysToKey(today, 1)), tz);
    const allJobs = viewer.perms.has("jobs.view_all");
    const ownJobs = !allJobs && viewer.perms.has("jobs.view_own");
    const [leadRows, jobRows] = await Promise.all([
      loadLeadRows(settings.leads.spam_review_threshold),
      allJobs || ownJobs
        ? loadJobRows(from, to, ownJobs ? viewer.id : null)
        : Promise.resolve([] as JobMapRow[]),
    ]);
    const { points, coverage } = shapeLeadPins(leadRows);
    const map = getMapConfig(settings.map);
    return {
      points,
      jobs: shapeJobMarkers(jobRows, viewer, tz, now),
      coverage,
      tileUrl: map.tileUrl,
      attribution: map.attribution,
      setupHref: viewer.perms.has("settings.manage") ? "/settings/map" : null,
    };
  },
);
