import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { jobAssignments, jobs, media, properties } from "@/db/schema";
import { createApproval, getApprovalFor } from "@/features/approvals/api";
import { incrementWaivedFeeCount } from "@/features/customers/api";
import {
  computeJobRisk,
  evaluateTransitionControls,
} from "@/features/disputes/api";
import { addJobLine, issueInvoiceForJob } from "@/features/invoices/api";
import { recordStatusLocation } from "@/features/map/api";
import { getServiceType } from "@/features/settings/api";
import { writeActivity } from "@/lib/activity";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { formatDayShort, formatTimeRange } from "@/lib/time";
import { revokePublicTokens } from "@/lib/tokens";
import type { Actor, Geo, SessionUser } from "@/lib/types";
import type { JobStatus } from "./contracts";
import {
  type AssignmentInput,
  insertStatusEvent,
  isoOrNull,
  jobRef,
  loadAssignees,
  loadJobRow,
  normalizeAssignees,
  primaryOf,
} from "./internal";
import {
  CANCEL_REASON_LABEL,
  cancellationFee,
  distanceMeters,
  evaluateTransition,
  type GuardMiss,
  type GuardResult,
  HOLD_REASON_LABEL,
  isAfterArrival,
  openChecklist,
} from "./machine";
import type { TransitionResult } from "./types";

// The one place job statuses change (SPEC M05). Every transition: guards → job row →
// job_status_events (geostamp, distance, client ts/id) → specific event +
// job.status_changed → activity → B7 location stamp → tracking-token revoke.

export interface TransitionArgs {
  jobId: string;
  to: JobStatus;
  actor: Actor;
  /** null = system (handlers, approvals): permission guards are skipped. */
  user: SessionUser | null;
  geo?: Geo | null;
  clientId?: string | null;
  clientTs?: Date | null;
  etaMinutes?: number | null;
  reason?: string | null;
  note?: string | null;
  overrideReason?: string | null;
  /** Cancel after arrival: queued photo client ids (S24 onQueued). */
  photoClientIds?: string[];
  /** Return visit (on_hold → scheduled). */
  newWindow?: { start: Date; end: Date } | null;
  waiveFee?: boolean;
  /** Only compute guards (no writes). */
  dryRun?: boolean;
}

function perms(user: SessionUser | null, isAssignee: boolean) {
  const has = (p: Parameters<SessionUser["perms"]["has"]>[0]) =>
    user ? user.perms.has(p) : true;
  return {
    isAssignee: user ? isAssignee : true,
    statusOwn: has("jobs.status_own"),
    statusAny: has("jobs.status_any"),
    cancel: has("jobs.cancel"),
    cancelAfterArrival: has("jobs.cancel_after_arrival"),
    reopen: has("jobs.reopen"),
    override: has("jobs.override_requirements"),
  };
}

async function riskAndControls(
  tx: Tx,
  jobId: string,
  to: "in_progress" | "completed",
  riskBand: string | null,
  paymentStatus: string,
  dryRun: boolean,
): Promise<GuardMiss[]> {
  let band = riskBand;
  if (to === "in_progress" && !dryRun) {
    band = (await computeJobRisk(tx, jobId, "manual")).band;
  }
  const c = await evaluateTransitionControls(jobId, to);
  let controls: GuardMiss[] = c.missing.map((m) => ({ ...m }));
  if (to === "in_progress" && band === "critical") {
    const approval = await getApprovalFor("job_start", jobId).catch(() => null);
    const prepaid =
      paymentStatus === "paid" || paymentStatus === "deposit_paid";
    controls = controls.filter((c) => c.action !== "request_start_approval");
    if (approval?.status !== "approved" && !prepaid) {
      controls.push({
        key: "start_approval",
        label:
          approval?.status === "pending"
            ? "Waiting for admin approval to start (Critical risk)"
            : approval?.status === "rejected"
              ? "Admin denied starting this job — collect prepayment"
              : "Critical risk: admin approval or prepayment needed to start",
        overridable: true,
        action: "request_start_approval",
      });
    }
  }
  return controls;
}

/** Guard evaluation for a prospective transition (used for previews and inside applyTransition). */
export async function checkTransition(
  tx: Tx,
  a: TransitionArgs,
): Promise<{ guard: GuardResult; distanceM: number | null }> {
  const job = await loadJobRow(tx, a.jobId);
  if (!job) throw new NotFoundError("Job");
  return checkLoaded(tx, job, await loadAssignees(tx, a.jobId), a);
}

