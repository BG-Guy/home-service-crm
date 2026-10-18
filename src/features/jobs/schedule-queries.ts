import "server-only";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
import { getDepositFlags } from "@/features/payments/api";
import { getClockStatuses } from "@/features/time/api";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/time";
import type { JobStatus, PaymentStatus } from "./contracts";
import { isoOrNull } from "./internal";
import { rangesOverlap, travelMinutes } from "./machine";
import { maskStreetLine, revealsJobAddress } from "./mask";

// Schedule board + dispatch reads (SPEC M05 calendar): tech columns, unscheduled
// queue, conflict warnings (overlap, outside ZIPs, not clocked in), travel-gap
// hints (straight line ÷ 30 mph), unpaid-deposit flags, "Unconfirmed tomorrow".

export type BoardView = "day" | "3day" | "week";

export interface BoardTech {
  id: string;
  name: string;
  color: string | null;
  clockedIn: boolean;
  serviceZips: string[];
}

export interface BoardJob {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  paymentStatus: PaymentStatus;
  priority: string;
  customerName: string;
  addressShort: string;
  zip: string;
  start: string | null;
  end: string | null;
  dayKey: string | null;
  techIds: string[];
  primaryTechId: string | null;
  assignees: { userId: string; role: "primary" | "helper"; splitBps: number }[];
  /** Minutes in the window (default 60). */
  minutes: number;
  serviceTypeName: string | null;
  serviceTypeColor: string | null;
  deposit: { required: boolean; paid: boolean; amountCents: number } | null;
  warnings: string[];
  travelHint: string | null;
  rescheduleRequested: boolean;
}

export interface BoardData {
  view: BoardView;
  date: string;
  todayKey: string;
  days: string[];
  tz: string;
  startHour: number;
  endHour: number;
  techs: BoardTech[];
  jobs: BoardJob[];
  unscheduled: BoardJob[];
  onHold: BoardJob[];
  unconfirmedTomorrow: BoardJob[];
}

/** Active technicians (base role tech) plus any extra user ids (e.g. office assignees). */
export async function techRoster(
  extraIds: string[] = [],
): Promise<BoardTech[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      color: users.color,
      serviceZips: users.serviceZips,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(
      or(
        and(
          eq(users.status, "active"),
          or(eq(roles.baseRole, "tech"), eq(users.role, "tech")),
        ),
        extraIds.length ? inArray(users.id, extraIds) : undefined,
      ),
    )
    .orderBy(asc(users.name));
  const clock = await getClockStatuses(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    clockedIn: clock[r.id]?.clockedIn ?? false,
    serviceZips: r.serviceZips ?? [],
  }));
}

function weekStart(key: string, tz: string): string {
  const { year, month, day } = parseDateKey(key);
  const wd = zonedParts(
    zonedTimeToUtc({ year, month, day, hour: 12 }, tz),
    tz,
  ).weekday;
  // Monday-first weeks.
  return addDaysToKey(key, -((wd + 6) % 7));
}

