// Cron hooks for `approvals` (BUILD_PLAN §4, §8.1). Owner: B6.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import type { CronHook } from "@/lib/cron";

export const cronHooks: CronHook[] = [];
