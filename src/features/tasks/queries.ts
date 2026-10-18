import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { customers, jobs, tasks, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import type { SessionUser } from "@/lib/types";
import type { TaskKind } from "./contracts";

// Tasks DAL (SPEC M22 tasks): own tasks always; everyone's (and the unassigned office
// queue) with tasks.view_all — enforced here, not only in the UI.

export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  body: string | null;
  status: "open" | "done" | "dismissed";
  dueAt: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  createdByName: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  entityType: string | null;
  entityId: string | null;
  doneAt: string | null;
  createdAt: string;
}

export function taskScope(
  user: SessionUser,
  scope: "mine" | "all",
): SQL | undefined {
  if (scope === "all" && user.perms.has("tasks.view_all")) return undefined;
  return or(
    eq(tasks.assigneeUserId, user.id),
    and(isNull(tasks.assigneeUserId), eq(tasks.createdBy, user.id)),
  );
}

export async function listTasks(opts: {
  scope: "mine" | "all";
  kind?: string | null;
  status?: "open" | "closed";
  jobId?: string | null;
  limit?: number;
}): Promise<TaskView[]> {
  const user = await requireUser();
  const assignee = alias(users, "assignee");
  const creator = alias(users, "creator");
  const conds: (SQL | undefined)[] = [
    taskScope(user, opts.scope),
    opts.status === "closed"
      ? inArray(tasks.status, ["done", "dismissed"])
      : eq(tasks.status, "open"),
  ];
  if (opts.kind) conds.push(eq(tasks.kind, opts.kind));
  if (opts.jobId) conds.push(eq(tasks.jobId, opts.jobId));
  const rows = await db
    .select({
      t: tasks,
      assigneeName: assignee.name,
      creatorName: creator.name,
      jobNumber: jobs.number,
      customerName: customers.displayName,
    })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .leftJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(jobs, eq(jobs.id, tasks.jobId))
    .leftJoin(customers, eq(customers.id, tasks.customerId))
    .where(and(...conds))
    .orderBy(
      opts.status === "closed"
        ? desc(tasks.doneAt)
        : sql`${tasks.dueAt} asc nulls last`,
      asc(tasks.createdAt),
    )
    .limit(opts.limit ?? 200);
  return rows.map(
    ({ t, assigneeName, creatorName, jobNumber, customerName }) => ({
      id: t.id,
      kind: t.kind as TaskKind,
      title: t.title,
      body: t.body,
      status: t.status as TaskView["status"],
      dueAt: t.dueAt?.toISOString() ?? null,
      assigneeUserId: t.assigneeUserId,
      assigneeName: assigneeName ?? null,
      createdByName: creatorName ?? null,
      jobId: t.jobId,
      jobNumber: jobNumber ?? null,
      customerId: t.customerId,
      customerName: customerName ?? null,
      entityType: t.entityType,
      entityId: t.entityId,
      doneAt: t.doneAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }),
  );
}

export async function assignableUsers(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(asc(users.name));
}
