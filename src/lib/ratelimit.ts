import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import { RateLimitedError } from "./errors";

// Fixed-window rate limiter (SPEC §6.13 rate_limits; §8.3 lead intake 10/min per
// IP+key; M23 portal 60/min per IP). DB-backed by default so it works across
// instances; `store: 'memory'` for hot paths where a per-instance limit is enough.

export interface RateLimitOptions {
  /** e.g. `lead:${ip}:${key}`. */
  key: string;
  limit: number;
  windowSec: number;
  store?: "db" | "memory";
  now?: Date;
}

export interface RateLimitResult {
  ok: boolean;
  count: number;
  remaining: number;
  resetAt: Date;
  retryAfterSec: number;
}

function windowStart(now: Date, windowSec: number): Date {
  const ms = windowSec * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

const g = globalThis as typeof globalThis & {
  __crmRate?: Map<string, { start: number; count: number }>;
};
function mem() {
  g.__crmRate ??= new Map();
  return g.__crmRate;
}

/** Count one hit against `key`; `ok` is false once the window's count exceeds `limit`. */
export async function rateLimit(o: RateLimitOptions): Promise<RateLimitResult> {
  const now = o.now ?? new Date();
  const start = windowStart(now, o.windowSec);
  const resetAt = new Date(start.getTime() + o.windowSec * 1000);
  let count: number;
  if (o.store === "memory") {
    const m = mem();
    const k = `${o.key}|${start.getTime()}`;
    const cur = m.get(k);
    count = (cur?.count ?? 0) + 1;
    m.set(k, { start: start.getTime(), count });
    if (m.size > 10_000) {
      for (const [key, v] of m) if (v.start < start.getTime()) m.delete(key);
    }
  } else {
    const rows = await execRows<{ count: number }>(sql`
      insert into rate_limits (key, window_start, count) values (${o.key}, ${start.toISOString()}::timestamptz, 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count::int as count`);
    count = Number(rows[0]?.count ?? 1);
  }
  const ok = count <= o.limit;
  return {
    ok,
    count,
    remaining: Math.max(0, o.limit - count),
    resetAt,
    retryAfterSec: ok
      ? 0
      : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/** rateLimit() that throws RateLimitedError when over the limit. */
export async function assertRateLimit(
  o: RateLimitOptions,
  message?: string,
): Promise<RateLimitResult> {
  const r = await rateLimit(o);
  if (!r.ok) throw new RateLimitedError(r.retryAfterSec, message);
  return r;
}

/** Delete windows older than `olderThanHours` (system.prune). */
export async function pruneRateLimits(olderThanHours = 48): Promise<number> {
  const rows = await execRows<{ n: number }>(sql`
    with d as (delete from rate_limits where window_start < now() - make_interval(hours => ${olderThanHours}) returning 1)
    select count(*)::int as n from d`);
  return Number(rows[0]?.n ?? 0);
}
