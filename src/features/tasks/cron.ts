// Cron hooks for `tasks` (BUILD_PLAN §4, §8.1). Owner: B2.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import "server-only";
import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import type { CronHook } from "@/lib/cron";
import { emit } from "@/lib/events";
import { SYSTEM_ACTOR } from "@/lib/types";

export const cronHooks: CronHook[] = [
  {
    // task.due for open tasks whose due_at falls in (lastRunAt, now] → B5 `task_due`.
    key: "tasks.due",
    schedule: { everyMinutes: 1 },
    async run({ now, lastRunAt }) {
      const since = lastRunAt ?? new Date(now.getTime() - 60_000);
      const due = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.status, "open"),
            gt(tasks.dueAt, since),
            lte(tasks.dueAt, now),
          ),
        )
        .limit(500);
      if (due.length === 0) return;
      await db.transaction(async (tx) => {
        for (const t of due)
          await emit(
            tx,
            "task.due",
            { type: "task", id: t.id },
            {
              task_id: t.id,
              assignee_user_id: t.assigneeUserId,
              kind: t.kind,
              title: t.title,
              entity_type: t.entityType,
              entity_id: t.entityId,
            },
            { actor: SYSTEM_ACTOR },
          );
      });
    },
  },
];
