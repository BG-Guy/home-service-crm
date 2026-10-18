"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobAssignments, jobs, properties } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  formatInTz,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import type { JobStatus } from "./contracts";
import { rangesOverlap } from "./machine";
import { techRoster } from "./schedule-queries";
import type { AssignOptions } from "./types";

// Read-only server function for the S9 assign sheet (client slot): the job's current
// window/assignees and every technician with conflict hints for the chosen day.

export async function loadAssignOptions(input: {
  jobId: string;
  date?: string | null;
  start?: string | null;
  minutes?: number | null;
}): Promise<ActionResult<AssignOptions>> {
  const user = await requireUser();
  if (!user.perms.has("jobs.assign") && !user.perms.has("jobs.reschedule"))
    return { ok: false, error: "You can't assign jobs." };
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId))
    return { ok: false, error: "Job not found." };
  const tz = await getCompanyTimezone();
  const settings = await getSettings();
  const [j] = await db
    .select({ j: jobs, zip: properties.zip })
    .from(jobs)
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, input.jobId))
    .limit(1);
  if (!j) return { ok: false, error: "Job not found." };
  const assign = await db
    .select({
      userId: jobAssignments.userId,
      role: jobAssignments.role,
      splitBps: jobAssignments.splitBps,
    })
    .from(jobAssignments)
    .where(eq(jobAssignments.jobId, input.jobId));
  const start = j.j.windowStart ?? j.j.scheduledStart;
  const end = j.j.windowEnd ?? j.j.scheduledEnd;
  const curMinutes =
    start && end
      ? Math.round((end.getTime() - start.getTime()) / 60_000)
      : settings.jobs.default_window_min;
  const day =
    input.date ?? (start ? dateKey(start, tz) : dateKey(new Date(), tz));
  const startHm =
    input.start ??
    (start
      ? formatInTz(start, tz, {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
      : null);
  const minutes = input.minutes ?? curMinutes;
  const techs = await techRoster(assign.map((a) => a.userId));
  // Other jobs that day for every tech (load + overlaps).
  const from = zonedTimeToUtc(parseDateKey(day), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(day, 1)), tz);
  const startExpr = sql<Date>`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;
  const dayJobs = await db
    .select({
      userId: jobAssignments.userId,
      id: jobs.id,
      number: jobs.number,
      ws: jobs.windowStart,
      we: jobs.windowEnd,
      ss: jobs.scheduledStart,
      se: jobs.scheduledEnd,
    })
    .from(jobAssignments)
    .innerJoin(jobs, eq(jobs.id, jobAssignments.jobId))
    .where(
      and(
        ne(jobs.status, "cancelled"),
        ne(jobs.id, input.jobId),
        sql`${startExpr} >= ${from.toISOString()}::timestamptz`,
        sql`${startExpr} < ${to.toISOString()}::timestamptz`,
      ),
    );
  let proposed: { start: Date; end: Date } | null = null;
  if (startHm && /^\d{1,2}:\d{2}$/.test(startHm)) {
    const [h, m] = startHm.split(":").map(Number);
    const s = zonedTimeToUtc(
      { ...parseDateKey(day), hour: h ?? 9, minute: m ?? 0 },
      tz,
    );
    proposed = { start: s, end: new Date(s.getTime() + minutes * 60_000) };
  }
  return {
    ok: true,
    data: {
      jobId: j.j.id,
      number: j.j.number,
      title: j.j.title,
      status: j.j.status as JobStatus,
      date: day,
      start: startHm,
      minutes,
      windowLengths: settings.jobs.window_lengths_min,
      assignees: assign.map((a) => ({
        userId: a.userId,
        role: a.role === "helper" ? "helper" : "primary",
        splitBps: a.splitBps,
      })),
      tz,
      techs: techs.map((t) => {
        const mine = dayJobs.filter((d) => d.userId === t.id);
        const conflicts: string[] = [];
        if (proposed)
          for (const d of mine) {
            const s = d.ws ?? d.ss;
            const e =
              d.we ?? d.se ?? (s ? new Date(s.getTime() + 3600_000) : null);
            if (s && e && rangesOverlap(proposed, { start: s, end: e }))
              conflicts.push(`Overlaps ${d.number}`);
          }
        return {
          userId: t.id,
          name: t.name,
          color: t.color,
          clockedIn: t.clockedIn,
          jobsThatDay: mine.length,
          conflicts,
          outsideZip:
            t.serviceZips.length > 0 &&
            !t.serviceZips.includes(j.zip.slice(0, 5)),
        };
      }),
    },
  };
}
