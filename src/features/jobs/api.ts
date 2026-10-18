import "server-only";
import { and, asc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  customers,
  disputes,
  jobAssignments,
  jobs,
  leads,
  notes,
  payments,
  properties,
  serviceTypes,
  users,
} from "@/db/schema";
import { getPropertyBrief } from "@/features/customers/api";
import { markLeadConverted } from "@/features/leads/api";
import { getJobMoney } from "@/features/payments/api";
import { writeActivity } from "@/lib/activity";
import { nextNumber } from "@/lib/counters";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { addDaysToKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import type { Actor, EntityRef, SessionUser } from "@/lib/types";
import type {
  CreateJobInput,
  HistoricalJobRow,
  JobContext,
  JobStatus,
  JobView,
  PaymentStatus,
  RiskBand,
  TechDayJob,
} from "./contracts";
import {
  buildChecklist,
  insertStatusEvent,
  isoOrNull,
  jobRef,
  loadJobRow,
  normalizeAssignees,
  primaryOf,
  serviceFeeDisclosure,
} from "./internal";
import { contactWindow } from "./machine";

// B2 jobs API (BUILD_PLAN §6.2). Writes take `tx` first and `actor` last, run in the
// caller's transaction, emit their own events and write their own activity. No
// permission checks except the functions that take a viewer.

export type * from "./contracts";

const STATUS_ACTIVITY: Partial<Record<JobStatus, string>> = {
  scheduled: "Scheduled",
  confirmed: "Customer confirmed",
};

/** Number via counters('job'); snapshots cancellation policy + service-fee disclosure; checklist from the
 *  service type; status 'scheduled' when window + ≥1 assignee. Emits job.created (+ job.assigned,
 *  job.scheduled, job.callback_created). Calls B1 markLeadConverted when leadId. */
export async function createJob(
  tx: Tx,
  input: CreateJobInput,
  actor: Actor,
): Promise<{ jobId: string; number: string; status: JobStatus }> {
  if (!input.title.trim())
    throw new ValidationError({ title: ["Enter a title."] });
  // The property and the lead must belong to this customer (QA T5-09).
  const [prop] = await tx
    .select({ customerId: properties.customerId })
    .from(properties)
    .where(eq(properties.id, input.propertyId))
    .limit(1);
  if (!prop || prop.customerId !== input.customerId)
    throw new ValidationError({
      propertyId: ["Pick one of this customer's addresses."],
    });
  if (input.leadId) {
    const [l] = await tx
      .select({ customerId: leads.customerId })
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1);
    if (!l || (l.customerId && l.customerId !== input.customerId))
      throw new ValidationError({
        leadId: ["That lead belongs to another customer."],
      });
  }
  const settings = await getSettings();
  const number = await nextNumber(tx, "job");
  const assignees = normalizeAssignees(input.assignees ?? []);
  const windowStart = input.windowStart ?? input.scheduledStart ?? null;
  const windowEnd = input.windowEnd ?? input.scheduledEnd ?? null;
  if (windowStart && windowEnd && windowEnd <= windowStart)
    throw new ValidationError({
      window: ["The window must end after it starts."],
    });
  const status: JobStatus =
    windowStart && assignees.length > 0 ? "scheduled" : "unscheduled";
  const [policy, checklist] = await Promise.all([
    getCurrentPolicy("cancellation", tx).catch(() => null),
    buildChecklist(input.serviceTypeId),
  ]);
  const custom: Record<string, unknown> = { ...(input.custom ?? {}) };
  if (input.callbackOfJobId && settings.jobs.callback_no_charge)
    custom.no_charge = true;
  const [row] = await tx
    .insert(jobs)
    .values({
      number,
      customerId: input.customerId,
      propertyId: input.propertyId,
      serviceTypeId: input.serviceTypeId ?? null,
      leadId: input.leadId ?? null,
      estimateId: input.estimateId ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      customerNotes: input.customerNotes ?? null,
      priority: input.priority ?? "normal",
      afterHours: input.afterHours ?? false,
      status,
      scheduledStart: input.scheduledStart ?? windowStart,
      scheduledEnd: input.scheduledEnd ?? windowEnd,
      windowStart,
      windowEnd,
      isCallback: !!input.callbackOfJobId,
      callbackOfJobId: input.callbackOfJobId ?? null,
      callbackReason: input.callbackOfJobId
        ? (input.callbackReason ?? "other")
        : null,
      recurrence: input.recurrence ?? null,
      checklist,
      custom,
      cancellationPolicyVersionId: policy?.id ?? null,
      serviceFeeDisclosure: serviceFeeDisclosure(settings.jobs),
      createdBy: actor.userId,
    })
    .returning({ id: jobs.id });
  if (!row) throw new Error("job insert failed");
  const jobId = row.id;
  if (assignees.length) {
    await tx.insert(jobAssignments).values(
      assignees.map((a) => ({
        jobId,
        userId: a.userId,
        role: a.role,
        splitBps: a.splitBps,
        assignedBy: actor.userId,
      })),
    );
  }
  const entity = jobRef(jobId);
  const opts = { actor };
  await insertStatusEvent(tx, {
    jobId,
    from: null,
    to: status,
    actorUserId: actor.userId,
  });
  await emit(
    tx,
    "job.created",
    entity,
    {
      job_id: jobId,
      customer_id: input.customerId,
      service_type_id: input.serviceTypeId ?? null,
      priority: input.priority ?? "normal",
    },
    opts,
  );
  await writeActivity(tx, {
    entity,
    customerId: input.customerId,
    kind: "job.created",
    summary: `Job ${number} created${input.callbackOfJobId ? " (callback)" : ""}`,
    actorUserId: actor.userId,
  });
  if (assignees.length) {
    const ids = assignees.map((a) => a.userId);
    await emit(
      tx,
      "job.assigned",
      entity,
      {
        job_id: jobId,
        user_ids_added: ids,
        user_ids_removed: [],
        tech_ids: ids,
      },
      opts,
    );
    await writeActivity(tx, {
      entity,
      customerId: input.customerId,
      kind: "job.assigned",
      summary: `Assigned ${assignees.length === 1 ? "a technician" : `${assignees.length} technicians`}`,
      data: { user_ids: ids },
      actorUserId: actor.userId,
    });
  }
  if (status === "scheduled") {
    await emit(
      tx,
      "job.scheduled",
      entity,
      {
        job_id: jobId,
        scheduled_start: isoOrNull(input.scheduledStart ?? windowStart),
        window_start: isoOrNull(windowStart),
        window_end: isoOrNull(windowEnd),
        assignees: assignees.map((a) => a.userId),
      },
      opts,
    );
    await emit(
      tx,
      "job.status_changed",
      entity,
      {
        job_id: jobId,
        from: "unscheduled",
        to: "scheduled",
        tech_id: primaryOf(assignees),
        lat: null,
        lng: null,
      },
      opts,
    );
    await writeActivity(tx, {
      entity,
      customerId: input.customerId,
      kind: "job.scheduled",
      summary: "Scheduled",
      actorUserId: actor.userId,
    });
  }
  if (input.callbackOfJobId) {
    const reason = input.callbackReason ?? "other";
    await emit(
      tx,
      "job.callback_created",
      entity,
      { job_id: jobId, original_job_id: input.callbackOfJobId, reason },
      opts,
    );
    await writeActivity(tx, {
      entity: jobRef(input.callbackOfJobId),
      customerId: input.customerId,
      kind: "job.callback_created",
      summary: `Callback ${number} created (${reason})`,
      data: { callback_job_id: jobId },
      actorUserId: actor.userId,
    });
  }
  if (input.leadId) await markLeadConverted(tx, input.leadId, { jobId }, actor);
  return { jobId, number, status };
}

