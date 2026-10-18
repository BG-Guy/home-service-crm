// Demo seed fragment for `jobs` (BUILD_PLAN §10.3 #7). Owner: B2.
// Jobs with realistic timestamps per status, assignments (helpers at 50/50),
// geostamped job_status_events near each property, checklist answers, notes,
// the job_cancel (J66) and job_start (J76) approvals and 2 custom tasks.
// Writes only B2 tables (+ createApproval, allowed by §10.1); never emits events;
// idempotent via seedId() + onConflictDoNothing(). Jobs whose customer/property
// rows are missing (B1 fragment not run) are skipped with a log line.
import "server-only";
import { inArray, sql } from "drizzle-orm";
import { type DB, execRows } from "@/db";
import {
  type JobChecklistItem,
  jobAssignments,
  jobStatusEvents,
  jobs,
  leads,
  notes,
  properties,
  serviceTypes,
  tasks,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoJob } from "@/db/seed/demo-plan";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createApproval } from "@/features/approvals/api";
import { getSettings } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/types";
import type { JobStatus } from "./contracts";
import { buildChecklist, serviceFeeDisclosure } from "./internal";
import { distanceMeters } from "./machine";

const MIN = 60_000;
function jitter(
  rng: () => number,
  base: { lat: number; lng: number },
  meters: number,
) {
  const r = meters * Math.sqrt(rng());
  const t = rng() * 2 * Math.PI;
  return {
    lat: base.lat + (r * Math.cos(t)) / 111_320,
    lng:
      base.lng +
      (r * Math.sin(t)) / (111_320 * Math.cos((base.lat * Math.PI) / 180)),
  };
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}

interface Times {
  windowStart: Date | null;
  windowEnd: Date | null;
  confirmedAt: Date | null;
  enRouteAt: Date | null;
  etaAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

/** Timestamps per status, clamped so nothing lands in the future. */
function timesFor(j: DemoJob, ctx: DemoSeedCtx): Times {
  const now = ctx.now;
  const ws =
    j.dayOffset != null && j.windowStart
      ? ctx.at(j.dayOffset, j.windowStart)
      : null;
  const we = ws ? new Date(ws.getTime() + j.windowMinutes * MIN) : null;
  const past = (d: Date) => minDate(d, new Date(now.getTime() - 2 * MIN));
  const t: Times = {
    windowStart: ws,
    windowEnd: we,
    confirmedAt: null,
    enRouteAt: null,
    etaAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    cancelledAt: null,
    createdAt: past(
      new Date(
        (ws ?? now).getTime() - (2 + Math.floor(ctx.rng() * 5)) * 86_400_000,
      ),
    ),
  };
  const s = j.status;
  const base = ws ?? new Date(now.getTime() - 3 * 3600_000);
  if (
    s === "confirmed" ||
    [
      "en_route",
      "arrived",
      "in_progress",
      "completed",
      "closed",
      "on_hold",
    ].includes(s)
  )
    t.confirmedAt = past(new Date(base.getTime() - 20 * 3600_000));
  if (s === "en_route") {
    t.enRouteAt = past(new Date(now.getTime() - 12 * MIN));
    t.etaAt = new Date(now.getTime() + 18 * MIN);
  }
  if (
    ["arrived", "in_progress", "on_hold", "completed", "closed"].includes(s) ||
    j.cancelledAfterArrival
  ) {
    const live = s === "arrived" || s === "in_progress";
    t.enRouteAt = past(
      live
        ? new Date(now.getTime() - (s === "arrived" ? 40 : 95) * MIN)
        : new Date(base.getTime() - 25 * MIN),
    );
    t.arrivedAt = past(
      live
        ? new Date(now.getTime() - (s === "arrived" ? 8 : 70) * MIN)
        : new Date(base.getTime() + 4 * MIN),
    );
  }
  if (["in_progress", "on_hold", "completed", "closed"].includes(s))
    t.startedAt = past(new Date((t.arrivedAt ?? base).getTime() + 9 * MIN));
  if (s === "completed" || s === "closed") {
    t.completedAt = past(
      new Date(
        (t.startedAt ?? base).getTime() +
          Math.max(35, j.windowMinutes - 10) * MIN,
      ),
    );
    if (s === "closed")
      t.closedAt = past(new Date(t.completedAt.getTime() + 3 * 86_400_000));
  }
  if (s === "cancelled")
    t.cancelledAt = past(
      j.cancelledAfterArrival
        ? new Date((t.arrivedAt ?? base).getTime() + 18 * MIN)
        : j.cancelReason === "customer_no_show"
          ? new Date(base.getTime() + 25 * MIN)
          : new Date(base.getTime() - 26 * 3600_000),
    );
  return t;
}

/** Status path for the event log (from creation to the current status). */
function pathFor(j: DemoJob): JobStatus[] {
  const sched: JobStatus[] = j.dayOffset != null ? ["scheduled"] : [];
  const conf: JobStatus[] = ["confirmed"];
  switch (j.status) {
    case "unscheduled":
      return [];
    case "scheduled":
      return sched;
    case "confirmed":
      return [...sched, ...conf];
    case "en_route":
      return [...sched, ...conf, "en_route"];
    case "arrived":
      return [...sched, ...conf, "en_route", "arrived"];
    case "in_progress":
      return [...sched, ...conf, "en_route", "arrived", "in_progress"];
    case "on_hold":
      return [
        ...sched,
        ...conf,
        "en_route",
        "arrived",
        "in_progress",
        "on_hold",
      ];
    case "completed":
      return [
        ...sched,
        ...conf,
        "en_route",
        "arrived",
        "in_progress",
        "completed",
      ];
    case "closed":
      return [
        ...sched,
        ...conf,
        "en_route",
        "arrived",
        "in_progress",
        "completed",
        "closed",
      ];
    case "cancelled":
      return j.cancelledAfterArrival
        ? [...sched, "en_route", "arrived", "cancelled"]
        : j.cancelReason === "customer_no_show"
          ? [...sched, "en_route", "arrived", "cancelled"]
          : [...sched, "cancelled"];
  }
}

function answered(
  items: JobChecklistItem[],
  upto: number,
  at: Date,
  by: string,
): JobChecklistItem[] {
  return items.map((i, idx) =>
    idx < upto
      ? {
          ...i,
          answer:
            i.type === "check"
              ? true
              : i.type === "number"
                ? 1
                : i.type === "select"
                  ? (i.options?.[0] ?? "OK")
                  : "seed",
          answered_at: at.toISOString(),
          answered_by: by,
        }
      : i,
  );
}

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  // Hold reasons, cancel notes, job notes and task copy come from the trade profile.
  const text = ctx.profile.jobs;
  const HOLD: Record<number, { reason: string; note: string }> = {
    67: { reason: "waiting_parts", note: text.holdNotes.specialOrder },
    68: { reason: "customer_approval", note: text.holdNotes.awaitingApproval },
  };
  const CANCEL_NOTES = text.cancelNotes;
  const JOB_NOTES = text.notes;
  const extra = ctx.profile.settings.extraServiceType;
  const userId = (k: string | null) =>
    k ? (plan.users.find((u) => u.key === k)?.id ?? null) : null;
  const officeId = userId("office");
  const settings = await getSettings();
  const disclosure = serviceFeeDisclosure(settings.jobs);

