import "server-only";
import { and, notInArray, type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobAssignments, jobs } from "@/db/schema";
import { getCompanyTimezone } from "@/lib/settings";
import { startOfDayInTz } from "@/lib/time";

// "Needs a tech" (leads flow item 9, build SPEC 3.6): booked jobs nobody is on
// yet. One definition for the badge on Assign (../badges.ts) and the Assign
// hub's queue and its header (./queries.ts): an arrival window dated today or
// later in the company zone, not finished or called off, and no assignee.
// Undated jobs aren't booked, so they don't count (the hub lists them apart).
// No auto-assign: this only counts and lists; the office picks the tech.

/** Statuses that never need a tech. */
export const NEEDS_TECH_DONE = ["cancelled", "closed", "completed"] as const;

/** Arrival start: the window, else the exact start (as the hub's day view). */
const arrival = sql`coalesce(${jobs.windowStart}, ${jobs.scheduledStart})`;

/** Nobody is assigned to the job (primary or helper). */
export const noAssignee: SQL = sql`not exists (select 1 from ${jobAssignments} where ${jobAssignments.jobId} = ${jobs.id})`;

/** Booked jobs without a tech, from `from` (today's local midnight) on. */
export function needsTechWhere(from: Date): SQL {
  return and(
    sql`${arrival} >= ${from.toISOString()}::timestamptz`,
    notInArray(jobs.status, [...NEEDS_TECH_DONE]),
    noAssignee,
  ) as SQL;
}

/** Today's local midnight in the company zone, as a UTC instant. */
export async function needsTechFrom(now = new Date()): Promise<Date> {
  return startOfDayInTz(now, await getCompanyTimezone());
}

/** How many booked jobs need a tech (the Assign badge and the queue header). */
export async function countNeedsTech(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(needsTechWhere(await needsTechFrom(now)));
  return Number(row?.n ?? 0);
}
