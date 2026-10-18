// Cron hooks for `notify` (BUILD_PLAN §4, §8.1). Owner: B5.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import { and, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, notifications, pushSubscriptions } from "@/db/schema";
import type { CronHook } from "@/lib/cron";
import { emit } from "@/lib/events";
import { getCompany, getSettings } from "@/lib/settings";
import {
  dateKey,
  parseDateKey,
  safeTimeZone,
  zonedTimeToUtc,
} from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";
import { MAX_PUSH_FAILURES } from "./workers";

const DAY = 86_400_000;

export const cronHooks: CronHook[] = [
  {
    // Daily ops digest (SPEC M22) at settings.notify.daily_digest_time (company
    // zone): emitted once per day; the `daily_digest` automation delivers it.
    key: "notify.digest",
    schedule: { everyMinutes: 5 },
    async run({ now }) {
      const [company, settings] = await Promise.all([
        getCompany(),
        getSettings(),
      ]);
      const tz = safeTimeZone(company.timezone);
      const today = dateKey(now, tz);
      const [h, m] = (settings.notify.daily_digest_time || "07:30")
        .split(":")
        .map(Number);
      const due = zonedTimeToUtc(
        { ...parseDateKey(today), hour: h ?? 7, minute: m ?? 30 },
        tz,
      );
      // Not yet, or more than 3 h late (don't send a morning digest at night).
      if (now < due || now.getTime() - due.getTime() > 3 * 3600_000) return;
      const [done] = await db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.type, "digest.daily"),
            sql`${events.payload}->>'date' = ${today}`,
          ),
        )
        .limit(1);
      if (done) return;
      await db.transaction((tx) =>
        emit(
          tx,
          "digest.daily",
          null,
          { date: today },
          { actor: SYSTEM_ACTOR },
        ),
      );
    },
  },
  {
    // Prune dead push subscriptions (repeated failures, or silent for 120 days) and
    // read notifications older than 90 days.
    key: "push.prune",
    schedule: { dailyAt: "04:00" },
    async run({ now }) {
      await db
        .delete(pushSubscriptions)
        .where(
          or(
            gte(pushSubscriptions.failedCount, MAX_PUSH_FAILURES),
            and(
              isNotNull(pushSubscriptions.lastSuccessAt),
              lt(
                pushSubscriptions.lastSuccessAt,
                new Date(now.getTime() - 120 * DAY),
              ),
            ),
          ),
        );
      await db
        .delete(notifications)
        .where(
          and(
            isNotNull(notifications.readAt),
            lt(notifications.createdAt, new Date(now.getTime() - 90 * DAY)),
          ),
        );
    },
  },
];
