"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { JOB_CANCEL_REASONS } from "@/db/enums";
import { jobs, leads, media, notes } from "@/db/schema";
import { createApproval, getApprovalFor } from "@/features/approvals/api";
import { assertCustomerAccess, logCall } from "@/features/customers/api";
import { getJobRisk } from "@/features/disputes/api";
import {
  addJobLine,
  getInvoiceForJob,
  listJobLines,
} from "@/features/invoices/api";
import { LEAD_QUOTE_LINE_DESCRIPTION } from "@/features/invoices/lead-quote";
import { validateCustomValues } from "@/features/settings/api";
import { captureSignature } from "@/features/signatures/api";
import type { SignatureSubmit } from "@/features/signatures/contracts";
import { action } from "@/lib/action";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Perm } from "@/lib/permissions";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import type { ActionResult, SessionUser } from "@/lib/types";
import {
  addNote,
  assertJobAccess,
  closeJobIfEligible,
  confirmJob,
  createJob,
} from "./api";
import { isPhotoRef } from "./checklist";
import { buildChecklist, jobRef, loadJobRow } from "./internal";
import { buildWindow, isOpenStatus } from "./machine";
import { applyTransition, scheduleAndAssign } from "./transition";
import type { TransitionResult } from "./types";

// Mutations for jobs (SPEC §8.2): every write goes through action() — auth, zod,
// clientId idempotency, one transaction (write + events + audit + activity), then
// revalidatePath + refresh().

const uuid = z.string().uuid();
const optText = (max = 5000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );
const zGeo = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().nullable().optional(),
    at: z.string().optional(),
  })
  .nullable()
  .optional();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const zTime = z.string().regex(/^\d{1,2}:\d{2}$/, "Pick a time.");
const zAssignees = z
  .array(
    z.object({
      userId: uuid,
      role: z.enum(["primary", "helper"]),
      splitBps: z.number().int().min(0).max(10000),
    }),
  )
  .max(6);

const jobPaths = (id: string) => [
  `/jobs/${id}`,
  "/jobs",
  "/today",
  "/schedule",
];

async function windowFrom(
  date: string | null | undefined,
  start: string | null | undefined,
  minutes: number | null | undefined,
): Promise<{ start: Date; end: Date } | null> {
  if (!date || !start) return null;
  const tz = await getCompanyTimezone();
  return buildWindow(
    date,
    start,
    minutes ?? (await getSettings()).jobs.default_window_min,
    tz,
  );
}

// ------------------------------------------------------------------ create / edit

const CreateJobSchema = z.object({
  customerId: uuid,
  propertyId: uuid,
  serviceTypeId: uuid.nullable().optional(),
  title: z.string().trim().min(1, "Enter a title.").max(200),
  description: optText(),
  customerNotes: optText(),
  priority: z.enum(["normal", "urgent", "emergency"]).default("normal"),
  afterHours: z.boolean().default(false),
  date: zDate.nullable().optional(),
  start: zTime.nullable().optional(),
  minutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .nullable()
    .optional(),
  assignees: zAssignees.default([]),
  recurrence: z
    .object({
      every: z.enum(["weeks", "months"]),
      n: z.number().int().min(1).max(24),
      until: zDate.optional(),
    })
    .nullable()
    .optional(),
  callbackOfJobId: uuid.nullable().optional(),
  callbackReason: z
    .enum(["workmanship", "part", "customer", "other"])
    .nullable()
    .optional(),
  leadId: uuid.nullable().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  clientId: uuid.optional(),
});

