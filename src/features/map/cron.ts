// Cron hooks for `map` (BUILD_PLAN §4, §8.1). Owner: B7.
import "server-only";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { locationBreadcrumbs } from "@/db/schema";
import type { CronHook } from "@/lib/cron";
import { getSettings } from "@/lib/settings";

export const cronHooks: CronHook[] = [
  {
    // Breadcrumbs older than `keep_breadcrumbs_days` (0 = keep none) are deleted.
    key: "map.prune",
    schedule: { dailyAt: "03:15" },
    async run({ now }) {
      const days = (await getSettings()).map.keep_breadcrumbs_days;
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      await db
        .delete(locationBreadcrumbs)
        .where(lt(locationBreadcrumbs.recordedAt, cutoff));
    },
  },
];
