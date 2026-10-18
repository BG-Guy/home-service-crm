// Cron hooks for `team` (BUILD_PLAN §4, §8.1). Owner: B8.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import type { CronHook } from "@/lib/cron";

export const cronHooks: CronHook[] = [];
