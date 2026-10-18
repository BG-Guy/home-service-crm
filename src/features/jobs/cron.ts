// Cron hooks for `jobs` (BUILD_PLAN §4, §8.1). Owner: B2.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import type { CronHook } from "@/lib/cron";
import { revokePublicTokens } from "@/lib/tokens";

export const cronHooks: CronHook[] = [
  {
    // Tracking links die on arrival; a job stuck en_route for 3 h loses its link too.
    key: "jobs.stale_tracking",
    schedule: { everyMinutes: 15 },
    async run({ now }) {
      const stale = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.status, "en_route"),
            lt(jobs.enRouteAt, new Date(now.getTime() - 3 * 3600_000)),
          ),
        )
        .limit(500);
      if (stale.length === 0) return;
      await db.transaction(async (tx) => {
        for (const j of stale)
          await revokePublicTokens(tx, { kind: "tracking", jobId: j.id });
      });
    },
  },
];
