import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { tasks } from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import type { Actor, EntityRef } from "@/lib/types";
import type { TaskKind } from "./contracts";

// B2 tasks API (BUILD_PLAN §6.2). F stubs (level F) — B2 may refine, keep signatures.

export type * from "./contracts";

/** assigneeUserId null → office queue (visible with tasks.view_all). Emits task.created. */
export async function createTask(
  tx: Tx,
  input: {
    kind: TaskKind;
    title: string;
    body?: string | null;
    payload?: Record<string, unknown>;
    assigneeUserId: string | null;
    entity?: EntityRef;
    customerId?: string | null;
    jobId?: string | null;
    dueAt?: Date | null;
  },
  actor: Actor,
  /** `quiet`: no task.created event (seeds and imports: nobody gets notified). */
  opts?: { quiet?: boolean },
): Promise<{ taskId: string }> {
  const [row] = await tx
    .insert(tasks)
    .values({
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? null,
      assigneeUserId: input.assigneeUserId,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      customerId: input.customerId ?? null,
      jobId: input.jobId ?? null,
      dueAt: input.dueAt ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error("task insert failed");
  if (!opts?.quiet)
    await emit(
      tx,
      "task.created",
      { type: "task", id: row.id },
      {
        task_id: row.id,
        assignee_user_id: input.assigneeUserId,
        kind: input.kind,
        title: input.title,
        entity_type: input.entity?.type ?? null,
        entity_id: input.entity?.id ?? null,
      },
      { actor },
    );
  if (
    input.entity &&
    [
      "customer",
      "job",
      "lead",
      "estimate",
      "invoice",
      "vehicle",
      "tool",
      "user",
    ].includes(input.entity.type)
  ) {
    await writeActivity(tx, {
      entity: input.entity,
      customerId: input.customerId ?? null,
      jobId: input.jobId ?? null,
      kind: "task.created",
      summary: `Task: ${input.title}`.slice(0, 200),
      data: { task_id: row.id, kind: input.kind },
      actorUserId: actor.userId,
    });
  }
  return { taskId: row.id };
}

/** Close open tasks for an entity (optionally of one kind). */
export async function closeTasksFor(
  tx: Tx,
  q: { kind?: TaskKind; entity: EntityRef },
  status: "done" | "dismissed",
  actor: Actor,
): Promise<number> {
  const conds = [
    eq(tasks.entityType, q.entity.type),
    eq(tasks.entityId, q.entity.id),
    eq(tasks.status, "open"),
  ];
  if (q.kind) conds.push(eq(tasks.kind, q.kind));
  const now = new Date();
  const rows = await tx
    .update(tasks)
    .set({ status, doneAt: now, doneBy: actor.userId, updatedAt: now })
    .where(and(...conds))
    .returning({ id: tasks.id });
  return rows.length;
}