async function loadJobViews(where: SQL, viewerId?: string): Promise<JobView[]> {
  const rows = await db
    .select({ j: jobs, serviceTypeName: serviceTypes.name })
    .from(jobs)
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(where);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.j.id);
  const assigns = await db
    .select({
      jobId: jobAssignments.jobId,
      userId: jobAssignments.userId,
      role: jobAssignments.role,
      splitBps: jobAssignments.splitBps,
      name: users.name,
    })
    .from(jobAssignments)
    .innerJoin(users, eq(users.id, jobAssignments.userId))
    .where(inArray(jobAssignments.jobId, ids))
    .orderBy(asc(jobAssignments.assignedAt));
  return rows.map(({ j, serviceTypeName }) => {
    const a = assigns.filter((x) => x.jobId === j.id);
    return {
      id: j.id,
      number: j.number,
      status: j.status as JobStatus,
      paymentStatus: j.paymentStatus as PaymentStatus,
      customerId: j.customerId,
      propertyId: j.propertyId,
      serviceTypeId: j.serviceTypeId,
      serviceTypeName: serviceTypeName ?? null,
      leadId: j.leadId,
      estimateId: j.estimateId,
      title: j.title,
      priority: j.priority as JobView["priority"],
      afterHours: j.afterHours,
      scheduledStart: j.scheduledStart,
      scheduledEnd: j.scheduledEnd,
      windowStart: j.windowStart,
      windowEnd: j.windowEnd,
      enRouteAt: j.enRouteAt,
      arrivedAt: j.arrivedAt,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      cancelledAt: j.cancelledAt,
      riskScore: j.riskScore,
      riskBand: (j.riskBand as RiskBand | null) ?? null,
      readinessScore: j.readinessScore,
      isCallback: j.isCallback,
      callbackOfJobId: j.callbackOfJobId,
      visitCount: j.visitCount,
      settlementLockedAt: j.settlementLockedAt,
      assignees: a.map((x) => ({
        userId: x.userId,
        name: x.name,
        role: x.role === "helper" ? "helper" : "primary",
        splitBps: x.splitBps,
      })),
      viewerIsAssignee: !!viewerId && a.some((x) => x.userId === viewerId),
    };
  });
}

