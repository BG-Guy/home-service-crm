// Cron hooks for `payments` (BUILD_PLAN §4, §8.1). Owner: B4.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import type { CronHook } from "@/lib/cron";
import {
  alertExpiringHolds,
  alertUnverified,
  expireCheckouts,
  promisedRefundsDue,
  retryWebhooks,
  settleHolds,
} from "./background";

export const cronHooks: CronHook[] = [
  {
    key: "payments.webhook_retry",
    schedule: { everyMinutes: 1 },
    run: async ({ now }) => {
      await retryWebhooks(now);
    },
  },
  {
    key: "payments.capture_holds",
    schedule: { everyMinutes: 5 },
    run: async () => {
      await settleHolds();
    },
  },
  {
    key: "payments.manual_unverified",
    schedule: { dailyAt: "08:00" },
    run: async ({ now }) => {
      await alertUnverified(now);
    },
  },
  {
    key: "deposits.hold_expiring",
    schedule: { everyMinutes: 60 },
    run: async ({ now }) => {
      await alertExpiringHolds(now);
    },
  },
  {
    key: "refunds.due",
    schedule: { everyMinutes: 15 },
    run: async ({ now }) => {
      await promisedRefundsDue(now);
    },
  },
  {
    key: "checkout.expire",
    schedule: { everyMinutes: 60 },
    run: async ({ now }) => {
      await expireCheckouts(now);
    },
  },
];
