// Cron hooks for `tools` (BUILD_PLAN §4, §8.1). Owner: B7.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { toolAudits, tools } from "@/db/schema";
import { notify } from "@/features/notify/api";
import { writeActivity } from "@/lib/activity";
import type { CronHook } from "@/lib/cron";
import { emit } from "@/lib/events";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";
import {
  openAuditFor,
  scheduleAuditFor,
  toolsInCustody,
  toolUsers,
} from "./engine";
import { addDays, nextAuditDue } from "./rules";

export const cronHooks: CronHook[] = [
  {
    // Schedules each tech's next tool check per `audit_frequency_days` (due tomorrow
    // at the earliest) → `tool.audit_due` + a push to the tech.
    key: "tools.audits",
    schedule: { dailyAt: "05:20" },
    async run({ now }) {
      if (!(await isEnabled("tools"))) return;
      const tz = await getCompanyTimezone();
      const today = dateKey(now, tz);
      const freq = (await getSettings()).tools.audit_frequency_days;
      for (const u of await toolUsers(db)) {
        if (await openAuditFor(db, u.id)) continue;
        if ((await toolsInCustody(db, u.id)).length === 0) continue;
        const [last] = await db
          .select({ at: toolAudits.submittedAt })
          .from(toolAudits)
          .where(
            and(eq(toolAudits.userId, u.id), isNotNull(toolAudits.submittedAt)),
          )
          .orderBy(desc(toolAudits.submittedAt))
          .limit(1);
        const lastKey = last?.at ? dateKey(last.at, tz) : null;
        const due = nextAuditDue(lastKey, today, freq);
        if (due > addDays(today, 1)) continue;
        const dueOn = due < addDays(today, 1) ? addDays(today, 1) : due;
        await db.transaction((tx) =>
          scheduleAuditFor(tx, u.id, dueOn, SYSTEM_ACTOR),
        );
      }
    },
  },
  {
    // `tool.maintenance_due` N days before (setting, default 7) and on the day,
    // for maintenance and calibration.
    key: "tools.maintenance",
    schedule: { dailyAt: "05:30" },
    async run({ now }) {
      if (!(await isEnabled("tools"))) return;
      const tz = await getCompanyTimezone();
      const today = dateKey(now, tz);
      const warn = (await getSettings()).tools.maintenance_warning_days;
      const days = [...new Set([today, addDays(today, warn)])];
      const rows = await db
        .select()
        .from(tools)
        .where(
          and(
            isNull(tools.deletedAt),
            inArray(tools.status, ["available", "assigned", "in_repair"]),
            or(
              inArray(tools.nextMaintenanceOn, days),
              inArray(tools.calibrationDueOn, days),
            ),
          ),
        );
      for (const t of rows) {
        const due = [
          t.nextMaintenanceOn && days.includes(t.nextMaintenanceOn)
            ? {
                task: t.maintenanceTask ?? "Maintenance",
                on: t.nextMaintenanceOn,
              }
            : null,
          t.calibrationDueOn && days.includes(t.calibrationDueOn)
            ? { task: "Calibration", on: t.calibrationDueOn }
            : null,
        ].filter((x): x is { task: string; on: string } => !!x);
        for (const d of due)
          await db.transaction(async (tx) => {
            const entity = { type: "tool" as const, id: t.id };
            await emit(
              tx,
              "tool.maintenance_due",
              entity,
              { tool_id: t.id, task: d.task, due_on: d.on },
              { actor: SYSTEM_ACTOR },
            );
            await writeActivity(tx, {
              entity,
              kind: "tool.maintenance_due",
              summary: `${d.task} ${d.on === today ? "due today" : `due ${d.on}`}`,
              data: { task: d.task, due_on: d.on },
              actorUserId: null,
            });
            const to = t.currentUserId ?? t.ownerUserId;
            if (to)
              await notify(tx, {
                to: { userIds: [to] },
                type: "staff.generic",
                title: `${d.task} due: ${t.name}`,
                body: d.on === today ? "Due today." : `Due ${d.on}.`,
                url: `/tools/${t.id}`,
                entity,
              });
          });
      }
    },
  },
];
