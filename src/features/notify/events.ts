// Event handlers for `notify` (BUILD_PLAN §4, §7). Owner: B5.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds).
import { and, eq } from "drizzle-orm";
import { notifications } from "@/db/schema";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { deliverToUsers } from "./deliver";
import { activityHref } from "./timeline";

type P = Record<string, unknown>;
const str = (p: P, k: string) =>
  typeof p[k] === "string" ? (p[k] as string) : null;

export const handlers: HandlerReg[] = [
  {
    // task.created → push the assignee unless they created it themselves (M22).
    event: "task.created",
    name: "notify.task_assigned",
    async run(e, { tx }) {
      const p = e.payload as P;
      const assignee = str(p, "assignee_user_id");
      const taskId = str(p, "task_id");
      if (!assignee || !taskId || assignee === e.actorUserId) return;
      // Idempotent: one bell row per task.
      const [dup] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, assignee),
            eq(notifications.entityType, "task"),
            eq(notifications.entityId, taskId),
          ),
        )
        .limit(1);
      if (dup) return;
      const et = str(p, "entity_type");
      const eid = str(p, "entity_id");
      await deliverToUsers(tx, {
        userIds: [assignee],
        type: "staff.generic",
        title: `New task: ${str(p, "title") ?? "Task"}`,
        body: null,
        url: (et && eid ? activityHref(et, eid) : null) ?? "/tasks",
        entity: { type: "task", id: taskId },
      });
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
