import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import {
  customers,
  invoices,
  jobAssignments,
  jobStatusEvents,
  jobs,
  media,
  notes,
  properties,
  serviceTypes,
  users,
} from "@/db/schema";
import { contactRevealedFor } from "@/features/customers/api";
import { navigateHref } from "@/features/customers/normalize";
import { requireAnyPerm, requireUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { EntityRef, SessionUser } from "@/lib/types";
import { checklistPhotoTag, isPhotoRef } from "./checklist";
import type { JobStatus, PaymentStatus, RiskBand } from "./contracts";
import { isoOrNull } from "./internal";
import { DONE_STATUSES, OPEN_STATUSES } from "./machine";
import { maskStreetLine, revealsJobAddress } from "./mask";
import type {
  ChecklistItemView,
  JobDetail,
  JobListFilters,
  JobListItem,
  StatusEventView,
} from "./types";

// Read DAL for jobs (SPEC §3.1): requireUser first, row scope in SQL ("own" = an
// assignment for the viewer unless jobs.view_all), one query + IN batches, cursor
// pagination (SPEC §14 rule 8).

const PAGE = 40;
const sortKey = sql<Date>`coalesce(${jobs.windowStart}, ${jobs.scheduledStart}, ${jobs.createdAt})`;

export function canViewAll(u: SessionUser): boolean {
  return u.perms.has("jobs.view_all");
}

function assignedTo(userId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(jobAssignments)
      .where(
        and(
          eq(jobAssignments.jobId, jobs.id),
          eq(jobAssignments.userId, userId),
        ),
      ),
  );
}

/** Row scope for the viewer (DAL-enforced, SPEC §4.2). */
export function jobScope(u: SessionUser): SQL | undefined {
  return canViewAll(u) ? undefined : assignedTo(u.id);
}