function canReadView(user: SessionUser, v: JobView): boolean {
  return (
    user.perms.has("jobs.view_all") ||
    (user.perms.has("jobs.view_own") && v.viewerIsAssignee)
  );
}

/** jobs.view_all, or assignee with jobs.view_own. null = not visible. */
export async function getJobForUser(
  jobId: string,
  user: SessionUser,
): Promise<JobView | null> {
  const [v] = await loadJobViews(eq(jobs.id, jobId), user.id);
  if (!v) return null;
  return canReadView(user, v) ? v : null;
}

/** 'write' = jobs.edit / jobs.status_any, or assignee with jobs.status_own. Throws Forbidden/NotFound. */
export async function assertJobAccess(
  user: SessionUser,
  jobId: string,
  mode: "read" | "write",
): Promise<JobView> {
  const [v] = await loadJobViews(eq(jobs.id, jobId), user.id);
  if (!v) throw new NotFoundError("Job");
  const canWrite =
    user.perms.has("jobs.edit") ||
    user.perms.has("jobs.status_any") ||
    (user.perms.has("jobs.status_own") && v.viewerIsAssignee);
  if (mode === "read" ? !canReadView(user, v) : !canWrite)
    throw new ForbiddenError();
  return v;
}

/** System read, no perms: handlers, templates, engines. */
export async function getJobContext(jobId: string): Promise<JobContext | null> {
  const [v] = await loadJobViews(eq(jobs.id, jobId));
  if (!v) return null;
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, v.customerId))
    .limit(1);
  if (!c) return null;
  // System read: a synthetic viewer that may see the full property (gate code included).
  const property = await getPropertyBrief(v.propertyId, {
    id: "system",
    perms: new Set([
      "customers.view",
      "customers.view_all",
      "customers.contact_view",
    ]),
    baseRole: "admin",
  } as unknown as SessionUser);
  if (!property) {
    const [p] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, v.propertyId))
      .limit(1);
    if (!p) return null;
    return {
      ...v,
      customer: customerOf(c),
      property: {
        id: p.id,
        customerId: p.customerId,
        label: p.label,
        street: p.street,
        unit: p.unit,
        city: p.city,
        state: p.state,
        zip: p.zip,
        addressShort: p.unit ? `${p.street} ${p.unit}` : p.street,
        lat: p.lat,
        lng: p.lng,
        timezone: p.timezone,
        accessNotes: p.accessNotes,
        gateCode: null,
        pets: p.pets,
        siteContactName: p.siteContactName,
        siteContactPhone: p.siteContactPhone,
      },
      primaryTechId: primaryOf(v.assignees),
    };
  }
  return {
    ...v,
    customer: customerOf(c),
    property,
    primaryTechId: primaryOf(v.assignees),
  };
}

function customerOf(c: typeof customers.$inferSelect): JobContext["customer"] {
  return {
    id: c.id,
    displayName: c.displayName,
    firstName: c.firstName,
    phone: c.phone,
    email: c.email,
    preferredChannel: c.preferredChannel,
    smsStatus: c.smsStatus,
  };
}