async function checkLoaded(
  tx: Tx,
  job: NonNullable<Awaited<ReturnType<typeof loadJobRow>>>,
  assignees: AssignmentInput[],
  a: TransitionArgs,
): Promise<{ guard: GuardResult; distanceM: number | null }> {
  const from = job.status as JobStatus;
  const isAssignee = !!a.user && assignees.some((x) => x.userId === a.user?.id);
  let distanceM: number | null = null;
  if (a.to === "arrived" && a.geo) {
    const [p] = await tx
      .select({ lat: properties.lat, lng: properties.lng })
      .from(properties)
      .where(eq(properties.id, job.propertyId))
      .limit(1);
    if (p?.lat != null && p.lng != null)
      distanceM = Math.round(distanceMeters(a.geo, { lat: p.lat, lng: p.lng }));
  }
  const settings = await getSettings();
  const open = openChecklist(job.checklist ?? []);
  const reopening = from === "completed" || from === "closed";
  const controls =
    (a.to === "in_progress" && !reopening && from !== "on_hold") ||
    a.to === "completed"
      ? await riskAndControls(
          tx,
          job.id,
          a.to as "in_progress" | "completed",
          job.riskBand,
          job.paymentStatus,
          !!a.dryRun,
        )
      : [];
  const guard = evaluateTransition({
    from,
    to: a.to,
    actor: perms(a.user, isAssignee),
    job: {
      hasWindow: !!(job.windowStart || job.scheduledStart),
      assigneeCount: assignees.length,
      arrivedAt: job.arrivedAt,
    },
    input: {
      hasGeo: !!a.geo,
      distanceM,
      reason: a.reason,
      note: a.note,
      photoCount: a.photoClientIds?.length ?? 0,
      hasNewWindow: !!a.newWindow,
      overrideReason: a.overrideReason,
    },
    settings: { arrivalRadiusM: settings.jobs.arrival_radius_m },
    checklistOpen: open.required,
    ownershipOpen: open.ownership,
    controls,
  });
  return { guard, distanceM };
}

/**
 * Apply a status transition inside the caller's transaction. Returns `blocked` (no
 * writes) when overridable requirements are missing; throws for hard failures.
 */
