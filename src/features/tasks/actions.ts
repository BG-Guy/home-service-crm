"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { tasks } from "@/db/schema";
import { assertCustomerAccess } from "@/features/customers/api";
import { assertJobAccess } from "@/features/jobs/api";
import { action } from "@/lib/action";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getCompanyTimezone } from "@/lib/settings";
import { parseDateKey, zonedTimeToUtc } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { createTask } from "./api";

// Task mutations (SPEC M22): create, edit, done/dismiss, reopen. Assigning someone
// else (or the office queue) needs tasks.view_all.

const uuid = z.string().uuid();
const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

async function dueFrom(
  date?: string | null,
  time?: string | null,
): Promise<Date | null> {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const tz = await getCompanyTimezone();
  const m = time && /^(\d{1,2}):(\d{2})$/.exec(time);
  return zonedTimeToUtc(
    {
      ...parseDateKey(date),
      hour: m ? Number(m[1]) : 17,
      minute: m ? Number(m[2]) : 0,
    },
    tz,
  );
}

function canAssign(user: SessionUser, assignee: string | null): boolean {
  return assignee === user.id || user.perms.has("tasks.view_all");
}

const TaskInput = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200),
  body: optText(4000),
  kind: z.enum(["custom", "follow_up", "callback_customer"]).default("custom"),
  assigneeUserId: uuid.nullable().optional(),
  dueDate: z.string().nullable().optional(),
  dueTime: z.string().nullable().optional(),
  jobId: uuid.nullable().optional(),
  customerId: uuid.nullable().optional(),
  clientId: uuid.optional(),
});

export const createTaskAction = action({
  anyPerm: ["tasks.view_all", "jobs.view_own", "jobs.view_all"],
  input: TaskInput,
  audit: "task.created",
  async run({ input, tx, user, actor }) {
    const assignee =
      input.assigneeUserId === undefined ? user.id : input.assigneeUserId;
    if (!canAssign(user, assignee))
      throw new ForbiddenError("You can only create tasks for yourself.");
    // A task only lands on a job or customer the creator can see (QA T5-10).
    if (input.jobId) {
      const job = await assertJobAccess(user, input.jobId, "read");
      if (input.customerId && input.customerId !== job.customerId)
        throw new ValidationError({
          customerId: ["That customer isn't on this job."],
        });
    } else if (input.customerId)
      await assertCustomerAccess(user, input.customerId, "read");
    const entity = input.jobId
      ? ({ type: "job", id: input.jobId } as const)
      : input.customerId
        ? ({ type: "customer", id: input.customerId } as const)
        : undefined;
    return createTask(
      tx,
      {
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        assigneeUserId: assignee,
        entity,
        jobId: input.jobId ?? null,
        customerId: input.customerId ?? null,
        dueAt: await dueFrom(input.dueDate, input.dueTime),
      },
      actor,
    );
  },
  auditEntity: ({ data }) => ({ type: "task", id: data.taskId }),
  revalidate: ({ input }) => [
    "/tasks",
    "/today",
    ...(input.jobId ? [`/jobs/${input.jobId}`] : []),
  ],
});

async function loadEditable(tx: Tx, user: SessionUser, id: string) {
  const [t] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!t) throw new NotFoundError("Task");
  const mine = t.assigneeUserId === user.id || t.createdBy === user.id;
  if (!mine && !user.perms.has("tasks.view_all")) throw new ForbiddenError();
  return t;
}

export const updateTaskAction = action({
  input: TaskInput.omit({ kind: true, jobId: true, customerId: true }).extend({
    taskId: uuid,
  }),
  audit: "task.updated",
  async run({ input, tx, user }) {
    const t = await loadEditable(tx, user, input.taskId);
    const assignee =
      input.assigneeUserId === undefined
        ? t.assigneeUserId
        : input.assigneeUserId;
    if (assignee !== t.assigneeUserId && !canAssign(user, assignee))
      throw new ForbiddenError("You can't reassign this task.");
    await tx
      .update(tasks)
      .set({
        title: input.title,
        body: input.body ?? null,
        assigneeUserId: assignee,
        dueAt: await dueFrom(input.dueDate, input.dueTime),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, t.id));
    return { taskId: t.id, jobId: t.jobId };
  },
  auditEntity: ({ input }) => ({ type: "task", id: input.taskId }),
  revalidate: ({ data }) => [
    "/tasks",
    "/today",
    ...(data.jobId ? [`/jobs/${data.jobId}`] : []),
  ],
});

export const setTaskStatus = action({
  input: z.object({
    taskId: uuid,
    status: z.enum(["open", "done", "dismissed"]),
    clientId: uuid.optional(),
  }),
  audit: "task.status",
  async run({ input, tx, user, activity }) {
    const t = await loadEditable(tx, user, input.taskId);
    const now = new Date();
    await tx
      .update(tasks)
      .set(
        input.status === "open"
          ? { status: "open", doneAt: null, doneBy: null, updatedAt: now }
          : {
              status: input.status,
              doneAt: now,
              doneBy: user.id,
              updatedAt: now,
            },
      )
      .where(eq(tasks.id, t.id));
    if (
      t.entityType &&
      t.entityId &&
      ["customer", "job", "lead"].includes(t.entityType) &&
      input.status !== "open"
    )
      await activity({
        entity: { type: t.entityType as "job", id: t.entityId },
        customerId: t.customerId,
        jobId: t.jobId,
        kind: input.status === "done" ? "task.done" : "task.dismissed",
        summary:
          `${input.status === "done" ? "Task done" : "Task dismissed"}: ${t.title}`.slice(
            0,
            200,
          ),
      });
    return { taskId: t.id, jobId: t.jobId };
  },
  auditEntity: ({ input }) => ({ type: "task", id: input.taskId }),
  revalidate: ({ data }) => [
    "/tasks",
    "/today",
    ...(data.jobId ? [`/jobs/${data.jobId}`] : []),
  ],
});