export const createJobAction = action({
  perm: "jobs.create",
  input: CreateJobSchema,
  audit: "job.created",
  async run({ input, tx, user, actor }) {
    await assertCustomerAccess(user, input.customerId, "read");
    // Booking from a lead marks it converted: that needs leads.convert (QA T5-09).
    if (input.leadId && !user.perms.has("leads.convert"))
      throw new ForbiddenError(undefined, "leads.convert");
    let assignees = input.assignees;
    if (!user.perms.has("jobs.assign")) {
      // Techs creating a job on site may only assign themselves.
      if (assignees.some((a) => a.userId !== user.id))
        throw new ForbiddenError("You can only assign yourself.");
      if (input.date && assignees.length === 0)
        assignees = [{ userId: user.id, role: "primary", splitBps: 10000 }];
    }
    if (input.callbackOfJobId)
      await assertJobAccess(user, input.callbackOfJobId, "read");
    const win = await windowFrom(input.date, input.start, input.minutes);
    let custom = input.custom ?? {};
    if (Object.keys(custom).length) {
      const v = await validateCustomValues(
        "job",
        custom,
        input.serviceTypeId ?? null,
      );
      if (!v.ok)
        throw new ValidationError(
          Object.fromEntries(
            Object.entries(v.fieldErrors).map(([k, e]) => [`custom.${k}`, e]),
          ),
        );
      custom = v.values;
    }
    const created = await createJob(
      tx,
      {
        customerId: input.customerId,
        propertyId: input.propertyId,
        serviceTypeId: input.serviceTypeId ?? null,
        title: input.title,
        description: input.description ?? null,
        customerNotes: input.customerNotes ?? null,
        priority: input.priority,
        afterHours: input.afterHours,
        leadId: input.leadId ?? null,
        windowStart: win?.start ?? null,
        windowEnd: win?.end ?? null,
        assignees,
        callbackOfJobId: input.callbackOfJobId ?? null,
        callbackReason: input.callbackReason ?? null,
        recurrence: input.recurrence ?? null,
        custom,
      },
      actor,
    );
    // The price quoted on the lead becomes the draft invoice's first line, so it
    // isn't lost on conversion (QA T2-12). Read from the lead, never the form.
    if (input.leadId) {
      const [l] = await tx
        .select({
          quotedPriceCents: leads.quotedPriceCents,
          serviceText: leads.serviceText,
        })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);
      if (l?.quotedPriceCents && l.quotedPriceCents > 0)
        await addJobLine(
          tx,
          created.jobId,
          {
            type: "service",
            name: (l.serviceText?.trim() || input.title).slice(0, 200),
            // Marks the placeholder an approved estimate replaces (invoices/lead-quote).
            description: LEAD_QUOTE_LINE_DESCRIPTION,
            qty: 1,
            unitPriceCents: l.quotedPriceCents,
            taxable: false,
          },
          actor,
        );
    }
    return created;
  },
  auditEntity: ({ data }) => jobRef(data.jobId),
  revalidate: ({ data }) => [...jobPaths(data.jobId)],
});

