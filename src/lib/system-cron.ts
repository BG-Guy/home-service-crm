import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import { pruneAuthTables } from "./auth/flows";
import { pruneSessions } from "./auth/session";
import type { CronHook } from "./cron";
import { pruneQueue } from "./queue";
import { pruneRateLimits } from "./ratelimit";

// F's own cron hooks (BUILD_PLAN §8.1). `events.process` and `queue.run` run on every
// tick directly (see runTick); `system.prune` cleans housekeeping tables nightly.
export const systemCronHooks: CronHook[] = [
  {
    key: "system.prune",
    schedule: { dailyAt: "03:00" },
    async run() {
      await pruneRateLimits(48);
      await execRows(
        sql`delete from action_receipts where created_at < now() - interval '30 days'`,
      );
      await pruneAuthTables();
      await pruneSessions(30);
      await execRows(
        sql`delete from invites where (accepted_at is not null or revoked_at is not null or expires_at < now()) and created_at < now() - interval '90 days'`,
      );
      await pruneQueue(14);
    },
  },
];