/** Timestamp parameter with an explicit cast (sort keys are untyped SQL expressions). */
export const tsParam = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const sortGte = (d: Date) => sql`${sortKey} >= ${tsParam(d)}`;
const sortLt = (d: Date) => sql`${sortKey} < ${tsParam(d)}`;

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(
  c: string | null | undefined,
): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
    const at = new Date(iso ?? "");
    if (!id || Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export async function assigneesFor(
  jobIds: string[],
): Promise<Map<string, JobListItem["assignees"]>> {
  const map = new Map<string, JobListItem["assignees"]>();
  if (jobIds.length === 0) return map;
  const rows = await db
    .select({
      jobId: jobAssignments.jobId,
      userId: jobAssignments.userId,
      role: jobAssignments.role,
      name: users.name,
      color: users.color,
    })
    .from(jobAssignments)
    .innerJoin(users, eq(users.id, jobAssignments.userId))
    .where(inArray(jobAssignments.jobId, jobIds))
    .orderBy(asc(jobAssignments.role), asc(jobAssignments.assignedAt));
  for (const r of rows) {
    const list = map.get(r.jobId) ?? [];
    list.push({ userId: r.userId, name: r.name, role: r.role, color: r.color });
    map.set(r.jobId, list);
  }
  return map;
}

type ListRow = {
  j: typeof jobs.$inferSelect;
  customerName: string;
  street: string;
  unit: string | null;
  city: string | null;
  lat?: number | null;
  lng?: number | null;
  state?: string | null;
  zip?: string | null;
  customerPhone?: string | null;
  customerAnonymizedAt?: Date | null;
  doNotText?: boolean;
  doNotContact?: boolean;
  smsStatus?: string;
  serviceTypeName: string | null;
  sort: Date;
};

export function toListItem(
  r: ListRow,
  assignees: JobListItem["assignees"],
  /** Masks the street outside this viewer's contact window (omit for system reads). */
  viewer?: SessionUser,
  /** The request's user agent: adds the Directions link (Apple Maps on Apple devices). */
  userAgent?: string | null,
): JobListItem {
  const reveal = revealsJobAddress(
    viewer,
    r.j,
    assignees.map((a) => a.userId),
  );
  // The card's quick actions, by the schedule map's rules: only inside the contact
  // window, never for an anonymized customer; the call goes through the app.
  const contact =
    !!viewer && reveal && !r.customerAnonymizedAt && !!r.customerPhone;
  const street = r.unit ? `${r.street} ${r.unit}` : r.street;
  return {
    id: r.j.id,
    number: r.j.number,
    title: r.j.title,
    status: r.j.status as JobStatus,
    paymentStatus: r.j.paymentStatus as PaymentStatus,
    priority: r.j.priority as JobListItem["priority"],
    customerId: r.j.customerId,
    customerName: r.customerName,
    propertyId: r.j.propertyId,
    addressShort: reveal
      ? r.unit
        ? `${r.street} ${r.unit}`
        : r.street
      : maskStreetLine(r.street),
    addressMasked: !reveal,
    lat: reveal ? (r.lat ?? null) : null,
    lng: reveal ? (r.lng ?? null) : null,
    canCall: contact && !!viewer?.perms.has("customers.view"),
    canText:
      contact &&
      !!viewer?.perms.has("messages.send") &&
      !r.doNotText &&
      !r.doNotContact &&
      r.smsStatus !== "opted_out",
    navHref:
      userAgent !== undefined && reveal && r.state && r.zip
        ? navigateHref(
            {
              street,
              city: r.city ?? "",
              state: r.state,
              zip: r.zip,
              lat: r.lat,
              lng: r.lng,
            },
            userAgent,
          )
        : null,
    city: r.city,
    windowStart: isoOrNull(r.j.windowStart ?? r.j.scheduledStart),
    windowEnd: isoOrNull(r.j.windowEnd ?? r.j.scheduledEnd),
    serviceTypeName: r.serviceTypeName,
    isCallback: r.j.isCallback,
    riskBand: (r.j.riskBand as RiskBand | null) ?? null,
    assignees,
    cancelledAfterArrival: r.j.status === "cancelled" && r.j.arrivedAt != null,
  };
}

export const listRowSelect = {
  j: jobs,
  customerName: customers.displayName,
  street: properties.street,
  unit: properties.unit,
  city: properties.city,
  lat: properties.lat,
  lng: properties.lng,
  state: properties.state,
  zip: properties.zip,
  customerPhone: customers.phone,
  customerAnonymizedAt: customers.anonymizedAt,
  doNotText: customers.doNotText,
  doNotContact: customers.doNotContact,
  smsStatus: customers.smsStatus,
  serviceTypeName: serviceTypes.name,
  sort: sortKey,
};

/** The request's user agent for map links; null outside a request (scripts, tests). */
async function requestUserAgent(): Promise<string | null> {
  try {
    return (await headers()).get("user-agent");
  } catch {
    return null;
  }
}

/** /jobs list with Appendix A filters and a keyset cursor. */
export async function listJobs(
  f: JobListFilters,
): Promise<{ items: JobListItem[]; nextCursor: string | null; tz: string }> {
  const user = await requireAnyPerm(["jobs.view_all", "jobs.view_own"]);
  const [tz, ua] = await Promise.all([getCompanyTimezone(), requestUserAgent()]);
  const conds: (SQL | undefined)[] = [jobScope(user)];
  if (f.mine) conds.push(assignedTo(user.id));
  if (f.tech && canViewAll(user)) conds.push(assignedTo(f.tech));
  if (f.status?.length) conds.push(inArray(jobs.status, f.status));
  if (f.view === "upcoming")
    conds.push(inArray(jobs.status, [...OPEN_STATUSES]));
  if (f.view === "past") conds.push(inArray(jobs.status, [...DONE_STATUSES]));
  if (f.callback) conds.push(eq(jobs.isCallback, true));
  if (f.cancelledAfterArrival)
    conds.push(and(eq(jobs.status, "cancelled"), isNotNull(jobs.arrivedAt)));
  if (f.unassigned)
    conds.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(jobAssignments)
          .where(eq(jobAssignments.jobId, jobs.id)),
      ),
    );
  if (f.unconfirmed)
    conds.push(and(eq(jobs.status, "scheduled"), sortGte(new Date())));
  if (f.noInvoiceAfter48h)
    conds.push(
      and(
        eq(jobs.status, "completed"),
        lt(jobs.completedAt, new Date(Date.now() - 48 * 3600_000)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(invoices)
            .where(
              and(
                eq(invoices.jobId, jobs.id),
                ne(invoices.status, "void"),
                ne(invoices.status, "draft"),
              ),
            ),
        ),
      ),
    );
  if (f.depositDue)
    conds.push(
      sql`exists (select 1 from deposit_requests d where d.job_id = ${jobs.id} and d.status in ('required','requested'))`,
    );
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from))
    conds.push(sortGte(zonedTimeToUtc(parseDateKey(f.from), tz)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to))
    conds.push(sortLt(zonedTimeToUtc(parseDateKey(addDaysToKey(f.to, 1)), tz)));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(jobs.number, like),
        ilike(jobs.title, like),
        ilike(customers.displayName, like),
        ilike(properties.street, like),
        digits.length >= 4 ? ilike(customers.phone, `%${digits}%`) : undefined,
      ),
    );
  }
  const asc_ = f.view === "upcoming";
  const cur = decodeCursor(f.cursor);
  if (cur)
    conds.push(
      asc_
        ? sql`(${sortKey}, ${jobs.id}) > (${tsParam(cur.at)}, ${cur.id}::uuid)`
        : sql`(${sortKey}, ${jobs.id}) < (${tsParam(cur.at)}, ${cur.id}::uuid)`,
    );
  const rows = await db
    .select(listRowSelect)
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(and(...conds))
    .orderBy(
      asc_ ? asc(sortKey) : desc(sortKey),
      asc_ ? asc(jobs.id) : desc(jobs.id),
    )
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const assignees = await assigneesFor(page.map((r) => r.j.id));
  const last = page[page.length - 1];
  return {
    items: page.map((r) =>
      toListItem(r, assignees.get(r.j.id) ?? [], user, ua),
    ),
    nextCursor:
      rows.length > PAGE && last
        ? encodeCursor(new Date(last.sort), last.j.id)
        : null,
    tz,
  };
}

