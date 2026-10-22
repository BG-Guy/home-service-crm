import "server-only";
import { asc, inArray } from "drizzle-orm";
import { getMapConfig } from "@/adapters/maps";
import { db } from "@/db";
import { users } from "@/db/schema";
import { navigateHref } from "@/features/customers/normalize";
import { getUserBriefs } from "@/features/team/api";
import { requireUser } from "@/lib/auth/current";
import { maskPhone } from "@/lib/mask";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { addDaysToKey, dateKey, formatDateKey, zonedParts } from "@/lib/time";
import { techColor } from "../components/schedule/colors";
import type { JobStatus } from "../contracts";
import {
  type JobRow,
  loadActiveTechRows,
  loadAssignees,
  loadDayJobs,
} from "../dispatch/queries";
import { maskStreetLine, revealsJobAddress } from "../mask";
import { buildTechDays, shortName, timelineSpan } from "./route";
import type { ScheduleMapData, SmJob, SmPoint, SmTech } from "./types";

// Schedule map reads (/schedule?view=map): one day, every technician's route and
// every job of the day (cancelled left out), built on the Assign hub's day query.
// Same permission as the schedule board (schedule.view_all) and the same contact
// window: outside it a viewer without customers.contact_view gets no house
// number, pin, directions or phone (SPEC §4.2).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTES_MAX = 280;

function trimNotes(...parts: (string | null)[]): string | null {
  const text = parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  return text.length > NOTES_MAX
    ? `${text.slice(0, NOTES_MAX - 1).trimEnd()}…`
    : text;
}

const pointOf = (
  a: { lat?: number | null; lng?: number | null } | null,
): SmPoint | null =>
  a?.lat != null && a?.lng != null ? { lat: a.lat, lng: a.lng } : null;

/** Load the map view for one day (`?date=`, default today in the company zone). */
export async function loadScheduleMap(params: {
  date?: string;
  userAgent?: string | null;
}): Promise<ScheduleMapData> {
  const viewer = await requireUser("schedule.view_all");
  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const now = new Date();
  const todayKey = dateKey(now, tz);
  const date =
    params.date && DATE_RE.test(params.date) ? params.date : todayKey;
  // Wall-clock minutes from the day's local midnight (DST-safe: from the zone).
  const minutesOf = (d: Date) => {
    const p = zonedParts(d, tz);
    const k = dateKey(d, tz);
    return (k === date ? 0 : k > date ? 1440 : -1440) + p.hour * 60 + p.minute;
  };

  const [techRows, dayRows] = await Promise.all([
    loadActiveTechRows(),
    loadDayJobs(date, tz),
  ]);
  const assignees = await loadAssignees(dayRows.map((r) => r.j.id));
  // An office user on a job still gets a route (like the board's columns).
  const known = new Set(techRows.map((t) => t.id));
  const extraIds = [...new Set([...assignees.values()].flat())].filter(
    (id) => !known.has(id),
  );
  const extraRows = extraIds.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          color: users.color,
          homeBase: users.homeBase,
        })
        .from(users)
        .where(inArray(users.id, extraIds))
        .orderBy(asc(users.name))
    : [];
  const people = [...techRows, ...extraRows].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const briefs = await getUserBriefs(people.map((p) => p.id));

  const canText = viewer.perms.has("messages.send");
  const canView = viewer.perms.has("customers.view");
  const toJob = (r: JobRow): SmJob => {
    const ids = assignees.get(r.j.id) ?? [];
    const reveal = revealsJobAddress(viewer, r.j, ids, now);
    const start = (r.j.windowStart ?? r.j.scheduledStart) as Date;
    const endAt =
      r.j.windowEnd ??
      r.j.scheduledEnd ??
      new Date(
        start.getTime() +
          (r.serviceMinutes ?? settings.jobs.default_window_min) * 60_000,
      );
    const startMin = minutesOf(start);
    const street = reveal
      ? r.unit
        ? `${r.street} ${r.unit}`
        : r.street
      : maskStreetLine(r.street);
    const anonymized = !!r.customerAnonymizedAt;
    const phone = anonymized ? null : r.customerPhone;
    const contact = reveal && !anonymized;
    return {
      id: r.j.id,
      number: r.j.number,
      title: r.j.title,
      status: r.j.status as JobStatus,
      serviceName: r.serviceName,
      customerId: r.j.customerId,
      customerName: r.customerName,
      customerShort: shortName(r.customerName, r.customerType),
      phoneLabel: phone
        ? contact
          ? formatPhoneDisplay(phone)
          : maskPhone(phone)
        : null,
      canCall: contact && canView && !!phone,
      canText:
        contact &&
        canText &&
        !!phone &&
        !r.doNotText &&
        !r.doNotContact &&
        r.smsStatus !== "opted_out",
      address: [street, r.city].filter(Boolean).join(", "),
      navHref:
        reveal && r.state && r.zip
          ? navigateHref(
              {
                street: street,
                city: r.city ?? "",
                state: r.state,
                zip: r.zip,
                lat: r.lat,
                lng: r.lng,
              },
              params.userAgent,
            )
          : null,
      lat: reveal ? r.lat : null,
      lng: reveal ? r.lng : null,
      startMin,
      endMin: Math.max(startMin + 15, minutesOf(endAt)),
      techIds: ids,
      notes: trimNotes(r.j.description, r.j.customerNotes),
      createdAt: r.j.createdAt.toISOString(),
    };
  };
  const jobs = dayRows.map(toJob);

  const starts = new Map(people.map((p) => [p.id, pointOf(p.homeBase)]));
  const days = buildTechDays(
    people.map((p) => ({ id: p.id, start: starts.get(p.id) ?? null })),
    jobs,
  );
  const techs: SmTech[] = people.map((p) => {
    const d = days.get(p.id);
    return {
      id: p.id,
      name: p.name,
      color: techColor(
        {
          id: p.id,
          name: p.name,
          color: p.color,
          clockedIn: false,
          serviceZips: [],
        },
        p.id,
      ),
      avatarUrl: briefs[p.id]?.avatarUrl ?? null,
      start: starts.get(p.id) ?? null,
      jobIds: d?.jobIds ?? [],
      miles: d?.miles ?? 0,
      firstMin: d?.firstMin ?? null,
      lastMin: d?.lastMin ?? null,
    };
  });

  const span = timelineSpan(
    jobs,
    settings.jobs.board_start_hour,
    settings.jobs.board_end_hour,
    date === todayKey ? minutesOf(now) : null,
  );
  const map = getMapConfig(settings.map);
  const prev = addDaysToKey(date, -1);
  const next = addDaysToKey(date, 1);
  return {
    date,
    todayKey,
    labels: {
      day:
        date === todayKey
          ? "Today"
          : next === todayKey
            ? "Yesterday"
            : prev === todayKey
              ? "Tomorrow"
              : formatDateKey(date, "en-US", { weekday: "long" }),
      date: formatDateKey(date, "en-US", {
        month: "short",
        day: "numeric",
        year: date.slice(0, 4) === todayKey.slice(0, 4) ? undefined : "numeric",
      }),
      short: formatDateKey(date, "en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      prev,
      next,
    },
    nowMin: minutesOf(now),
    renderedAt: now.getTime(),
    dayStartMin: span.startMin,
    dayEndMin: span.endMin,
    techs,
    jobs,
    tileUrl: map.tileUrl,
    attribution: map.attribution,
    setupHref: viewer.perms.has("settings.manage") ? "/settings/map" : null,
    canAssign: viewer.perms.has("jobs.assign"),
    canReschedule: viewer.perms.has("jobs.reschedule"),
  };
}
