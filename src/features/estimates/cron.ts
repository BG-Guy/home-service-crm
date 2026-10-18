// Cron hooks for `estimates` (BUILD_PLAN §4, §8.1). Owner: B3.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import type { CronHook } from "@/lib/cron";
import { expireEstimates } from "./api";

export const cronHooks: CronHook[] = [
  {
    // sent / viewed past expires_at → expired, emits estimate.expired (idempotent:
    // the status guard in the UPDATE makes a re-run a no-op).
    key: "estimates.expire",
    schedule: { everyMinutes: 60 },
    async run({ now }) {
      await expireEstimates(now);
    },
  },
];