/** Full job detail for /jobs/[id]; null when missing or out of the viewer's scope. */
export const getJobDetail = cache(
  async (jobId: string): Promise<JobDetail | null> => {
    const user = await requireAnyPerm(["jobs.view_all", "jobs.view_own"]);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
    const creator = alias(users, "creator");
    const orig = alias(jobs, "orig");
    const [r] = await db
      .select({
        j: jobs,
        c: {
          displayName: customers.displayName,
          firstName: customers.firstName,
        },
        p: properties,
        st: serviceTypes.name,
        createdByName: creator.name,
        origNumber: orig.number,
      })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .innerJoin(properties, eq(properties.id, jobs.propertyId))
      .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
      .leftJoin(creator, eq(creator.id, jobs.createdBy))
      .leftJoin(orig, eq(orig.id, jobs.callbackOfJobId))
      .where(and(eq(jobs.id, jobId), jobScope(user)))
      .limit(1);
    if (!r) return null;
    const { j, p } = r;
    const assignRows = await db
      .select({
        userId: jobAssignments.userId,
        role: jobAssignments.role,
        splitBps: jobAssignments.splitBps,
        name: users.name,
        color: users.color,
      })
      .from(jobAssignments)
      .innerJoin(users, eq(users.id, jobAssignments.userId))
      .where(eq(jobAssignments.jobId, j.id))
      .orderBy(asc(jobAssignments.role), asc(jobAssignments.assignedAt));
    const callbacks = await db
      .select({ id: jobs.id, number: jobs.number, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.callbackOfJobId, j.id))
      .orderBy(asc(jobs.createdAt));
    const answeredBy = [
      ...new Set(
        (j.checklist ?? [])
          .map((i) => i.answered_by)
          .filter((x): x is string => !!x),
      ),
    ];
    const names = answeredBy.length
      ? Object.fromEntries(
          (
            await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, answeredBy))
          ).map((u) => [u.id, u.name]),
        )
      : {};
    const custom = (j.custom ?? {}) as Record<string, unknown>;
    // Photo answers saved while offline hold the upload's client id: show the
    // media id once the upload has landed.
    const photoRefs = (j.checklist ?? [])
      .filter((i) => i.type === "photo" && isPhotoRef(i.answer))
      .map((i) => i.answer as string);
    const byClientId = photoRefs.length
      ? new Map(
          (
            await db
              .select({ id: media.id, clientId: media.clientId })
              .from(media)
              .where(
                and(eq(media.jobId, j.id), inArray(media.clientId, photoRefs)),
              )
          ).map((m) => [m.clientId as string, m.id]),
        )
      : new Map<string, string>();
    const checklist: ChecklistItemView[] = (j.checklist ?? []).map((i) => ({
      id: i.id,
      label: i.label,
      type: i.type,
      required: i.required ?? false,
      options: i.options,
      answer:
        i.type === "photo" && isPhotoRef(i.answer)
          ? (byClientId.get(i.answer) ?? i.answer)
          : (i.answer ?? null),
      answeredAt: i.answered_at ?? null,
      answeredByName: i.answered_by ? (names[i.answered_by] ?? null) : null,
      ...(i.type === "photo" ? { photoTag: checklistPhotoTag(i) } : {}),
    }));
    // Contact window (SPEC §4.2): outside it a tech sees no house number, unit,
    // pin or navigation link (QA T5-11). Same rule as the customer card.
    const revealed =
      user.perms.has("customers.contact_view") ||
      revealsJobAddress(
        user,
        j,
        assignRows.map((a) => a.userId),
      ) ||
      (await contactRevealedFor(user, j.customerId)).revealed;
    const addressShort = !revealed
      ? maskStreetLine(p.street)
      : p.unit
        ? `${p.street} ${p.unit}`
        : p.street;
    return {
      id: j.id,
      number: j.number,
      title: j.title,
      description: j.description,
      customerNotes: j.customerNotes,
      status: j.status as JobStatus,
      paymentStatus: j.paymentStatus as PaymentStatus,
      priority: j.priority as JobDetail["priority"],
      afterHours: j.afterHours,
      customerId: j.customerId,
      customerName: r.c.displayName,
      customerFirstName: r.c.firstName,
      propertyId: p.id,
      addressShort,
      addressFull: `${addressShort}, ${p.city}, ${p.state} ${p.zip}`,
      addressMasked: !revealed,
      lat: revealed ? p.lat : null,
      lng: revealed ? p.lng : null,
      serviceTypeId: j.serviceTypeId,
      serviceTypeName: r.st ?? null,
      leadId: j.leadId,
      estimateId: j.estimateId,
      windowStart: isoOrNull(j.windowStart),
      windowEnd: isoOrNull(j.windowEnd),
      scheduledStart: isoOrNull(j.scheduledStart),
      scheduledEnd: isoOrNull(j.scheduledEnd),
      confirmedAt: isoOrNull(j.confirmedAt),
      enRouteAt: isoOrNull(j.enRouteAt),
      etaAt: isoOrNull(j.etaAt),
      arrivedAt: isoOrNull(j.arrivedAt),
      startedAt: isoOrNull(j.startedAt),
      completedAt: isoOrNull(j.completedAt),
      closedAt: isoOrNull(j.closedAt),
      cancelledAt: isoOrNull(j.cancelledAt),
      cancelReason: j.cancelReason,
      cancelNote: j.cancelNote,
      cancelReviewStatus: j.cancelReviewStatus,
      isCallback: j.isCallback,
      callbackOfJobId: j.callbackOfJobId,
      callbackOfNumber: r.origNumber ?? null,
      callbackReason: j.callbackReason,
      callbacks: callbacks.map((c) => ({
        ...c,
        status: c.status as JobStatus,
      })),
      warrantyExpiresAt: isoOrNull(j.warrantyExpiresAt),
      recurrence: j.recurrence ?? null,
      visitCount: j.visitCount,
      riskScore: j.riskScore,
      riskBand: (j.riskBand as RiskBand | null) ?? null,
      readinessScore: j.readinessScore,
      settlementLockedAt: isoOrNull(j.settlementLockedAt),
      holdReason: (custom.hold_reason as string | undefined) ?? null,
      rescheduleRequestedAt:
        (custom.reschedule_requested_at as string | undefined) ?? null,
      rescheduleNote: (custom.reschedule_note as string | undefined) ?? null,
      assignees: assignRows.map((a) => ({
        userId: a.userId,
        name: a.name,
        role: a.role === "helper" ? "helper" : "primary",
        splitBps: a.splitBps,
        color: a.color,
      })),
      viewerIsAssignee: assignRows.some((a) => a.userId === user.id),
      checklist,
      custom,
      createdAt: j.createdAt.toISOString(),
      createdByName: r.createdByName ?? null,
    };
  },
);