  const propIds = [...new Set(plan.jobs.map((j) => j.propertyId))];
  const [props, sts, leadRows] = await Promise.all([
    db
      .select({
        id: properties.id,
        lat: properties.lat,
        lng: properties.lng,
        customerId: properties.customerId,
      })
      .from(properties)
      .where(inArray(properties.id, propIds)),
    db
      .select({ id: serviceTypes.id, warrantyDays: serviceTypes.warrantyDays })
      .from(serviceTypes),
    db.select({ id: leads.id }).from(leads),
  ]);
  const propMap = new Map(props.map((p) => [p.id, p]));
  const stMap = new Map(sts.map((s) => [s.id, s]));
  const leadSet = new Set(leadRows.map((l) => l.id));
  const checklistCache = new Map<string, JobChecklistItem[]>();
  let skipped = 0;
  let created = 0;

  for (const j of plan.jobs) {
    const prop = propMap.get(j.propertyId);
    if (!prop || prop.customerId !== j.customerId) {
      skipped++;
      continue;
    }
    const t = timesFor(j, ctx);
    const stId = seedId("service_type", j.serviceTypeKey);
    const st = stMap.get(stId) ?? null;
    let checklist: JobChecklistItem[] = [];
    if (st) {
      if (!checklistCache.has(stId))
        checklistCache.set(stId, await buildChecklist(stId).catch(() => []));
      checklist = checklistCache.get(stId) ?? [];
    }
    const techId = userId(j.tech);
    const helperId = userId(j.helper);
    if (checklist.length && techId) {
      const done = j.status === "completed" || j.status === "closed";
      const partial = j.status === "in_progress" || j.status === "on_hold";
      if (done || partial)
        checklist = answered(
          checklist,
          done ? checklist.length : Math.ceil(checklist.length / 2),
          t.startedAt ?? ctx.now,
          techId,
        );
    }
    const custom: Record<string, unknown> = {};
    if (j.callbackOf) custom.no_charge = true;
    if (j.status === "on_hold" && HOLD[j.n]) {
      custom.hold_reason = HOLD[j.n]?.reason;
      custom.hold_note = HOLD[j.n]?.note;
    }
    if (j.n === 77) {
      custom.reschedule_requested_at = new Date(
        ctx.now.getTime() - 50 * MIN,
      ).toISOString();
      custom.reschedule_note = text.rescheduleNote;
    }
    const warrantyDays = st?.warrantyDays ?? 0;
    await db
      .insert(jobs)
      .values({
        id: j.id,
        number: j.number,
        customerId: j.customerId,
        propertyId: j.propertyId,
        serviceTypeId: st ? stId : null,
        leadId:
          j.leadN && leadSet.has(seedId("lead", j.leadN))
            ? seedId("lead", j.leadN)
            : null,
        title: j.title,
        priority: j.priority,
        afterHours:
          (extra.afterHours && j.serviceTypeKey === extra.key) ||
          j.lines.some((l) => l.pricebookKey === "after_hours"),
        status: j.status,
        paymentStatus: j.paymentStatus,
        scheduledStart: t.windowStart,
        scheduledEnd: t.windowEnd,
        windowStart: t.windowStart,
        windowEnd: t.windowEnd,
        confirmedAt: t.confirmedAt,
        enRouteAt: t.enRouteAt,
        etaAt: t.etaAt,
        arrivedAt: t.arrivedAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        closedAt: t.closedAt,
        cancelledAt: t.cancelledAt,
        cancelReason: j.cancelReason,
        cancelNote: j.cancelReason
          ? (CANCEL_NOTES[j.cancelReason] ?? null)
          : null,
        cancelReviewStatus: j.cancelledAfterArrival ? "pending" : null,
        isCallback: !!j.callbackOf,
        callbackOfJobId: j.callbackOf ? seedId("job", j.callbackOf) : null,
        callbackReason: j.callbackOf ? (j.callbackReason ?? "other") : null,
        warrantyExpiresAt:
          t.completedAt && warrantyDays > 0
            ? new Date(t.completedAt.getTime() + warrantyDays * 86_400_000)
            : null,
        recurrence: j.recurring
          ? {
              every: "months",
              n: ctx.profile.specialJobs.recurring.everyMonths,
            }
          : null,
        checklist,
        custom,
        serviceFeeDisclosure: disclosure,
        createdBy: officeId,
        createdAt: t.createdAt,
        updatedAt: t.completedAt ?? t.cancelledAt ?? t.createdAt,
      })
      .onConflictDoNothing();
    created++;

    // Assignments (primary + optional 50/50 helper).
    const assign = [
      techId
        ? { userId: techId, role: "primary", splitBps: helperId ? 5000 : 10000 }
        : null,
      helperId && helperId !== techId
        ? { userId: helperId, role: "helper", splitBps: 5000 }
        : null,
    ].filter(
      (a): a is { userId: string; role: string; splitBps: number } => !!a,
    );
    if (assign.length)
      await db
        .insert(jobAssignments)
        .values(
          assign.map((a) => ({
            jobId: j.id,
            ...a,
            assignedBy: officeId,
            assignedAt: t.createdAt,
          })),
        )
        .onConflictDoNothing();

    // Geostamped status history.
    const path = pathFor(j);
    let from: JobStatus | null = "unscheduled";
    const at: Partial<Record<JobStatus, Date | null>> = {
      scheduled: new Date(t.createdAt.getTime() + 15 * MIN),
      confirmed: t.confirmedAt,
      en_route: t.enRouteAt,
      arrived: t.arrivedAt,
      in_progress: t.startedAt,
      on_hold: t.startedAt ? new Date(t.startedAt.getTime() + 40 * MIN) : null,
      completed: t.completedAt,
      closed: t.closedAt,
      cancelled: t.cancelledAt,
    };
    const rows = path.map((to, i) => {
      const field =
        ["en_route", "arrived", "in_progress", "on_hold", "completed"].includes(
          to,
        ) ||
        (to === "cancelled" && j.cancelledAfterArrival);
      const onSite = to !== "en_route";
      const geo =
        field && prop.lat != null && prop.lng != null
          ? jitter(
              ctx.rng,
              { lat: prop.lat, lng: prop.lng },
              onSite ? 45 : 4000,
            )
          : null;
      const row = {
        id: seedId("job_status_event", `${j.n}-${i}`),
        jobId: j.id,
        fromStatus: from,
        toStatus: to,
        actorUserId: field ? techId : to === "confirmed" ? null : officeId,
        // Status history already happened: never after the seed's clock (an upcoming
        // job created minutes ago would otherwise be "scheduled" in the future).
        at: ctx.past(at[to] ?? t.createdAt),
        clientTs: field && at[to] ? ctx.past(at[to]) : null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        accuracyM: geo ? Math.round(6 + ctx.rng() * 18) : null,
        distanceM:
          geo && to === "arrived" && prop.lat != null && prop.lng != null
            ? Math.round(distanceMeters(geo, { lat: prop.lat, lng: prop.lng }))
            : null,
        etaMinutes:
          to === "en_route" ? [15, 20, 30][Math.floor(ctx.rng() * 3)] : null,
        note:
          to === "cancelled"
            ? [
                j.cancelReason,
                j.cancelReason ? CANCEL_NOTES[j.cancelReason] : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : to === "on_hold"
              ? (HOLD[j.n]?.reason ?? null)
              : to === "confirmed"
                ? "Confirmed by reply"
                : null,
      };
      from = to;
      return row;
    });
    if (rows.length)
      await db.insert(jobStatusEvents).values(rows).onConflictDoNothing();

    // Notes.
    for (const [k, n] of (JOB_NOTES[j.n] ?? []).entries()) {
      const author = n.by === "tech" ? (techId ?? officeId) : officeId;
      await db
        .insert(notes)
        .values({
          id: seedId("note", `job-${j.n}-${k}`),
          entityType: "job",
          entityId: j.id,
          customerId: j.customerId,
          jobId: j.id,
          body: n.body,
          visibility: n.customer ? "customer" : "internal",
          pinned: !!n.pinned,
          authorId: author,
          createdAt: new Date(
            (t.arrivedAt ?? t.createdAt).getTime() + (k + 1) * 7 * MIN,
          ),
        })
        .onConflictDoNothing();
    }

    // Approvals (B6 createApproval, stub level F — allowed in seeds).
    if (j.cancelledAfterArrival && j.status === "cancelled")
      await createApproval(
        db,
        {
          entityType: "job_cancel",
          entityId: j.id,
          policy: "always_review",
          requestedBy: techId,
          evidence: {
            job_number: j.number,
            reason: j.cancelReason,
            note: j.cancelReason ? CANCEL_NOTES[j.cancelReason] : null,
            photo_client_ids: [],
            photo_media_ids: [],
            arrived_at: t.arrivedAt?.toISOString() ?? null,
            lat: prop.lat,
            lng: prop.lng,
          },
        },
        SYSTEM_ACTOR,
      );
    if (
      j.risk === "critical" &&
      ["scheduled", "confirmed"].includes(j.status) &&
      j.dayOffset === 0
    )
      await createApproval(
        db,
        {
          entityType: "job_start",
          entityId: j.id,
          policy: "always_review",
          requestedBy: techId,
          evidence: {
            job_number: j.number,
            risk_band: "critical",
            note: text.startApprovalNote,
            signals: [],
          },
        },
        SYSTEM_ACTOR,
      );
  }

  // Two custom tasks (tasks table is B2's): an office follow-up and a tech to-do.
  const tech1 = userId("tech1");
  const custom = [
    {
      id: seedId("task", "custom-office"),
      kind: "follow_up",
      title: text.officeTask.title,
      body: text.officeTask.body,
      assigneeUserId: officeId,
      jobId: seedId("job", 79),
      customerId: plan.jobs[78]?.customerId ?? null,
      dueAt: ctx.at(0, "15:00"),
    },
    {
      id: seedId("task", "custom-tech1"),
      kind: "custom",
      title: text.techTask.title,
      body: null,
      assigneeUserId: tech1,
      jobId: null,
      customerId: null,
      dueAt: ctx.at(1, "08:00"),
    },
  ];
  const jobIds = new Set(
    (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.id, [seedId("job", 79)]))
    ).map((r) => r.id),
  );
  for (const tk of custom)
    await db
      .insert(tasks)
      .values({
        ...tk,
        jobId: tk.jobId && jobIds.has(tk.jobId) ? tk.jobId : null,
        customerId: tk.jobId && jobIds.has(tk.jobId) ? tk.customerId : null,
        entityType: tk.jobId && jobIds.has(tk.jobId) ? "job" : null,
        entityId: tk.jobId && jobIds.has(tk.jobId) ? tk.jobId : null,
        status: "open",
        createdBy: officeId,
      })
      .onConflictDoNothing();

  // Keep the job counter ahead of the seeded numbers (B2 edits counters 'job', §3.2).
  const maxN = Math.max(
    0,
    ...plan.jobs.map((j) => Number(/(\d+)$/.exec(j.number)?.[1] ?? 0)),
  );
  if (maxN)
    await execRows(
      sql`insert into counters (key, prefix, next_value) values ('job', 'J-', ${maxN + 1})
          on conflict (key) do update set next_value = greatest(counters.next_value, excluded.next_value)`,
      db,
    );

  ctx.log(
    `jobs: ${created} jobs${skipped ? ` (${skipped} skipped: customer/property rows missing)` : ""}`,
  );
}