const UpdateJobSchema = z.object({
  jobId: uuid,
  title: z.string().trim().min(1, "Enter a title.").max(200),
  description: optText(),
  customerNotes: optText(),
  priority: z.enum(["normal", "urgent", "emergency"]),
  afterHours: z.boolean(),
  serviceTypeId: uuid.nullable().optional(),
  recurrence: CreateJobSchema.shape.recurrence,
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const updateJobDetails = action({
  perm: "jobs.edit",
  input: UpdateJobSchema,
  name: "job.updated",
  async run({ input, tx, audit, activity }) {
    const j = await loadJobRow(tx, input.jobId, { lock: true });
    if (!j) throw new NotFoundError("Job");
    if (j.status === "closed")
      throw new ConflictError(
        "job_closed",
        "Closed jobs are read-only. Reopen it first.",
      );
    let custom = { ...(j.custom ?? {}) };
    if (input.custom) {
      const v = await validateCustomValues(
        "job",
        input.custom,
        input.serviceTypeId ?? j.serviceTypeId,
      );
      if (!v.ok)
        throw new ValidationError(
          Object.fromEntries(
            Object.entries(v.fieldErrors).map(([k, e]) => [`custom.${k}`, e]),
          ),
        );
      custom = { ...custom, ...v.values };
    }
    const serviceTypeId =
      input.serviceTypeId === undefined ? j.serviceTypeId : input.serviceTypeId;
    let checklist = j.checklist;
    if (
      serviceTypeId !== j.serviceTypeId &&
      !(j.checklist ?? []).some((i) => i.answer != null)
    )
      checklist = await buildChecklist(serviceTypeId);
    const next = {
      title: input.title,
      description: input.description ?? null,
      customerNotes: input.customerNotes ?? null,
      priority: input.priority,
      afterHours: input.afterHours,
      serviceTypeId,
      recurrence: input.recurrence ?? null,
    };
    await tx
      .update(jobs)
      .set({ ...next, checklist, custom, updatedAt: new Date() })
      .where(eq(jobs.id, j.id));
    await audit({
      action: "job.updated",
      entity: jobRef(j.id),
      before: {
        title: j.title,
        description: j.description,
        customerNotes: j.customerNotes,
        priority: j.priority,
        afterHours: j.afterHours,
        serviceTypeId: j.serviceTypeId,
        recurrence: j.recurrence,
      },
      after: next,
    });
    await activity({
      entity: jobRef(j.id),
      customerId: j.customerId,
      kind: "job.updated",
      summary: "Job details updated",
    });
    return { jobId: j.id };
  },
  revalidate: ({ data }) => jobPaths(data.jobId),
});

// ------------------------------------------------------------------ dispatch

const ScheduleSchema = z.object({
  jobId: uuid,
  date: zDate.nullable().optional(),
  start: zTime.nullable().optional(),
  minutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .nullable()
    .optional(),
  /** Clear the window (→ unscheduled). */
  unschedule: z.boolean().optional(),
  assignees: zAssignees.optional(),
  clientId: uuid.optional(),
});

/** Assign / reassign and (re)schedule (S9 sheet, reschedule sheet, schedule-board drag). */
export const scheduleJob = action({
  anyPerm: ["jobs.assign", "jobs.reschedule"],
  input: ScheduleSchema,
  audit: "job.dispatched",
  async run({ input, tx, user, actor }) {
    const touchesWindow = input.unschedule || !!input.date;
    if (input.assignees && !user.perms.has("jobs.assign"))
      throw new ForbiddenError(undefined, "jobs.assign");
    if (touchesWindow && !user.perms.has("jobs.reschedule"))
      throw new ForbiddenError(undefined, "jobs.reschedule");
    const window = input.unschedule
      ? null
      : input.date
        ? await windowFrom(input.date, input.start ?? "09:00", input.minutes)
        : undefined;
    return scheduleAndAssign(tx, {
      jobId: input.jobId,
      window,
      assignees: input.assignees,
      actor,
    });
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => jobPaths(input.jobId),
});

// ------------------------------------------------------------------ status machine

const StatusSchema = z.object({
  jobId: uuid,
  to: z.enum([
    "scheduled",
    "confirmed",
    "en_route",
    "arrived",
    "in_progress",
    "on_hold",
    "completed",
    "cancelled",
  ]),
  geo: zGeo,
  etaMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullable()
    .optional(),
  reason: optText(100),
  note: optText(2000),
  overrideReason: optText(500),
  photoClientIds: z.array(uuid).max(20).optional(),
  waiveFee: z.boolean().optional(),
  date: zDate.nullable().optional(),
  start: zTime.nullable().optional(),
  minutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .nullable()
    .optional(),
  clientId: uuid.optional(),
  clientTs: z.string().optional(),
});

/** Every tech-flow transition (offline-capable: 'jobs.setStatus'). */
export const setJobStatus = action({
  anyPerm: [
    "jobs.status_own",
    "jobs.status_any",
    "jobs.cancel",
    "jobs.cancel_after_arrival",
    "jobs.reopen",
  ],
  input: StatusSchema,
  name: "job.status",
  async run({ input, tx, user, actor, audit }): Promise<TransitionResult> {
    await assertJobAccess(user, input.jobId, "read");
    if (
      input.to === "cancelled" &&
      input.reason &&
      !(JOB_CANCEL_REASONS as readonly string[]).includes(input.reason)
    )
      throw new ValidationError({ reason: ["Pick a cancellation reason."] });
    const newWindow =
      input.to === "scheduled"
        ? await windowFrom(input.date, input.start, input.minutes)
        : null;
    const clientTs = input.clientTs ? new Date(input.clientTs) : null;
    const res = await applyTransition(tx, {
      jobId: input.jobId,
      to: input.to,
      actor,
      user,
      geo: input.geo ?? null,
      clientId: input.clientId ?? null,
      clientTs: clientTs && !Number.isNaN(clientTs.getTime()) ? clientTs : null,
      etaMinutes: input.etaMinutes ?? null,
      reason: input.reason ?? null,
      note: input.note ?? null,
      overrideReason: input.overrideReason ?? null,
      photoClientIds: input.photoClientIds,
      newWindow,
      waiveFee: input.waiveFee,
    });
    if (res.status === "done" && res.from !== res.to)
      await audit({
        action: `job.${input.to}`,
        entity: jobRef(input.jobId),
        before: { status: res.from },
        after: {
          status: res.to,
          reason: input.reason ?? null,
          override: input.overrideReason ?? null,
        },
      });
    return res;
  },
  revalidate: ({ input }) => jobPaths(input.jobId),
});

/** Running late: new ETA (15/30/45/60) → job.running_late (the customer text is the automation's). */
export const markRunningLate = action({
  anyPerm: ["jobs.status_own", "jobs.status_any"],
  input: z.object({
    jobId: uuid,
    etaMinutes: z.number().int().min(5).max(240),
    clientId: uuid.optional(),
  }),
  audit: "job.running_late",
  async run({ input, tx, user, emit, activity }) {
    const view = await assertJobAccess(user, input.jobId, "write");
    if (!["scheduled", "confirmed", "en_route"].includes(view.status))
      throw new ConflictError(
        "not_en_route",
        "Running late only applies before you arrive.",
      );
    const now = new Date();
    await tx
      .update(jobs)
      .set({
        etaAt: new Date(now.getTime() + input.etaMinutes * 60_000),
        updatedAt: now,
      })
      .where(eq(jobs.id, input.jobId));
    const techId = view.viewerIsAssignee
      ? user.id
      : (view.assignees.find((a) => a.role === "primary")?.userId ?? user.id);
    await emit("job.running_late", jobRef(input.jobId), {
      job_id: input.jobId,
      tech_id: techId,
      new_eta_minutes: input.etaMinutes,
    });
    await activity({
      entity: jobRef(input.jobId),
      customerId: view.customerId,
      kind: "job.running_late",
      summary: `Running late — new ETA ${input.etaMinutes} min`,
    });
    return { jobId: input.jobId };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => jobPaths(input.jobId),
});

/** Critical-risk start: ask jobs.approve_start holders (approvals row job_start). */
export const requestStartApproval = action({
  anyPerm: ["jobs.status_own", "jobs.status_any"],
  input: z.object({
    jobId: uuid,
    note: optText(1000),
    clientId: uuid.optional(),
  }),
  audit: "job.start_approval_requested",
  async run({ input, tx, user, actor, emit, activity }) {
    const view = await assertJobAccess(user, input.jobId, "write");
    if (
      !["arrived", "en_route", "scheduled", "confirmed"].includes(view.status)
    )
      throw new ConflictError("bad_status", "The job has already started.");
    const existing = await getApprovalFor("job_start", input.jobId);
    if (existing?.status === "approved")
      return { approvalId: existing.id, status: "approved" as const };
    const risk = await getJobRisk(input.jobId).catch(() => null);
    const { approvalId } = await createApproval(
      tx,
      {
        entityType: "job_start",
        entityId: input.jobId,
        policy: "always_review",
        requestedBy: user.id,
        evidence: {
          job_number: view.number,
          risk_score: risk?.score ?? view.riskScore,
          risk_band: risk?.band ?? view.riskBand,
          signals: risk?.signals ?? [],
          note: input.note ?? null,
        },
      },
      actor,
    );
    if (existing?.id !== approvalId) {
      await emit("job.start_approval_requested", jobRef(input.jobId), {
        job_id: input.jobId,
        approval_id: approvalId,
      });
      await activity({
        entity: jobRef(input.jobId),
        customerId: view.customerId,
        kind: "job.start_approval_requested",
        summary: "Asked an admin for approval to start (Critical risk)",
      });
    }
    return { approvalId, status: "pending" as const };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => jobPaths(input.jobId),
});

/** Office marks a customer's reply ("C") as a confirmation. */
export const confirmJobManual = action({
  anyPerm: ["jobs.edit", "jobs.status_any"],
  input: z.object({ jobId: uuid }),
  audit: "job.confirmed",
  async run({ input, tx, actor }) {
    await confirmJob(tx, input.jobId, "manual", actor);
    return { jobId: input.jobId };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => [...jobPaths(input.jobId), "/insights"],
});

/** Admin manual close (completed + balance 0). */
export const closeJobManual = action({
  perm: "jobs.reopen",
  input: z.object({ jobId: uuid }),
  audit: "job.closed",
  async run({ input, tx, actor }) {
    const closed = await closeJobIfEligible(tx, input.jobId, actor, {
      force: true,
    });
    if (!closed)
      throw new ConflictError(
        "not_closable",
        "Only completed jobs with a zero balance can be closed.",
      );
    return { jobId: input.jobId };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => jobPaths(input.jobId),
});

// ------------------------------------------------------------------ checklist

export const updateChecklistItem = action({
  anyPerm: ["jobs.status_own", "jobs.status_any", "jobs.edit"],
  input: z.object({
    jobId: uuid,
    itemId: z.string().min(1).max(100),
    answer: z.union([
      z.boolean(),
      z.string().max(2000),
      z.number(),
      z.array(z.string().max(200)).max(20),
      z.null(),
    ]),
    clientId: uuid.optional(),
    clientTs: z.string().optional(),
  }),
  audit: "job.checklist_updated",
  async run({ input, tx, user }) {
    await assertJobAccess(user, input.jobId, "write");
    const j = await loadJobRow(tx, input.jobId, { lock: true });
    if (!j) throw new NotFoundError("Job");
    if (!isOpenStatus(j.status) && j.status !== "completed")
      throw new ConflictError("job_done", "This job is closed.");
    const items = j.checklist ?? [];
    const item = items.find((i) => i.id === input.itemId);
    if (!item) throw new NotFoundError("Checklist item");
    if (
      item.type === "number" &&
      input.answer !== null &&
      Number.isNaN(Number(input.answer))
    )
      throw new ValidationError({ answer: ["Enter a number."] });
    if (
      item.type === "select" &&
      typeof input.answer === "string" &&
      item.options &&
      !item.options.includes(input.answer)
    )
      throw new ValidationError({ answer: ["Pick one of the options."] });
    let answer = input.answer;
    if (item.type === "photo" && answer !== null) {
      // A photo answer is this job's media id. Until an offline upload lands it is
      // the upload's client id (resolved on read); another job's photo is refused.
      if (!isPhotoRef(answer))
        throw new ValidationError({ answer: ["Take the photo first."] });
      const ref = answer;
      const [m] = await tx
        .select({ id: media.id, jobId: media.jobId })
        .from(media)
        .where(or(eq(media.id, ref), eq(media.clientId, ref)))
        .limit(1);
      if (m && m.jobId !== j.id)
        throw new ValidationError({
          answer: ["That photo belongs to another job."],
        });
      if (m) answer = m.id;
    }
    const now = new Date().toISOString();
    const next = items.map((i) =>
      i.id === input.itemId
        ? {
            ...i,
            answer,
            answered_at: answer == null ? undefined : now,
            answered_by: answer == null ? undefined : user.id,
          }
        : i,
    );
    await tx
      .update(jobs)
      .set({ checklist: next, updatedAt: new Date() })
      .where(eq(jobs.id, j.id));
    return { jobId: j.id, itemId: input.itemId };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => [`/jobs/${input.jobId}`],
});

// ------------------------------------------------------------------ signatures (S15 consumer actions)

const SignatureSchema = z.object({
  jobId: uuid,
  itemId: z.string().max(100).optional(),
  signerName: z.string().trim().min(1, "Enter the signer's name.").max(120),
  esignConsent: z.literal(true),
  signatureMediaId: uuid,
  geo: zGeo,
  deviceTs: z.string(),
  clientId: uuid,
});

const signCompletionAction = action({
  anyPerm: ["jobs.status_own", "jobs.status_any"],
  input: SignatureSchema,
  audit: "job.completion_signed",
  async run({ input, tx, user, actor }) {
    const view = await assertJobAccess(user, input.jobId, "write");
    const j = await loadJobRow(tx, input.jobId, { lock: true });
    if (!j) throw new NotFoundError("Job");
    const [lines, inv] = await Promise.all([
      listJobLines(input.jobId).catch(() => []),
      getInvoiceForJob(input.jobId).catch(() => null),
    ]);
    const deviceTs = new Date(input.deviceTs);
    const policy = await getCurrentPolicy("esign_consent").catch(() => null);
    const { signatureId } = await captureSignature(
      tx,
      {
        docType: "completion",
        docId: input.jobId,
        docSnapshot: {
          job: { id: j.id, number: j.number, title: j.title, status: j.status },
          customer_id: j.customerId,
          lines: lines.map((l) => ({
            name: l.name,
            qty: l.qty,
            total_cents: l.totalCents,
          })),
          // What the customer saw on the sign-off sheet (QA T1-18).
          total_cents:
            inv?.totalCents ?? lines.reduce((a, l) => a + l.totalCents, 0),
          statement: "The work described was completed to my satisfaction.",
        },
        policyVersionIds: policy ? [policy.id] : [],
        signerName: input.signerName,
        signerKind: "customer",
        customerId: view.customerId,
        signatureMediaId: input.signatureMediaId,
        channel: "in_person",
        esignConsent: true,
        consentText: policy?.body ?? null,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        geo: input.geo ?? null,
        deviceTs: Number.isNaN(deviceTs.getTime()) ? null : deviceTs,
      },
      actor,
    );
    await tx
      .update(jobs)
      .set({
        custom: { ...(j.custom ?? {}), completion_signature_id: signatureId },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, j.id));
    return { signatureId };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => [`/jobs/${input.jobId}`],
});

/** S15 `action` for the completion signature (bind the job id on the server). */
export async function signJobCompletion(
  jobId: string,
  input: SignatureSubmit,
): Promise<ActionResult<{ signatureId: string }>> {
  return signCompletionAction({ ...input, jobId });
}

const signChecklistAction = action({
  anyPerm: ["jobs.status_own", "jobs.status_any"],
  input: SignatureSchema.extend({ itemId: z.string().min(1).max(100) }),
  audit: "job.checklist_signed",
  async run({ input, tx, user, actor }) {
    const view = await assertJobAccess(user, input.jobId, "write");
    const j = await loadJobRow(tx, input.jobId, { lock: true });
    if (!j) throw new NotFoundError("Job");
    const item = (j.checklist ?? []).find((i) => i.id === input.itemId);
    if (!item || item.type !== "signature")
      throw new NotFoundError("Checklist item");
    const deviceTs = new Date(input.deviceTs);
    const { signatureId } = await captureSignature(
      tx,
      {
        docType: "ownership",
        docId: input.jobId,
        docSnapshot: {
          job: { id: j.id, number: j.number },
          item: { id: item.id, label: item.label },
          statement: item.label,
        },
        signerName: input.signerName,
        signerKind: "customer",
        customerId: view.customerId,
        signatureMediaId: input.signatureMediaId,
        channel: "in_person",
        esignConsent: true,
        geo: input.geo ?? null,
        deviceTs: Number.isNaN(deviceTs.getTime()) ? null : deviceTs,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      actor,
    );
    const now = new Date().toISOString();
    await tx
      .update(jobs)
      .set({
        checklist: (j.checklist ?? []).map((i) =>
          i.id === item.id
            ? {
                ...i,
                answer: signatureId,
                answered_at: now,
                answered_by: user.id,
              }
            : i,
        ),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, j.id));
    return { signatureId };
  },
  auditEntity: ({ input }) => jobRef(input.jobId),
  revalidate: ({ input }) => [`/jobs/${input.jobId}`],
});

/** S15 `action` for a checklist signature item (ownership "authority" signature). */
export async function signChecklistItem(
  jobId: string,
  itemId: string,
  input: SignatureSubmit,
): Promise<ActionResult<{ signatureId: string }>> {
  return signChecklistAction({ ...input, jobId, itemId });
}

// ------------------------------------------------------------------ calls

/** Action-bar Call: log it (B1 logCall), then the client opens tel:. */
export const logJobCall = action({
  anyPerm: ["jobs.status_own", "jobs.status_any", "jobs.edit"],
  input: z.object({
    jobId: uuid,
    outcome: z
      .enum(["connected", "no_answer", "voicemail", "wrong_number", "busy"])
      .default("connected"),
    clientId: uuid.optional(),
  }),
  name: "job.call",
  async run({ input, tx, user, actor }) {
    const view = await assertJobAccess(user, input.jobId, "read");
    await logCall(
      tx,
      {
        customerId: view.customerId,
        jobId: input.jobId,
        userId: user.id,
        direction: "out",
        outcome: input.outcome,
      },
      actor,
    );
    return { jobId: input.jobId };
  },
});

// ------------------------------------------------------------------ notes (S5)

async function assertNoteAccess(
  user: SessionUser,
  entityType: string,
  entityId: string,
  mode: "read" | "write",
): Promise<{ customerId: string | null; jobId: string | null }> {
  if (entityType === "job") {
    const v = await assertJobAccess(user, entityId, "read");
    return { customerId: v.customerId, jobId: v.id };
  }
  if (entityType === "customer") {
    if (!user.perms.has("customers.view"))
      throw new ForbiddenError(undefined, "customers.view");
    await assertCustomerAccess(user, entityId, "read");
    return { customerId: entityId, jobId: null };
  }
  if (entityType === "lead") {
    const need: Perm = "leads.view";
    if (!user.perms.has(need)) throw new ForbiddenError(undefined, need);
    void mode;
    return { customerId: null, jobId: null };
  }
  throw new ForbiddenError();
}

export const addEntityNote = action({
  input: z.object({
    entityType: z.enum(["job", "customer", "lead"]),
    entityId: uuid,
    body: z.string().trim().min(1, "Write a note.").max(5000),
    visibility: z.enum(["internal", "customer"]).default("internal"),
    pinned: z.boolean().optional(),
    clientId: uuid.optional(),
    clientTs: z.string().optional(),
  }),
  audit: "note.added",
  async run({ input, tx, user, actor }) {
    const scope = await assertNoteAccess(
      user,
      input.entityType,
      input.entityId,
      "write",
    );
    return addNote(
      tx,
      {
        entity: { type: input.entityType, id: input.entityId },
        customerId: scope.customerId,
        jobId: scope.jobId,
        body: input.body,
        visibility: input.visibility,
        pinned: input.pinned ?? false,
        clientId: input.clientId ?? null,
      },
      actor,
    );
  },
  auditEntity: ({ input }) => ({ type: input.entityType, id: input.entityId }),
  revalidate: ({ input }) => [
    `/${input.entityType === "job" ? "jobs" : input.entityType === "customer" ? "customers" : "leads"}/${input.entityId}`,
  ],
});

async function loadNoteForEdit(user: SessionUser, noteId: string) {
  const [n] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .limit(1);
  if (!n) throw new NotFoundError("Note");
  await assertNoteAccess(user, n.entityType, n.entityId, "write");
  const editor =
    n.authorId === user.id ||
    (n.entityType === "job" && user.perms.has("jobs.edit")) ||
    (n.entityType === "customer" && user.perms.has("customers.edit")) ||
    (n.entityType === "lead" && user.perms.has("leads.edit"));
  if (!editor)
    throw new ForbiddenError("Only the author can change this note.");
  return n;
}

const notePath = (t: string, id: string) =>
  `/${t === "job" ? "jobs" : t === "customer" ? "customers" : "leads"}/${id}`;

export const setNotePinned = action({
  input: z.object({ noteId: uuid, pinned: z.boolean() }),
  audit: "note.pinned",
  async run({ input, tx, user }) {
    const n = await loadNoteForEdit(user, input.noteId);
    await tx
      .update(notes)
      .set({ pinned: input.pinned, updatedAt: new Date() })
      .where(eq(notes.id, n.id));
    return {
      path: notePath(n.entityType, n.entityId),
      entity: { type: n.entityType as "job", id: n.entityId },
    };
  },
  auditEntity: ({ data }) => data.entity,
  revalidate: ({ data }) => [data.path],
});

export const deleteNote = action({
  input: z.object({ noteId: uuid }),
  audit: "note.deleted",
  async run({ input, tx, user, activity }) {
    const n = await loadNoteForEdit(user, input.noteId);
    await tx
      .update(notes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(notes.id, n.id));
    await activity({
      entity: { type: n.entityType as "job", id: n.entityId },
      customerId: n.customerId,
      jobId: n.jobId,
      kind: "note.deleted",
      summary: "Note deleted",
    });
    return {
      path: notePath(n.entityType, n.entityId),
      entity: { type: n.entityType as "job", id: n.entityId },
    };
  },
  auditEntity: ({ data }) => data.entity,
  revalidate: ({ data }) => [data.path],
});

// ------------------------------------------------------------------ settings (/settings/jobs)

export const saveJobSettings = action({
  perm: "settings.manage",
  input: z.object({
    arrival_radius_m: z.number().int().min(50).max(5000),
    window_lengths_min: z
      .array(z.number().int().min(15).max(720))
      .min(1)
      .max(6),
    default_window_min: z.number().int().min(15).max(720),
    unconfirmed_flag_time: zTime,
    late_cancel_hours: z.number().int().min(0).max(168),
    late_cancel_fee_cents: z.number().int().min(0).max(1_000_000),
    no_show_fee_cents: z.number().int().min(0).max(1_000_000),
    service_call_fee_cents: z.number().int().min(0).max(1_000_000).nullable(),
    service_call_fee_credited: z.boolean(),
    callback_no_charge: z.boolean(),
    warranty_claim_due_days: z.number().int().min(1).max(365),
    board_start_hour: z.number().int().min(0).max(23),
    board_end_hour: z.number().int().min(1).max(24),
    job_prefix: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only."),
    // Booking availability (leads-flow redesign). Optional: kept when absent.
    daily_job_cap: z
      .number()
      .int()
      .min(1, "At least 1 job a day.")
      .max(30, "30 jobs a day at most.")
      .optional(),
    max_extra_miles: z
      .number()
      .int()
      .min(1, "At least 1 mile.")
      .max(500, "500 miles at most.")
      .optional(),
    after_hours_booking: z.boolean().optional(),
  }),
  name: "settings.jobs",
  async run({ input, tx, actor }) {
    if (input.board_end_hour <= input.board_start_hour)
      throw new ValidationError({
        board_end_hour: ["End after the start hour."],
      });
    const { updateSettings } = await import("@/lib/settings");
    const lengths = [...new Set(input.window_lengths_min)].sort(
      (a, b) => a - b,
    );
    await updateSettings(
      tx,
      {
        jobs: {
          arrival_radius_m: input.arrival_radius_m,
          window_lengths_min: lengths,
          default_window_min: lengths.includes(input.default_window_min)
            ? input.default_window_min
            : (lengths[0] ?? 60),
          unconfirmed_flag_time: input.unconfirmed_flag_time,
          cancellation_policy: {
            late_cancel_hours: input.late_cancel_hours,
            late_cancel_fee_cents: input.late_cancel_fee_cents,
            no_show_fee_cents: input.no_show_fee_cents,
          },
          service_call_fee_cents: input.service_call_fee_cents || null,
          service_call_fee_credited: input.service_call_fee_credited,
          callback_no_charge: input.callback_no_charge,
          warranty_claim_due_days: input.warranty_claim_due_days,
          board_start_hour: input.board_start_hour,
          board_end_hour: input.board_end_hour,
          ...(input.daily_job_cap != null
            ? { daily_job_cap: input.daily_job_cap }
            : {}),
          ...(input.max_extra_miles != null
            ? { max_extra_miles: input.max_extra_miles }
            : {}),
          ...(input.after_hours_booking != null
            ? { after_hours_booking: input.after_hours_booking }
            : {}),
        },
      },
      actor,
    );
    const { execRows } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const prefix = input.job_prefix.endsWith("-")
      ? input.job_prefix
      : `${input.job_prefix}-`;
    await execRows(
      sql`insert into counters (key, prefix, next_value) values ('job', ${prefix}, 1001)
          on conflict (key) do update set prefix = excluded.prefix`,
      tx,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/jobs", "/settings"],
});
