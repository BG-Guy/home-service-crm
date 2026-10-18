// Cron hooks for `messaging` (BUILD_PLAN §4, §8.1). Owner: B5.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import { db } from "@/db";
import { notify } from "@/features/notify/api";
import type { CronHook } from "@/lib/cron";
import type { Perm } from "@/lib/permissions";
import { deliverDueMessages, expireOutbox, newOutboxAssignees } from "./sender";

export const cronHooks: CronHook[] = [
  {
    // Sends due scheduled_messages: re-checks, quiet-hours deferral, caps, outbox.
    key: "messaging.send_due",
    schedule: { everyMinutes: 1 },
    async run({ now }) {
      await deliverDueMessages({ now, timeBudgetMs: 25_000 });
    },
  },
  {
    // Expires stale outbox cards; one batched push per person: "n customer texts ready".
    key: "messaging.outbox",
    schedule: { everyMinutes: 5 },
    async run({ now, lastRunAt }) {
      await expireOutbox(now);
      const since = lastRunAt ?? new Date(now.getTime() - 5 * 60_000);
      const fresh = await newOutboxAssignees(since);
      if (fresh.length === 0) return;
      await db.transaction(async (tx) => {
        for (const f of fresh) {
          const n = f.n;
          await notify(tx, {
            to: f.userId
              ? { userIds: [f.userId] }
              : { perm: "messages.outbox_all" as Perm },
            type: "staff.outbox_ready",
            title: `${n} customer text${n === 1 ? "" : "s"} ready`,
            body: "Open the outbox and tap Send for each one.",
            url: "/messages/outbox",
          });
        }
      });
    },
  },
];