// ------------------------------------------------------------------ cache-column setters
// Owner-listed callers only (B4, B3, B6). They never emit events.

export async function setJobPaymentStatus(
  tx: Tx,
  jobId: string,
  status: PaymentStatus,
): Promise<void> {
  await tx
    .update(jobs)
    .set({ paymentStatus: status, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
export async function setJobRisk(
  tx: Tx,
  jobId: string,
  r: { score: number; band: RiskBand },
): Promise<void> {
  await tx
    .update(jobs)
    .set({ riskScore: r.score, riskBand: r.band, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
export async function setJobReadiness(
  tx: Tx,
  jobId: string,
  score: number,
): Promise<void> {
  await tx
    .update(jobs)
    .set({ readinessScore: score, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
export async function setJobEstimate(
  tx: Tx,
  jobId: string,
  estimateId: string,
): Promise<void> {
  await tx
    .update(jobs)
    .set({ estimateId, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
export async function lockJobsForSettlement(
  tx: Tx,
  jobIds: string[],
  settlementId: string,
  at: Date,
): Promise<void> {
  if (jobIds.length === 0) return;
  await tx
    .update(jobs)
    .set({
      settlementLockedAt: at,
      custom: sql`${jobs.custom} || ${JSON.stringify({ settlement_id: settlementId })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(inArray(jobs.id, jobIds), isNull(jobs.settlementLockedAt)));
}

/** Balance of the job's invoice (B4); falls back to the payment-status cache. */
async function jobBalanceIsZero(
  jobId: string,
  paymentStatus: string,
): Promise<boolean> {
  try {
    const m = await getJobMoney(jobId);
    if (m.invoiceId == null)
      return m.totalCents === 0 || paymentStatus === "paid";
    return m.balanceCents <= 0;
  } catch {
    return paymentStatus === "paid";
  }
}

const OPEN_DISPUTE_STATUSES = ["inquiry", "needs_response", "under_review"];

/** completed + no open dispute + invoice balance 0 + (settlement locked or force) → closed; emits job.closed. */
export async function closeJobIfEligible(
  tx: Tx,
  jobId: string,
  actor: Actor,
  opts?: { force?: boolean },
): Promise<boolean> {
  const j = await loadJobRow(tx, jobId, { lock: true });
  if (!j || j.status !== "completed") return false;
  if (!opts?.force && !j.settlementLockedAt) return false;
  // A disputed job stays open until the dispute ends (QA T6-06): closing it would
  // send a review request and hide it from the chargeback work.
  if (j.paymentStatus === "disputed") return false;
  const [openDispute] = await tx
    .select({ id: disputes.id })
    .from(disputes)
    .innerJoin(payments, eq(payments.id, disputes.paymentId))
    .where(
      and(
        eq(payments.jobId, jobId),
        inArray(disputes.status, OPEN_DISPUTE_STATUSES),
      ),
    )
    .limit(1);
  if (openDispute) return false;
  if (!(await jobBalanceIsZero(jobId, j.paymentStatus))) return false;
  const now = new Date();
  await tx
    .update(jobs)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(eq(jobs.id, jobId));
  const entity = jobRef(jobId);
  await insertStatusEvent(tx, {
    jobId,
    from: "completed",
    to: "closed",
    actorUserId: actor.userId,
    note: opts?.force ? "Closed manually" : "Closed by settlement",
  });
  await emit(
    tx,
    "job.status_changed",
    entity,
    {
      job_id: jobId,
      from: "completed",
      to: "closed",
      tech_id: null,
      lat: null,
      lng: null,
    },
    { actor },
  );
  await emit(tx, "job.closed", entity, { job_id: jobId }, { actor });
  await writeActivity(tx, {
    entity,
    customerId: j.customerId,
    kind: "job.closed",
    summary: `Job ${j.number} closed`,
    actorUserId: actor.userId,
  });
  return true;
}

/** scheduled → confirmed; emits job.confirmed (+ status_changed). Idempotent. */
export async function confirmJob(
  tx: Tx,
  jobId: string,
  via: "portal" | "reply" | "manual",
  actor: Actor,
): Promise<void> {
  const j = await loadJobRow(tx, jobId, { lock: true });
  if (!j) throw new NotFoundError("Job");
  if (j.confirmedAt && j.status !== "scheduled") return;
  if (j.status !== "scheduled" && j.status !== "confirmed") return;
  const now = new Date();
  const custom = { ...(j.custom ?? {}) };
  delete custom.reschedule_requested_at;
  delete custom.reschedule_note;
  await tx
    .update(jobs)
    .set({ status: "confirmed", confirmedAt: now, custom, updatedAt: now })
    .where(eq(jobs.id, jobId));
  const entity = jobRef(jobId);
  if (j.status === "scheduled") {
    await insertStatusEvent(tx, {
      jobId,
      from: "scheduled",
      to: "confirmed",
      actorUserId: actor.userId,
      note: `Confirmed via ${via}`,
    });
    await emit(
      tx,
      "job.status_changed",
      entity,
      {
        job_id: jobId,
        from: j.status,
        to: "confirmed",
        tech_id: null,
        lat: null,
        lng: null,
      },
      { actor },
    );
  }
  await emit(tx, "job.confirmed", entity, { job_id: jobId, via }, { actor });
  await writeActivity(tx, {
    entity,
    customerId: j.customerId,
    kind: "job.confirmed",
    summary: `${STATUS_ACTIVITY.confirmed} (${via === "reply" ? "text reply" : via})`,
    actorUserId: actor.userId,
  });
}

/** Flags the job for the office (custom.reschedule_requested_at) and emits job.reschedule_requested. */
export async function requestReschedule(
  tx: Tx,
  jobId: string,
  via: "portal" | "reply" | "manual",
  note: string | null,
  actor: Actor,
): Promise<void> {
  const j = await loadJobRow(tx, jobId, { lock: true });
  if (!j) throw new NotFoundError("Job");
  const now = new Date();
  await tx
    .update(jobs)
    .set({
      custom: {
        ...(j.custom ?? {}),
        reschedule_requested_at: now.toISOString(),
        reschedule_note: note?.slice(0, 1000) ?? null,
      },
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));
  const entity = jobRef(jobId);
  await emit(
    tx,
    "job.reschedule_requested",
    entity,
    { job_id: jobId, via, note },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: j.customerId,
    kind: "job.reschedule_requested",
    summary: `Customer asked to reschedule (${via === "reply" ? "text reply" : via})`,
    actorUserId: actor.userId,
  });
}

/** Active contact window (§4.2): scheduled_start−2h (or en_route_at) → completed_at+24h. */
export async function getContactWindowJob(
  userId: string,
  customerId: string,
  at: Date = new Date(),
): Promise<{ jobId: string; from: Date; until: Date } | null> {
  const rows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      scheduledStart: jobs.scheduledStart,
      windowStart: jobs.windowStart,
      enRouteAt: jobs.enRouteAt,
      completedAt: jobs.completedAt,
    })
    .from(jobs)
    .innerJoin(jobAssignments, eq(jobAssignments.jobId, jobs.id))
    .where(
      and(
        eq(jobs.customerId, customerId),
        eq(jobAssignments.userId, userId),
        ne(jobs.status, "cancelled"),
      ),
    );
  for (const r of rows) {
    const w = contactWindow(r);
    if (w && at >= w.from && at <= w.until)
      return { jobId: r.id, from: w.from, until: w.until };
  }
  return null;
}

/** The tech's jobs whose window/scheduled start falls on `date` (company TZ), in time order. */
export async function getTechDay(
  userId: string,
  date: string,
): Promise<TechDayJob[]> {
  const tz = await getCompanyTimezone();
  const from = zonedTimeToUtc(parseDateKey(date), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(date, 1)), tz);
  const start = sql`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;
  const rows = await db
    .select({ j: jobs, p: properties, st: serviceTypes.name })
    .from(jobs)
    .innerJoin(jobAssignments, eq(jobAssignments.jobId, jobs.id))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(
      and(
        eq(jobAssignments.userId, userId),
        ne(jobs.status, "cancelled"),
        sql`${start} >= ${from.toISOString()}::timestamptz`,
        sql`${start} < ${to.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(start));
  return rows.map(({ j, p, st }) => ({
    jobId: j.id,
    number: j.number,
    status: j.status as JobStatus,
    propertyId: p.id,
    addressShort: p.unit ? `${p.street} ${p.unit}` : p.street,
    lat: p.lat,
    lng: p.lng,
    serviceTypeName: st ?? null,
    windowStart: j.windowStart,
    arrivedAt: j.arrivedAt,
    completedAt: j.completedAt,
  }));
}

/** Insert a note (idempotent on clientId) + activity 'note.added'. */
export async function addNote(
  tx: Tx,
  input: {
    entity: EntityRef;
    customerId?: string | null;
    jobId?: string | null;
    body: string;
    visibility?: "internal" | "customer";
    pinned?: boolean;
    clientId?: string | null;
  },
  actor: Actor,
): Promise<{ noteId: string }> {
  const body = input.body.trim();
  if (!body) throw new ValidationError({ body: ["Write a note."] });
  if (input.clientId) {
    const [existing] = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.clientId, input.clientId))
      .limit(1);
    if (existing) return { noteId: existing.id };
  }
  const [row] = await tx
    .insert(notes)
    .values({
      entityType: input.entity.type,
      entityId: input.entity.id,
      customerId: input.customerId ?? null,
      jobId:
        input.jobId ?? (input.entity.type === "job" ? input.entity.id : null),
      body: body.slice(0, 5000),
      visibility: input.visibility ?? "internal",
      pinned: input.pinned ?? false,
      authorId: actor.userId,
      clientId: input.clientId ?? null,
    })
    .returning({ id: notes.id });
  if (!row) throw new Error("note insert failed");
  await writeActivity(tx, {
    entity: input.entity,
    customerId: input.customerId ?? null,
    jobId: input.jobId ?? null,
    kind: "note.added",
    summary:
      input.visibility === "customer"
        ? "Customer-visible note added"
        : "Note added",
    data: { note_id: row.id },
    actorUserId: actor.userId,
  });
  return { noteId: row.id };
}

/** Creates status 'closed' jobs with custom.imported_total_cents (LTV/history only; no invoices,
 *  no events). Dedupes on custom.external_ref. */
export async function importHistoricalJobs(
  tx: Tx,
  rows: HistoricalJobRow[],
  actor: Actor,
): Promise<{
  created: number;
  skipped: number;
  errors: { row: number; error: string }[];
}> {
  const tz = await getCompanyTimezone();
  let created = 0;
  let skipped = 0;
  const errors: { row: number; error: string }[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      if (!r.customerId || !r.propertyId)
        throw new Error("customer and property are required");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.completedOn))
        throw new Error("completedOn must be YYYY-MM-DD");
      if (!Number.isInteger(r.totalCents) || r.totalCents < 0)
        throw new Error("totalCents must be a non-negative integer");
      if (r.externalRef) {
        const [dup] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(sql`${jobs.custom}->>'external_ref' = ${r.externalRef}`)
          .limit(1);
        if (dup) {
          skipped++;
          continue;
        }
      }
      const at = zonedTimeToUtc(
        { ...parseDateKey(r.completedOn), hour: 12 },
        tz,
      );
      const number = await nextNumber(tx, "job");
      const [job] = await tx
        .insert(jobs)
        .values({
          number,
          customerId: r.customerId,
          propertyId: r.propertyId,
          title: (r.serviceText || "Imported job").slice(0, 200),
          status: "closed",
          paymentStatus: "paid",
          windowStart: at,
          windowEnd: new Date(at.getTime() + 3600_000),
          scheduledStart: at,
          scheduledEnd: new Date(at.getTime() + 3600_000),
          completedAt: at,
          closedAt: at,
          custom: {
            imported: true,
            imported_total_cents: r.totalCents,
            ...(r.externalRef ? { external_ref: r.externalRef } : {}),
          },
          createdBy: actor.userId,
        })
        .returning({ id: jobs.id });
      if (!job) throw new Error("insert failed");
      if (r.techUserId)
        await tx.insert(jobAssignments).values({
          jobId: job.id,
          userId: r.techUserId,
          role: "primary",
          splitBps: 10000,
          assignedBy: actor.userId,
        });
      if (r.notes?.trim())
        await tx.insert(notes).values({
          entityType: "job",
          entityId: job.id,
          customerId: r.customerId,
          jobId: job.id,
          body: r.notes.trim().slice(0, 5000),
          authorId: actor.userId,
        });
      await writeActivity(tx, {
        entity: jobRef(job.id),
        customerId: r.customerId,
        kind: "job.imported",
        summary: `Imported past job ${number}`,
        actorUserId: actor.userId,
      });
      created++;
    } catch (e) {
      errors.push({ row: i + 1, error: (e as Error).message });
    }
  }
  return { created, skipped, errors };
}
