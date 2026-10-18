import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import { jobQueue } from "@/db/schema";

// Background job queue (SPEC §6.13 job_queue; BUILD_PLAN §8.2). Workers live in each
// module's workers.ts (aggregated in ./workers.ts). The runner claims due rows with
// FOR UPDATE SKIP LOCKED in one short statement, runs them outside any transaction,
// and retries with exponential backoff until max_attempts, then marks them `dead`.

export type JobQueueKind =
  | "email"
  | "push"
  | "export"
  | "backup"
  | "geocode"
  | "pdf"
  | "evidence_pack"
  | "stripe_fee"
  | "vin"
  | "recalls"
  | "ai";

export type JobRow = typeof jobQueue.$inferSelect;
/** Worker for one job kind. Declared with method syntax so typed payloads stay assignable. */
export type Worker = {
  run(
    payload: Record<string, unknown>,
    ctx: { attempt: number; job: JobRow },
  ): Promise<void>;
}["run"];

/** Queue a background job. With `dedupeKey`, a second enqueue is a no-op (returns null). */
export async function enqueueJob(
  tx: Tx | null,
  kind: JobQueueKind,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<{ id: number } | null> {
  const exec = tx ?? db;
  const rows = await exec
    .insert(jobQueue)
    .values({
      kind,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobQueue.dedupeKey })
    .returning({ id: jobQueue.id });
  return rows[0] ?? null;
}

/** Backoff after `attempts` failures: 30 s × 4^(n-1), capped at 6 h, with ±20 % jitter. */
export function queueBackoffMs(attempts: number, random = Math.random): number {
  const base = Math.min(6 * 3600_000, 30_000 * 4 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

export interface QueueRunResult {
  ran: number;
  failed: number;
  dead: number;
  deferred: number;
}

/** Claim up to `limit` due jobs atomically (SKIP LOCKED; safe across instances). */
async function claim(limit: number, kinds?: string[]): Promise<JobRow[]> {
  const kindFilter = kinds?.length
    ? sql`and kind in (${sql.join(
        kinds.map((k) => sql`${k}`),
        sql`, `,
      )})`
    : sql``;
  const rows = await execRows<Record<string, unknown>>(sql`
    update job_queue set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from job_queue
      where status = 'queued' and run_at <= now() ${kindFilter}
      order by run_at, id
      limit ${limit}
      for update skip locked
    )
    returning id`);
  const ids = rows.map((r) => Number(r.id));
  if (ids.length === 0) return [];
  return db.select().from(jobQueue).where(inArray(jobQueue.id, ids));
}

/** Run due jobs until none are left or the time budget is spent. */
export async function runQueue(
  opts: { timeBudgetMs?: number; batchSize?: number; kinds?: string[] } = {},
): Promise<QueueRunResult> {
  const budget = opts.timeBudgetMs ?? 20_000;
  const started = Date.now();
  const result: QueueRunResult = { ran: 0, failed: 0, dead: 0, deferred: 0 };
  await reclaimStale();
  const { getWorker } = await import("./workers");
  while (Date.now() - started < budget) {
    const batch = await claim(opts.batchSize ?? 10, opts.kinds);
    if (batch.length === 0) break;
    for (const job of batch) {
      const worker = await getWorker(job.kind);
      if (!worker) {
        // No worker yet (owner hasn't shipped it): park for 15 min without burning an attempt.
        await db
          .update(jobQueue)
          .set({
            status: "queued",
            attempts: sql`greatest(${jobQueue.attempts} - 1, 0)`,
            runAt: new Date(Date.now() + 15 * 60_000),
            lockedAt: null,
            lastError: `no worker registered for kind "${job.kind}"`,
          })
          .where(eq(jobQueue.id, job.id));
        result.deferred++;
        continue;
      }
      try {
        await worker(job.payload, { attempt: job.attempts, job });
        await db
          .update(jobQueue)
          .set({
            status: "done",
            finishedAt: new Date(),
            lockedAt: null,
            lastError: null,
          })
          .where(eq(jobQueue.id, job.id));
        result.ran++;
      } catch (err) {
        const message = (
          err instanceof Error ? err.message : String(err)
        ).slice(0, 1000);
        const retryAfterMs = (err as { retryAfterMs?: number })?.retryAfterMs;
        const dead = job.attempts >= job.maxAttempts;
        await db
          .update(jobQueue)
          .set(
            dead
              ? {
                  status: "dead",
                  finishedAt: new Date(),
                  lockedAt: null,
                  lastError: message,
                }
              : {
                  status: "queued",
                  lockedAt: null,
                  lastError: message,
                  runAt: new Date(
                    Date.now() + (retryAfterMs ?? queueBackoffMs(job.attempts)),
                  ),
                },
          )
          .where(eq(jobQueue.id, job.id));
        if (dead) result.dead++;
        else result.failed++;
        console.error(
          `[queue] ${job.kind}#${job.id} attempt ${job.attempts} failed:`,
          message,
        );
      }
    }
  }
  return result;
}

/** Jobs stuck in `running` for > 10 min (crashed worker) go back to the queue. */
export async function reclaimStale(): Promise<number> {
  const rows = await db
    .update(jobQueue)
    .set({ status: "queued", lockedAt: null })
    .where(
      and(
        eq(jobQueue.status, "running"),
        lt(jobQueue.lockedAt, new Date(Date.now() - 10 * 60_000)),
      ),
    )
    .returning({ id: jobQueue.id });
  return rows.length;
}

/** Delete finished jobs older than `days` (system.prune). */
export async function pruneQueue(days = 14): Promise<number> {
  const rows = await db
    .delete(jobQueue)
    .where(
      and(
        inArray(jobQueue.status, ["done", "dead"]),
        lt(jobQueue.finishedAt, new Date(Date.now() - days * 86_400_000)),
      ),
    )
    .returning({ id: jobQueue.id });
  return rows.length;
}
