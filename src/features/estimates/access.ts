import "server-only";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { changeOrders, estimates, jobAssignments } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { SessionUser } from "@/lib/types";

// Row scope for estimates and change orders (SPEC §4.2 "own jobs if tech"):
// jobs.view_all sees everything; others see estimates on jobs they're assigned to
// and the ones they wrote themselves (job-less estimates).

type EstimateRow = typeof estimates.$inferSelect;

async function assignedTo(userId: string, jobId: string): Promise<boolean> {
  const r = await db
    .select({ u: jobAssignments.userId })
    .from(jobAssignments)
    .where(
      and(eq(jobAssignments.jobId, jobId), eq(jobAssignments.userId, userId)),
    )
    .limit(1);
  return r.length > 0;
}

export function canSeeAllEstimates(user: SessionUser): boolean {
  return user.perms.has("jobs.view_all");
}

/** SQL predicate on alias `e` (estimates). */
export function estimateScopeSql(user: SessionUser): SQL {
  if (canSeeAllEstimates(user)) return sql`true`;
  return sql`(e.created_by = ${user.id} or exists (select 1 from job_assignments ja where ja.job_id = e.job_id and ja.user_id = ${user.id}))`;
}

/** 'read' needs estimates.view, 'write' estimates.create; plus the row scope. */
export async function assertEstimateAccess(
  user: SessionUser,
  estimateId: string,
  mode: "read" | "write",
): Promise<EstimateRow> {
  const need = mode === "read" ? "estimates.view" : "estimates.create";
  if (!user.perms.has(need)) throw new ForbiddenError(undefined, need);
  const [e] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!e) throw new NotFoundError("Estimate");
  if (canSeeAllEstimates(user)) return e;
  if (e.createdBy === user.id) return e;
  if (e.jobId && (await assignedTo(user.id, e.jobId))) return e;
  throw new ForbiddenError();
}

export async function assertChangeOrderAccess(
  user: SessionUser,
  coId: string,
  mode: "read" | "write",
): Promise<typeof changeOrders.$inferSelect> {
  const need = mode === "read" ? "estimates.view" : "estimates.create";
  if (!user.perms.has(need)) throw new ForbiddenError(undefined, need);
  const [co] = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.id, coId))
    .limit(1);
  if (!co) throw new NotFoundError("Change order");
  if (canSeeAllEstimates(user) || (await assignedTo(user.id, co.jobId)))
    return co;
  throw new ForbiddenError();
}
