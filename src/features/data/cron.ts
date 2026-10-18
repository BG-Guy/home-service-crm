// Cron hooks for `data` (BUILD_PLAN §4, §8.1). Owner: B1.
import type { CronHook } from "@/lib/cron";
import { enqueueJob } from "@/lib/queue";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { pruneExports } from "./engine";

export const cronHooks: CronHook[] = [
  {
    // Nightly JSON backup → backups/YYYY-MM-DD/ (14 daily + 8 weekly kept).
    key: "data.backup",
    schedule: { dailyAt: "02:00" },
    async run({ now }) {
      if (!(await getSettings()).data.backups_enabled) return;
      const date = dateKey(now, await getCompanyTimezone());
      await enqueueJob(
        null,
        "backup",
        { date },
        { dedupeKey: `backup:${date}`, maxAttempts: 3 },
      );
    },
  },
  {
    // Expire export downloads (24 h links) and delete their files.
    key: "data.exports_prune",
    schedule: { dailyAt: "03:30" },
    async run({ now }) {
      await pruneExports(now);
    },
  },
];
