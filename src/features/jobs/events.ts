// Event handlers for `jobs` (BUILD_PLAN §4, §7). Owner: B2.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'jobs.<what>'. Slow work → enqueueJob().
import "server-only";
import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey, formatInTz } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";
import { createJob } from "./api";
import { loadAssignees, loadJobRow } from "./internal";
import { buildWindow, nextRecurrenceDate } from "./machine";

export const handlers: HandlerReg[] = [
  {
    // M05 recurring jobs (MVP-lite): "repeat every N weeks/months" creates the next
    // job when this one is completed. Idempotent via custom.next_recurrence_job_id.
    event: "job.completed",
    name: "jobs.recurring_next",
    async run(e, { tx }) {
      const jobId = (e.payload as { job_id: string }).job_id;
      const j = await loadJobRow(tx, jobId, { lock: true });
      if (!j?.recurrence) return;
      const custom = (j.custom ?? {}) as Record<string, unknown>;
      if (custom.next_recurrence_job_id) return;
      const tz = await getCompanyTimezone();
      const anchor =
        j.windowStart ?? j.scheduledStart ?? j.completedAt ?? new Date();
      const nextKey = nextRecurrenceDate(dateKey(anchor, tz), j.recurrence);
      if (!nextKey) return;
      const end = j.windowEnd ?? j.scheduledEnd;
      const minutes =
        end && (j.windowStart ?? j.scheduledStart)
          ? Math.max(
              15,
              Math.round((end.getTime() - anchor.getTime()) / 60_000),
            )
          : 60;
      const hm = formatInTz(anchor, tz, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      const win = buildWindow(nextKey, hm, minutes, tz);
      const assignees = await loadAssignees(tx, jobId);
      const { jobId: nextId } = await createJob(
        tx,
        {
          customerId: j.customerId,
          propertyId: j.propertyId,
          serviceTypeId: j.serviceTypeId,
          title: j.title,
          description: j.description,
          customerNotes: j.customerNotes,
          priority: j.priority as "normal",
          windowStart: win.start,
          windowEnd: win.end,
          assignees,
          recurrence: j.recurrence,
          custom: { recurrence_of: jobId },
        },
        SYSTEM_ACTOR,
      );
      await tx
        .update(jobs)
        .set({
          custom: { ...custom, next_recurrence_job_id: nextId },
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