export async function applyTransition(
  tx: Tx,
  a: TransitionArgs,
): Promise<TransitionResult> {
  const job = await loadJobRow(tx, a.jobId, { lock: !a.dryRun });
  if (!job) throw new NotFoundError("Job");
  const from = job.status as JobStatus;
  if (from === a.to) return { status: "done", from, to: a.to, warnings: [] };
  const assignees = await loadAssignees(tx, a.jobId);
  const { guard, distanceM } = await checkLoaded(tx, job, assignees, a);
  const firstError = guard.errors[0];
  if (firstError) {
    if (firstError.key === "forbidden")
      throw new ForbiddenError(firstError.label);
    throw new ConflictError(firstError.key, firstError.label);
  }
  if (!guard.ok) return { status: "blocked", missing: guard.missing };
  if (a.dryRun)
    return { status: "done", from, to: a.to, warnings: guard.warnings };

  const now = new Date();
  const actorId = a.actor.userId;
  const techId =
    actorId && assignees.some((x) => x.userId === actorId)
      ? actorId
      : primaryOf(assignees);
  const techIds = assignees.map((x) => x.userId);
  const custom: Record<string, unknown> = { ...(job.custom ?? {}) };
  const patch: Partial<typeof jobs.$inferInsert> = {
    status: a.to,
    updatedAt: now,
  };
  const entity = jobRef(job.id);
  const opts = { actor: a.actor };
  const tz = await getCompanyTimezone();
  let summary = "";
  let invoiceId: string | null = null;
  const reopening = from === "completed" || from === "closed";
  const afterArrival = isAfterArrival({
    status: from,
    arrivedAt: job.arrivedAt,
  });

  switch (a.to) {
    case "en_route": {
      const eta = a.etaMinutes ?? null;
      patch.enRouteAt = now;
      patch.etaAt = eta ? new Date(now.getTime() + eta * 60_000) : null;
      summary = eta ? `On the way (ETA ${eta} min)` : "On the way";
      break;
    }
    case "arrived": {
      patch.arrivedAt = now;
      custom.arrival_flags = guard.flags;
      summary =
        distanceM != null && guard.flags.includes("far_from_property")
          ? `Arrived (${Math.round(distanceM)} m from the property)`
          : "Arrived on site";
      break;
    }
    case "in_progress": {
      if (reopening) {
        patch.completedAt = null;
        patch.closedAt = null;
        custom.reopened_at = now.toISOString();
        custom.reopen_reason = a.reason ?? null;
        summary = `Reopened: ${a.reason ?? ""}`.trim();
      } else if (from === "on_hold") {
        delete custom.hold_reason;
        summary = "Work resumed";
      } else {
        patch.startedAt = job.startedAt ?? now;
        summary = "Job started";
      }
      if (guard.flags.includes("override")) {
        custom.start_override = {
          reason: a.overrideReason,
          by: actorId,
          at: now.toISOString(),
        };
        summary += " (requirements overridden)";
      }
      break;
    }
    case "on_hold": {
      custom.hold_reason = a.reason;
      custom.hold_note = a.note ?? null;
      summary = `On hold: ${HOLD_REASON_LABEL[a.reason ?? ""] ?? a.reason}`;
      break;
    }
    case "scheduled": {
      // Return visit (on_hold → scheduled) with a new window.
      if (a.newWindow) {
        patch.windowStart = a.newWindow.start;
        patch.windowEnd = a.newWindow.end;
        patch.scheduledStart = a.newWindow.start;
        patch.scheduledEnd = a.newWindow.end;
        patch.etaAt = null;
        patch.confirmedAt = null;
      }
      if (from === "on_hold") {
        patch.visitCount = job.visitCount + 1;
        delete custom.hold_reason;
        delete custom.hold_note;
        summary = `Return visit scheduled for ${formatDayShort(a.newWindow?.start ?? null, tz)}`;
      } else summary = "Scheduled";
      break;
    }
    case "unscheduled": {
      summary = "Moved back to unscheduled";
      break;
    }
    case "confirmed": {
      patch.confirmedAt = now;
      summary = "Customer confirmed";
      break;
    }
    case "completed": {
      patch.completedAt = now;
      const st = job.serviceTypeId
        ? await getServiceType(job.serviceTypeId)
        : null;
      if (st && st.warrantyDays > 0)
        patch.warrantyExpiresAt = new Date(
          now.getTime() + st.warrantyDays * 86_400_000,
        );
      if (guard.flags.includes("override"))
        custom.complete_override = {
          reason: a.overrideReason,
          by: actorId,
          at: now.toISOString(),
        };
      summary = guard.flags.includes("override")
        ? "Job completed (requirements overridden)"
        : "Job completed";
      break;
    }
    case "cancelled": {
      patch.cancelledAt = now;
      patch.cancelReason = a.reason ?? "other";
      patch.cancelNote = a.note ?? null;
      if (afterArrival) {
        const reviewer = a.user?.perms.has("jobs.review_cancellations") ?? true;
        patch.cancelReviewStatus = reviewer ? "ok" : "pending";
        custom.cancel_photo_client_ids = a.photoClientIds ?? [];
      }
      summary = `Cancelled: ${CANCEL_REASON_LABEL[a.reason ?? ""] ?? a.reason}`;
      break;
    }
    default:
      break;
  }
  patch.custom = custom;
  await tx.update(jobs).set(patch).where(eq(jobs.id, job.id));

  await insertStatusEvent(tx, {
    jobId: job.id,
    from,
    to: a.to,
    actorUserId: actorId,
    clientTs: a.clientTs ?? null,
    lat: a.geo?.lat ?? null,
    lng: a.geo?.lng ?? null,
    accuracyM: a.geo?.accuracyM ?? null,
    distanceM,
    etaMinutes: a.to === "en_route" ? (a.etaMinutes ?? null) : null,
    note:
      [
        a.to === "on_hold" || a.to === "cancelled" || reopening
          ? (a.reason ?? null)
          : null,
        a.note ?? null,
        guard.flags.length ? `flags: ${guard.flags.join(", ")}` : null,
        guard.flags.includes("override")
          ? `override: ${a.overrideReason}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    clientId: a.clientId ?? null,
  });

  if (a.geo && actorId)
    await recordStatusLocation(tx, {
      userId: actorId,
      jobId: job.id,
      geo: a.geo,
    });

  // The /t link keeps working after arrival ("Your technician has arrived", no
  // position: the page only shows a location while en route, QA T1-12); it ends
  // with the visit.
  if (a.to === "completed" || a.to === "cancelled")
    await revokePublicTokens(tx, { kind: "tracking", jobId: job.id });

  // Domain effects that must hold atomically (BUILD_PLAN §6.9).
  if (a.to === "completed") {
    const inv = await issueInvoiceForJob(tx, job.id, "job_completed", a.actor);
    invoiceId = inv?.invoiceId ?? null;
  }
  if (a.to === "cancelled") {
    const fee = cancellationFee({
      reason: a.reason ?? "",
      windowStart: job.windowStart ?? job.scheduledStart,
      at: now,
      policy: (await getSettings()).jobs.cancellation_policy,
    });
    if (fee && a.waiveFee) {
      await tx
        .update(jobs)
        .set({ custom: { ...custom, cancel_fee_waived: fee } })
        .where(eq(jobs.id, job.id));
      await incrementWaivedFeeCount(tx, job.customerId, a.actor);
      await writeActivity(tx, {
        entity,
        customerId: job.customerId,
        kind: "job.fee_waived",
        summary: `${fee.kind === "no_show" ? "No-show" : "Late cancellation"} fee waived`,
        actorUserId: actorId,
      });
    } else if (fee) {
      try {
        await addJobLine(
          tx,
          job.id,
          {
            type: "fee",
            name:
              fee.kind === "no_show" ? "No-show fee" : "Late cancellation fee",
            qty: 1,
            unitPriceCents: fee.cents,
            taxable: false,
          },
          a.actor,
        );
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
  }

  // Events (specific + job.status_changed) and the timeline.
  const lat = a.geo?.lat ?? null;
  const lng = a.geo?.lng ?? null;
  switch (a.to) {
    case "en_route":
      await emit(
        tx,
        "job.en_route",
        entity,
        {
          job_id: job.id,
          tech_id: techId ?? actorId ?? "",
          eta_minutes: a.etaMinutes ?? 0,
        },
        opts,
      );
      break;
    case "arrived":
      await emit(
        tx,
        "job.arrived",
        entity,
        {
          job_id: job.id,
          tech_id: techId ?? actorId ?? "",
          distance_m: distanceM,
        },
        opts,
      );
      break;
    case "in_progress":
      if (!reopening && from !== "on_hold")
        await emit(tx, "job.started", entity, { job_id: job.id }, opts);
      break;
    case "on_hold":
      await emit(
        tx,
        "job.on_hold",
        entity,
        { job_id: job.id, reason: a.reason ?? null },
        opts,
      );
      break;
    case "scheduled":
      if (from === "on_hold")
        await emit(
          tx,
          "job.return_visit_scheduled",
          entity,
          {
            job_id: job.id,
            visit_count: job.visitCount + 1,
            window: {
              start: isoOrNull(a.newWindow?.start),
              end: isoOrNull(a.newWindow?.end),
            },
          },
          opts,
        );
      break;
    case "completed":
      await emit(
        tx,
        "job.completed",
        entity,
        {
          job_id: job.id,
          tech_ids: techIds,
          invoice_id: invoiceId,
          completed_at: now.toISOString(),
        },
        opts,
      );
      break;
    case "cancelled":
      await emit(
        tx,
        "job.cancelled",
        entity,
        {
          job_id: job.id,
          reason: a.reason ?? "other",
          after_arrival: afterArrival,
          tech_ids: techIds,
        },
        opts,
      );
      break;
    default:
      break;
  }
  await emit(
    tx,
    "job.status_changed",
    entity,
    {
      job_id: job.id,
      from,
      to: a.to,
      tech_id: techId,
      lat,
      lng,
    },
    opts,
  );
  const kind =
    a.to === "en_route"
      ? "job.en_route"
      : a.to === "arrived"
        ? "job.arrived"
        : a.to === "in_progress"
          ? reopening
            ? "job.reopened"
            : "job.started"
          : a.to === "on_hold"
            ? "job.on_hold"
            : a.to === "completed"
              ? "job.completed"
              : a.to === "cancelled"
                ? "job.cancelled"
                : from === "on_hold" && a.to === "scheduled"
                  ? "job.return_visit_scheduled"
                  : "job.status_changed";
  await writeActivity(tx, {
    entity,
    customerId: job.customerId,
    kind,
    summary,
    data: { from, to: a.to, flags: guard.flags },
    actorUserId: actorId,
  });

  // After-arrival cancellation by a non-reviewer → admin review (approvals row).
  if (
    a.to === "cancelled" &&
    afterArrival &&
    patch.cancelReviewStatus === "pending"
  ) {
    const photoIds = a.photoClientIds?.length
      ? (
          await tx
            .select({ id: media.id })
            .from(media)
            .where(inArray(media.clientId, a.photoClientIds))
        ).map((m) => m.id)
      : [];
    const { approvalId } = await createApproval(
      tx,
      {
        entityType: "job_cancel",
        entityId: job.id,
        policy: "always_review",
        requestedBy: actorId,
        evidence: {
          job_number: job.number,
          reason: a.reason,
          note: a.note,
          photo_client_ids: a.photoClientIds ?? [],
          photo_media_ids: photoIds,
          arrived_at: isoOrNull(job.arrivedAt),
          lat,
          lng,
        },
      },
      a.actor,
    );
    await emit(
      tx,
      "job.cancel_review_requested",
      entity,
      {
        job_id: job.id,
        approval_id: approvalId,
      },
      opts,
    );
    await writeActivity(tx, {
      entity,
      customerId: job.customerId,
      kind: "job.cancel_review_requested",
      summary: "After-arrival cancellation sent for review",
      actorUserId: actorId,
    });
  }

  return {
    status: "done",
    from,
    to: a.to,
    warnings: guard.warnings,
    invoiceId,
  };
}

// ------------------------------------------------------------------ schedule / assign

export interface ScheduleArgs {
  jobId: string;
  /** undefined = keep; null = clear (→ unscheduled). */
  window?: { start: Date; end: Date } | null;
  /** undefined = keep. */
  assignees?: AssignmentInput[];
  actor: Actor;
}

/**
 * Assign/reassign and (re)schedule in one write. Emits job.assigned (diff),
 * job.rescheduled (start changed on a scheduled job), job.scheduled (newly
 * scheduled) and job.status_changed when the status follows.
 */
export async function scheduleAndAssign(
  tx: Tx,
  a: ScheduleArgs,
): Promise<{ status: JobStatus; changed: boolean }> {
  const job = await loadJobRow(tx, a.jobId, { lock: true });
  if (!job) throw new NotFoundError("Job");
  const from = job.status as JobStatus;
  if (from === "completed" || from === "closed" || from === "cancelled")
    throw new ConflictError("job_done", "This job is already finished.");
  const now = new Date();
  const entity = jobRef(job.id);
  const opts = { actor: a.actor };
  const before = await loadAssignees(tx, job.id);
  let after = before;
  let added: string[] = [];
  let removed: string[] = [];
  if (a.assignees) {
    after = normalizeAssignees(a.assignees);
    const beforeIds = new Set(before.map((x) => x.userId));
    const afterIds = new Set(after.map((x) => x.userId));
    added = [...afterIds].filter((id) => !beforeIds.has(id));
    removed = [...beforeIds].filter((id) => !afterIds.has(id));
    if (removed.length)
      await tx
        .delete(jobAssignments)
        .where(
          and(
            eq(jobAssignments.jobId, job.id),
            inArray(jobAssignments.userId, removed),
          ),
        );
    for (const x of after) {
      if (added.includes(x.userId)) {
        await tx.insert(jobAssignments).values({
          jobId: job.id,
          userId: x.userId,
          role: x.role,
          splitBps: x.splitBps,
          assignedBy: a.actor.userId,
        });
      } else {
        const prev = before.find((b) => b.userId === x.userId);
        if (prev && (prev.role !== x.role || prev.splitBps !== x.splitBps))
          await tx
            .update(jobAssignments)
            .set({ role: x.role, splitBps: x.splitBps })
            .where(
              and(
                eq(jobAssignments.jobId, job.id),
                eq(jobAssignments.userId, x.userId),
              ),
            );
      }
    }
  }
  const oldStart = job.windowStart ?? job.scheduledStart;
  const patch: Partial<typeof jobs.$inferInsert> = { updatedAt: now };
  let windowChanged = false;
  if (a.window !== undefined) {
    const ns = a.window?.start ?? null;
    const ne_ = a.window?.end ?? null;
    windowChanged =
      (ns?.getTime() ?? null) !== (oldStart?.getTime() ?? null) ||
      (ne_?.getTime() ?? null) !==
        ((job.windowEnd ?? job.scheduledEnd)?.getTime() ?? null);
    if (windowChanged) {
      patch.windowStart = ns;
      patch.windowEnd = ne_;
      patch.scheduledStart = ns;
      patch.scheduledEnd = ne_;
      if (job.etaAt) patch.etaAt = null;
    }
  }
  const hasWindow = a.window !== undefined ? !!a.window : !!oldStart;
  let to: JobStatus = from;
  if (from === "unscheduled" && hasWindow && after.length > 0) to = "scheduled";
  else if (
    (from === "scheduled" || from === "confirmed") &&
    (!hasWindow || after.length === 0)
  )
    to = "unscheduled";
  else if (from === "confirmed" && windowChanged) to = "scheduled";
  else if (
    from === "on_hold" &&
    windowChanged &&
    hasWindow &&
    after.length > 0
  ) {
    // A return visit goes through applyTransition (visit count, events).
    throw new ConflictError(
      "use_return_visit",
      "Use “Schedule return visit” for jobs on hold.",
    );
  }
  if (to !== from) {
    patch.status = to;
    if (to === "scheduled" && from === "confirmed") patch.confirmedAt = null;
  }
  const changed =
    windowChanged ||
    added.length > 0 ||
    removed.length > 0 ||
    to !== from ||
    (a.assignees !== undefined &&
      JSON.stringify(before) !== JSON.stringify(after));
  if (!changed) return { status: from, changed: false };
  await tx.update(jobs).set(patch).where(eq(jobs.id, job.id));
  const tz = await getCompanyTimezone();
  const newStart =
    a.window !== undefined ? (a.window?.start ?? null) : oldStart;
  const newEnd =
    a.window !== undefined
      ? (a.window?.end ?? null)
      : (job.windowEnd ?? job.scheduledEnd);

  if (added.length || removed.length) {
    await emit(
      tx,
      "job.assigned",
      entity,
      {
        job_id: job.id,
        user_ids_added: added,
        user_ids_removed: removed,
        tech_ids: [...new Set([...after.map((x) => x.userId), ...removed])],
      },
      opts,
    );
    await writeActivity(tx, {
      entity,
      customerId: job.customerId,
      kind: "job.assigned",
      summary:
        added.length && removed.length
          ? "Reassigned"
          : added.length
            ? `Assigned ${added.length === 1 ? "a technician" : `${added.length} technicians`}`
            : "Technician removed",
      data: { added, removed },
      actorUserId: a.actor.userId,
    });
  }
  if (
    windowChanged &&
    from !== "unscheduled" &&
    newStart &&
    to !== "unscheduled"
  ) {
    await emit(
      tx,
      "job.rescheduled",
      entity,
      {
        job_id: job.id,
        old_start: isoOrNull(oldStart),
        new_start: isoOrNull(newStart),
        tech_ids: after.map((x) => x.userId),
      },
      opts,
    );
    await writeActivity(tx, {
      entity,
      customerId: job.customerId,
      kind: "job.rescheduled",
      summary: `Rescheduled to ${formatDayShort(newStart, tz)}${newEnd ? `, ${formatTimeRange(newStart, newEnd, tz)}` : ""}`,
      actorUserId: a.actor.userId,
    });
  }
  if (to !== from) {
    await insertStatusEvent(tx, {
      jobId: job.id,
      from,
      to,
      actorUserId: a.actor.userId,
      note:
        to === "scheduled" && from === "confirmed"
          ? "Rescheduled — needs reconfirmation"
          : null,
    });
    if (to === "scheduled" && from === "unscheduled") {
      await emit(
        tx,
        "job.scheduled",
        entity,
        {
          job_id: job.id,
          scheduled_start: isoOrNull(newStart),
          window_start: isoOrNull(newStart),
          window_end: isoOrNull(newEnd),
          assignees: after.map((x) => x.userId),
        },
        opts,
      );
      await writeActivity(tx, {
        entity,
        customerId: job.customerId,
        kind: "job.scheduled",
        summary: newStart
          ? `Scheduled for ${formatDayShort(newStart, tz)}${newEnd ? `, ${formatTimeRange(newStart, newEnd, tz)}` : ""}`
          : "Scheduled",
        actorUserId: a.actor.userId,
      });
    } else if (to === "unscheduled") {
      await writeActivity(tx, {
        entity,
        customerId: job.customerId,
        kind: "job.status_changed",
        summary: "Moved back to unscheduled",
        actorUserId: a.actor.userId,
      });
    }
    await emit(
      tx,
      "job.status_changed",
      entity,
      {
        job_id: job.id,
        from,
        to,
        tech_id: primaryOf(after),
        lat: null,
        lng: null,
      },
      opts,
    );
  }
  return { status: to, changed: true };
}