const startExpr = sql<Date | null>`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;

type Raw = {
  j: typeof jobs.$inferSelect;
  customerName: string;
  street: string;
  unit: string | null;
  zip: string;
  lat: number | null;
  lng: number | null;
  st: string | null;
  stColor: string | null;
};

async function loadRaw(
  where: ReturnType<typeof and>,
  limit = 500,
): Promise<Raw[]> {
  return db
    .select({
      j: jobs,
      customerName: customers.displayName,
      street: properties.street,
      unit: properties.unit,
      zip: properties.zip,
      lat: properties.lat,
      lng: properties.lng,
      st: serviceTypes.name,
      stColor: serviceTypes.color,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(where)
    .orderBy(asc(startExpr), asc(jobs.createdAt))
    .limit(limit);
}

async function assignMap(ids: string[]) {
  const map = new Map<
    string,
    { userId: string; role: string; splitBps: number }[]
  >();
  if (!ids.length) return map;
  const rows = await db
    .select({
      jobId: jobAssignments.jobId,
      userId: jobAssignments.userId,
      role: jobAssignments.role,
      splitBps: jobAssignments.splitBps,
    })
    .from(jobAssignments)
    .where(inArray(jobAssignments.jobId, ids));
  for (const r of rows) map.set(r.jobId, [...(map.get(r.jobId) ?? []), r]);
  return map;
}

function toBoardJob(
  r: Raw,
  a: { userId: string; role: string; splitBps: number }[],
  tz: string,
  deposit: BoardJob["deposit"],
): BoardJob {
  const start = r.j.windowStart ?? r.j.scheduledStart;
  const end = r.j.windowEnd ?? r.j.scheduledEnd;
  const custom = (r.j.custom ?? {}) as Record<string, unknown>;
  return {
    id: r.j.id,
    number: r.j.number,
    title: r.j.title,
    status: r.j.status as JobStatus,
    paymentStatus: r.j.paymentStatus as PaymentStatus,
    priority: r.j.priority,
    customerName: r.customerName,
    addressShort: r.unit ? `${r.street} ${r.unit}` : r.street,
    zip: r.zip,
    start: isoOrNull(start),
    end: isoOrNull(
      end ?? (start ? new Date(start.getTime() + 3600_000) : null),
    ),
    dayKey: start ? dateKey(start, tz) : null,
    techIds: a.map((x) => x.userId),
    primaryTechId:
      a.find((x) => x.role === "primary")?.userId ?? a[0]?.userId ?? null,
    assignees: a.map((x) => ({
      userId: x.userId,
      role: x.role === "helper" ? ("helper" as const) : ("primary" as const),
      splitBps: x.splitBps,
    })),
    minutes:
      start && end
        ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000))
        : 60,
    serviceTypeName: r.st,
    serviceTypeColor: r.stColor,
    deposit,
    warnings: [],
    travelHint: null,
    rescheduleRequested: !!custom.reschedule_requested_at,
  };
}

/** Annotate conflicts + travel hints in place (per tech, per day, time order). */
export function annotateConflicts(
  list: (BoardJob & { lat?: number | null; lng?: number | null })[],
  techs: BoardTech[],
  todayKey: string,
): void {
  const techById = new Map(techs.map((t) => [t.id, t]));
  const byTechDay = new Map<string, typeof list>();
  for (const j of list) {
    if (!j.start || !j.dayKey) continue;
    for (const t of j.techIds) {
      const k = `${t}|${j.dayKey}`;
      byTechDay.set(k, [...(byTechDay.get(k) ?? []), j]);
    }
    for (const t of j.techIds) {
      const tech = techById.get(t);
      if (!tech) continue;
      if (
        tech.serviceZips.length &&
        j.zip &&
        !tech.serviceZips.includes(j.zip.slice(0, 5))
      )
        j.warnings.push(`Outside ${tech.name.split(" ")[0]}'s service ZIPs`);
      if (
        j.dayKey === todayKey &&
        !tech.clockedIn &&
        (j.status === "scheduled" || j.status === "confirmed")
      )
        j.warnings.push(`${tech.name.split(" ")[0]} isn't clocked in`);
    }
  }
  for (const [, items] of byTechDay) {
    items.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    for (let i = 0; i < items.length; i++) {
      const cur = items[i] as (typeof items)[number];
      const prev = items[i - 1];
      if (!prev || !cur.start || !prev.start || !prev.end || !cur.end) continue;
      const pr = { start: new Date(prev.start), end: new Date(prev.end) };
      const cr = { start: new Date(cur.start), end: new Date(cur.end) };
      if (rangesOverlap(pr, cr)) {
        const msg = `Overlaps ${prev.number}`;
        if (!cur.warnings.includes(msg)) cur.warnings.push(msg);
        continue;
      }
      if (
        prev.lat != null &&
        prev.lng != null &&
        cur.lat != null &&
        cur.lng != null
      ) {
        const drive = travelMinutes(
          { lat: prev.lat, lng: prev.lng },
          { lat: cur.lat, lng: cur.lng },
        );
        const gap = Math.round(
          (cr.start.getTime() - pr.end.getTime()) / 60_000,
        );
        cur.travelHint = `~${drive} min drive from ${prev.number}`;
        if (drive > gap)
          cur.warnings.push(
            `Tight: ~${drive} min drive, ${Math.max(0, gap)} min gap`,
          );
      }
    }
  }
}

