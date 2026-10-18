import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db, execRows, withAdvisoryLock } from "@/db";
import { schedulerState } from "@/db/schema";
import { runWithContext } from "./context";
import { processEvents } from "./events";
import { runQueue } from "./queue";
import { getCompanyTimezone } from "./settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "./time";
import { SYSTEM_ACTOR } from "./types";

// Scheduler (SPEC §3.1; BUILD_PLAN §4 cron.ts, §8.1). /api/cron/tick (and the throttled
// after() piggy-back) runs, under pg advisory lock 42: the event processor, every due
// module cron hook (company time zone; at most one run per window via scheduler_state
// `cron:<key>`), and the job_queue runner. Each step is isolated with try/catch.

export const TICK_LOCK_KEY = 42;
export const PIGGYBACK_INTERVAL_MS = 60_000;

export type CronSchedule =
  | { everyMinutes: number }
  | { dailyAt: string }
  | { weeklyAt: { day: number; time: string } }
  | { monthlyAt: { day: number; time: string } };

export interface CronHook {
  /** Unique, e.g. 'leads.sla'. */
  key: string;
  schedule: CronSchedule;
  run(ctx: { now: Date; lastRunAt: Date | null }): Promise<void>;
}

function hm(time: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) throw new RangeError(`bad time "${time}"`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Most recent scheduled instant ≤ now for window schedules (null for everyMinutes). */
export function mostRecentOccurrence(
  s: CronSchedule,
  now: Date,
  tz: string,
): Date | null {
  if ("everyMinutes" in s) return null;
  const today = dateKey(now, tz);
  const at = (key: string, time: string) =>
    zonedTimeToUtc({ ...parseDateKey(key), ...hm(time) }, tz);
  if ("dailyAt" in s) {
    const t = at(today, s.dailyAt);
    return t <= now ? t : at(addDaysToKey(today, -1), s.dailyAt);
  }
  if ("weeklyAt" in s) {
    const back = (zonedParts(now, tz).weekday - s.weeklyAt.day + 7) % 7;
    const t = at(addDaysToKey(today, -back), s.weeklyAt.time);
    return t <= now ? t : at(addDaysToKey(today, -back - 7), s.weeklyAt.time);
  }
  const { year, month } = parseDateKey(today);
  const day = Math.min(28, Math.max(1, s.monthlyAt.day));
  const key = (y: number, m: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const t = at(key(year, month), s.monthlyAt.time);
  if (t <= now) return t;
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return at(key(prev.y, prev.m), s.monthlyAt.time);
}

/** Last-run threshold: the hook is due when last_run_at is null or older than this. */
export function dueThreshold(s: CronSchedule, now: Date, tz: string): Date {
  if ("everyMinutes" in s)
    return new Date(
      now.getTime() - Math.max(1, s.everyMinutes) * 60_000 + 5_000,
    );
  return mostRecentOccurrence(s, now, tz) as Date;
}

export function isDue(
  s: CronSchedule,
  now: Date,
  lastRunAt: Date | null,
  tz: string,
): boolean {
  if (!lastRunAt) return true;
  return lastRunAt.getTime() < dueThreshold(s, now, tz).getTime();
}

/** Atomically claim a hook's window (at most one run per window across instances). */
async function claim(
  stateKey: string,
  now: Date,
  threshold: Date,
): Promise<boolean> {
  const rows = await execRows<{ key: string }>(sql`
    insert into scheduler_state (key, last_run_at, data) values (${stateKey}, ${now.toISOString()}::timestamptz, '{}'::jsonb)
    on conflict (key) do update set last_run_at = excluded.last_run_at
    where scheduler_state.last_run_at is null or scheduler_state.last_run_at < ${threshold.toISOString()}::timestamptz
    returning key`);
  return rows.length > 0;
}

export type HookOutcome = "ok" | "not_due" | `error: ${string}`;

/** Run every due hook (each isolated). */
export async function runCronHooks(
  now = new Date(),
): Promise<Record<string, HookOutcome>> {
  const { allCronHooks } = await import("./cron-hooks");
  const hooks = allCronHooks();
  const tz = await getCompanyTimezone();
  const keys = hooks.map((h) => `cron:${h.key}`);
  const state = keys.length
    ? await db
        .select()
        .from(schedulerState)
        .where(inArray(schedulerState.key, keys))
    : [];
  const byKey = new Map(state.map((r) => [r.key, r]));
  const out: Record<string, HookOutcome> = {};
  for (const hook of hooks) {
    const stateKey = `cron:${hook.key}`;
    const prev = byKey.get(stateKey);
    const lastRunAt = prev?.lastRunAt ?? null;
    let threshold: Date;
    try {
      if (!isDue(hook.schedule, now, lastRunAt, tz)) {
        out[hook.key] = "not_due";
        continue;
      }
      threshold = dueThreshold(hook.schedule, now, tz);
      if (!(await claim(stateKey, now, threshold))) {
        out[hook.key] = "not_due";
        continue;
      }
    } catch (err) {
      out[hook.key] =
        `error: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    try {
      await runWithContext({ actor: SYSTEM_ACTOR }, () =>
        hook.run({ now, lastRunAt }),
      );
      await db
        .update(schedulerState)
        .set({ data: { ok_at: new Date().toISOString() } })
        .where(sql`${schedulerState.key} = ${stateKey}`);
      out[hook.key] = "ok";
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(
        0,
        500,
      );
      const failures =
        Number((prev?.data as { failures?: number } | null)?.failures ?? 0) + 1;
      // Retry on the next tick (up to 3 times per window) by restoring the previous run time.
      await db
        .update(schedulerState)
        .set({
          lastRunAt: failures < 3 ? lastRunAt : now,
          data: {
            error: message,
            failures: failures < 3 ? failures : 0,
            error_at: new Date().toISOString(),
          },
        })
        .where(sql`${schedulerState.key} = ${stateKey}`);
      console.error(`[cron] ${hook.key} failed:`, err);
      out[hook.key] = `error: ${message}`;
    }
  }
  return out;
}

export interface TickResult {
  ran: boolean;
  events?: unknown;
  hooks?: Record<string, HookOutcome>;
  queue?: unknown;
  errors: string[];
  ms: number;
}

/** One scheduler pass. Returns { ran: false } when another tick holds lock 42. */
export async function runTick(
  opts: {
    now?: Date;
    source?: "cron" | "piggyback" | "manual";
    timeBudgetMs?: number;
  } = {},
): Promise<TickResult> {
  const started = Date.now();
  const errors: string[] = [];
  const budget = opts.timeBudgetMs ?? 45_000;
  const step = async <T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      errors.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(`[cron] ${name} failed:`, err);
      return undefined;
    }
  };
  const res = await withAdvisoryLock(TICK_LOCK_KEY, async () => {
    const now = opts.now ?? new Date();
    // An injected clock (tests, QA fake clock) reaches the event handlers too (QA T6-14).
    const clock = opts.now ? () => now : undefined;
    const events = await step("events", () =>
      processEvents({ timeBudgetMs: Math.min(10_000, budget / 4), now: clock }),
    );
    const hooks = await step("hooks", () => runCronHooks(now));
    const queue = await step("queue", () =>
      runQueue({
        timeBudgetMs: Math.max(2_000, budget - (Date.now() - started) - 5_000),
      }),
    );
    const events2 = await step("events.drain", () =>
      processEvents({ timeBudgetMs: 5_000, now: clock }),
    );
    await step("state", () =>
      execRows(sql`
        insert into scheduler_state (key, last_run_at, data) values ('tick', ${now.toISOString()}::timestamptz, ${JSON.stringify({ source: opts.source ?? "cron" })}::jsonb)
        on conflict (key) do update set last_run_at = excluded.last_run_at, data = excluded.data`),
    );
    return { events: { first: events, drain: events2 }, hooks, queue };
  });
  if (!res.acquired) return { ran: false, errors, ms: Date.now() - started };
  return { ran: true, ...res.value, errors, ms: Date.now() - started };
}

// ------------------------------------------------------------------ piggy-back

let lastLocalAttempt = 0;

/** Throttled tick (≤ once per 60 s across instances via scheduler_state 'tick:piggyback'). */
export async function maybeTick(): Promise<TickResult | null> {
  if (process.env.CRON_PIGGYBACK === "0") return null;
  const now = Date.now();
  if (now - lastLocalAttempt < PIGGYBACK_INTERVAL_MS) return null;
  lastLocalAttempt = now;
  const claimed = await claim(
    "tick:piggyback",
    new Date(now),
    new Date(now - PIGGYBACK_INTERVAL_MS),
  );
  if (!claimed) return null;
  return runTick({ source: "piggyback", timeBudgetMs: 8_000 });
}

/** Schedule maybeTick() after the response (falls back to a detached promise). */
export async function maybeTickSoon(): Promise<void> {
  if (
    process.env.CRON_PIGGYBACK === "0" ||
    process.env.CRM_DISABLE_BACKGROUND === "1"
  )
    return;
  if (Date.now() - lastLocalAttempt < PIGGYBACK_INTERVAL_MS) return;
  const run = () =>
    maybeTick().catch((err) =>
      console.error("[cron] piggy-back tick failed:", err),
    );
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    void run();
  }
}