export async function getStatusEvents(
  jobId: string,
): Promise<StatusEventView[]> {
  const rows = await db
    .select({ e: jobStatusEvents, name: users.name })
    .from(jobStatusEvents)
    .leftJoin(users, eq(users.id, jobStatusEvents.actorUserId))
    .where(eq(jobStatusEvents.jobId, jobId))
    .orderBy(desc(jobStatusEvents.at))
    .limit(100);
  return rows.map(({ e, name }) => ({
    id: e.id,
    from: e.fromStatus,
    to: e.toStatus,
    at: e.at.toISOString(),
    actorName: name ?? null,
    lat: e.lat,
    lng: e.lng,
    accuracyM: e.accuracyM,
    distanceM: e.distanceM,
    etaMinutes: e.etaMinutes,
    note: e.note,
  }));
}

export interface NoteView {
  id: string;
  body: string;
  visibility: "internal" | "customer";
  pinned: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

/** Notes for an entity (pinned first, newest first). Caller checks access. */
export async function listNotes(
  entity: EntityRef,
  limit = 50,
): Promise<NoteView[]> {
  const rows = await db
    .select({ n: notes, name: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(
      and(
        eq(notes.entityType, entity.type),
        eq(notes.entityId, entity.id),
        isNull(notes.deletedAt),
      ),
    )
    .orderBy(desc(notes.pinned), desc(notes.createdAt))
    .limit(limit);
  return rows.map(({ n, name }) => ({
    id: n.id,
    body: n.body,
    visibility: n.visibility === "customer" ? "customer" : "internal",
    pinned: n.pinned,
    authorId: n.authorId,
    authorName: name ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
}

/** S4: a customer's jobs, scoped to the viewer. */
export async function listCustomerJobs(
  customerId: string,
  viewer: SessionUser,
  limit: number,
): Promise<{ upcoming: JobListItem[]; past: JobListItem[] }> {
  const base = and(eq(jobs.customerId, customerId), jobScope(viewer));
  const sel = () =>
    db
      .select(listRowSelect)
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .innerJoin(properties, eq(properties.id, jobs.propertyId))
      .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId));
  const [up, past] = await Promise.all([
    sel()
      .where(and(base, inArray(jobs.status, [...OPEN_STATUSES])))
      .orderBy(asc(sortKey))
      .limit(limit),
    sel()
      .where(and(base, inArray(jobs.status, [...DONE_STATUSES])))
      .orderBy(desc(sortKey))
      .limit(limit),
  ]);
  const a = await assigneesFor([...up, ...past].map((r) => r.j.id));
  return {
    upcoming: up.map((r) => toListItem(r, a.get(r.j.id) ?? [], viewer)),
    past: past.map((r) => toListItem(r, a.get(r.j.id) ?? [], viewer)),
  };
}

/** S7: a user's open jobs. */
export async function listOpenJobsForUser(
  userId: string,
): Promise<JobListItem[]> {
  const rows = await db
    .select(listRowSelect)
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(and(assignedTo(userId), inArray(jobs.status, [...OPEN_STATUSES])))
    .orderBy(asc(sortKey))
    .limit(200);
  const a = await assigneesFor(rows.map((r) => r.j.id));
  return rows.map((r) => toListItem(r, a.get(r.j.id) ?? []));
}

/** The viewer's jobs for a calendar day (company TZ) plus open jobs carried over from earlier days. */
export async function listMyDay(
  user: SessionUser,
  day: string,
): Promise<{ today: JobListItem[]; carryOver: JobListItem[] }> {
  const tz = await getCompanyTimezone();
  const from = zonedTimeToUtc(parseDateKey(day), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(day, 1)), tz);
  const sel = () =>
    db
      .select(listRowSelect)
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .innerJoin(properties, eq(properties.id, jobs.propertyId))
      .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId));
  const [today, carry] = await Promise.all([
    sel()
      .where(
        and(
          assignedTo(user.id),
          ne(jobs.status, "cancelled"),
          sortGte(from),
          sortLt(to),
        ),
      )
      .orderBy(asc(sortKey)),
    sel()
      .where(
        and(
          assignedTo(user.id),
          inArray(jobs.status, ["en_route", "arrived", "in_progress"]),
          sortLt(from),
        ),
      )
      .orderBy(asc(sortKey))
      .limit(10),
  ]);
  const a = await assigneesFor([...today, ...carry].map((r) => r.j.id));
  return {
    today: today.map((r) => toListItem(r, a.get(r.j.id) ?? [], user)),
    carryOver: carry.map((r) => toListItem(r, a.get(r.j.id) ?? [], user)),
  };
}

/** Jobs the viewer left en_route / in_progress (Finish my day). */
export async function listLeftOpen(user: SessionUser): Promise<JobListItem[]> {
  const rows = await db
    .select(listRowSelect)
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(
      and(
        assignedTo(user.id),
        inArray(jobs.status, ["en_route", "arrived", "in_progress"]),
      ),
    )
    .orderBy(asc(sortKey))
    .limit(20);
  const a = await assigneesFor(rows.map((r) => r.j.id));
  return rows.map((r) => toListItem(r, a.get(r.j.id) ?? [], user));
}

/** Next scheduled job for the viewer after `jobId` today (action bar "Next job"). */
export async function nextJobAfter(
  user: SessionUser,
  jobId: string,
): Promise<{ id: string; number: string } | null> {
  const tz = await getCompanyTimezone();
  const day = dateKey(new Date(), tz);
  const { today } = await listMyDay(user, day);
  const idx = today.findIndex((j) => j.id === jobId);
  const next = today
    .slice(idx + 1)
    .find((j) => j.status !== "completed" && j.status !== "closed");
  return next ? { id: next.id, number: next.number } : null;
}

export async function requireJobsReader(): Promise<SessionUser> {
  return requireAnyPerm(["jobs.view_all", "jobs.view_own"]);
}

export { requireUser };
/** Job types for pickers, grouped by kind (./service-types.ts; no auth check). */
export { listServiceTypeOptions } from "./service-types";

/** Live job photos by tag (Complete sheet "recommended photos" row). Caller checks access. */
export async function jobPhotoCounts(
  jobId: string,
): Promise<{ before: number; after: number; total: number }> {
  const rows = await db
    .select({ tag: media.tag, n: sql<number>`count(*)::int` })
    .from(media)
    .where(
      and(
        eq(media.jobId, jobId),
        eq(media.kind, "photo"),
        isNull(media.deletedAt),
      ),
    )
    .groupBy(media.tag);
  let before = 0;
  let after = 0;
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    if (r.tag === "before") before += n;
    if (r.tag === "after") after += n;
  }
  return { before, after, total };
}
