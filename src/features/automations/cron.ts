// Cron hooks for `automations` (BUILD_PLAN §4, §8.1). Owner: B5.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import type { CronHook } from "@/lib/cron";
import { runDueReminders, scheduleFixedTime } from "./reminders";

export const cronHooks: CronHook[] = [
  {
    key: "automations.fixed_time",
    schedule: { dailyAt: "00:05" },
    async run({ now }) {
      await scheduleFixedTime(now);
    },
  },
  {
    key: "reminders.due",
    schedule: { everyMinutes: 5 },
    async run({ now }) {
      await runDueReminders(now);
    },
  },
];