export async function loadBoard(params: {
  view?: string;
  date?: string;
  tech?: string;
}): Promise<BoardData> {
  const viewer = await requireUser("schedule.view_all");
  const tz = await getCompanyTimezone();
  const settings = await getSettings();
  const todayKey = dateKey(new Date(), tz);
  const view: BoardView =
    params.view === "3day" || params.view === "week" ? params.view : "day";
  const date =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : todayKey;
  const first = view === "week" ? weekStart(date, tz) : date;
  const n = view === "day" ? 1 : view === "3day" ? 3 : 7;
  const days = Array.from({ length: n }, (_, i) => addDaysToKey(first, i));
  const from = zonedTimeToUtc(parseDateKey(first), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(first, n)), tz);
  const tomorrow = addDaysToKey(todayKey, 1);
  const tFrom = zonedTimeToUtc(parseDateKey(tomorrow), tz);
  const tTo = zonedTimeToUtc(parseDateKey(addDaysToKey(tomorrow, 1)), tz);
  const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

  const [inRange, unsched, onHold, unconf] = await Promise.all([
    loadRaw(
      and(
        ne(jobs.status, "cancelled"),
        sql`${startExpr} >= ${ts(from)}`,
        sql`${startExpr} < ${ts(to)}`,
      ),
    ),
    loadRaw(and(eq(jobs.status, "unscheduled")), 100),
    loadRaw(and(eq(jobs.status, "on_hold")), 50),
    loadRaw(
      and(
        eq(jobs.status, "scheduled"),
        isNull(jobs.confirmedAt),
        sql`${startExpr} >= ${ts(tFrom)}`,
        sql`${startExpr} < ${ts(tTo)}`,
      ),
      100,
    ),
  ]);
  const all = [...inRange, ...unsched, ...onHold, ...unconf];
  const ids = [...new Set(all.map((r) => r.j.id))];
  const [assigns, deposits] = await Promise.all([
    assignMap(ids),
    getDepositFlags(ids).catch(
      () => ({}) as Awaited<ReturnType<typeof getDepositFlags>>,
    ),
  ]);
  const assignedIds = [
    ...new Set([...assigns.values()].flat().map((a) => a.userId)),
  ];
  const techs = await techRoster(assignedIds);
  const mk = (r: Raw) => {
    const a = assigns.get(r.j.id) ?? [];
    // Contact window (SPEC §4.2): no house number for viewers without
    // customers.contact_view outside the job's window (QA T5-11).
    const reveal = revealsJobAddress(
      viewer,
      r.j,
      a.map((x) => x.userId),
    );
    const job = toBoardJob(r, a, tz, deposits[r.j.id] ?? null);
    return reveal
      ? { ...job, lat: r.lat, lng: r.lng }
      : {
          ...job,
          addressShort: maskStreetLine(r.street),
          lat: null,
          lng: null,
        };
  };
  let rangeJobs = inRange.map(mk);
  if (params.tech)
    rangeJobs = rangeJobs.filter((j) =>
      j.techIds.includes(params.tech as string),
    );
  annotateConflicts(rangeJobs, techs, todayKey);
  const strip = ({ lat: _a, lng: _b, ...j }: ReturnType<typeof mk>): BoardJob =>
    j;
  return {
    view,
    date,
    todayKey,
    days,
    tz,
    startHour: settings.jobs.board_start_hour,
    endHour: settings.jobs.board_end_hour,
    techs: params.tech ? techs.filter((t) => t.id === params.tech) : techs,
    jobs: rangeJobs.map(strip),
    unscheduled: unsched.map(mk).map(strip),
    onHold: onHold.map(mk).map(strip),
    unconfirmedTomorrow: unconf.map(mk).map(strip),
  };
}
