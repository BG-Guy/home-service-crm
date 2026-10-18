import "server-only";
import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, type Tx, withAdvisoryLock } from "@/db";
import { events } from "@/db/schema";
import { currentActor, currentContext, runWithContext } from "./context";
import type {
  DomainEvent,
  EventMap,
  EventPayload,
  EventType,
} from "./event-types";
import { newId } from "./ids";
import { type Actor, type EntityRef, SYSTEM_ACTOR } from "./types";

// Transactional outbox (SPEC §3.1, §7.1; BUILD_PLAN §7.0).
//  - emit(tx, type, entity, payload) inserts into `events` in the caller's transaction.
//  - processEvents() (after() + cron tick) dispatches each event to every registered
//    handler (src/features/*/events.ts `handlers`, plus registerHandler()). Each handler
//    runs in its own transaction and MUST be idempotent: a failed event is retried
//    with exponential backoff until every handler has succeeded, then dead-lettered.

export type {
  DomainEvent,
  EventBase,
  EventMap,
  EventPayload,
  EventType,
} from "./event-types";
export { EVENT_TYPES } from "./event-types";

/** Handler registration (BUILD_PLAN §4). `name` = '<module>.<what>', unique. */
export interface HandlerReg {
  event: EventType | "*";
  name: string;
  run(
    // biome-ignore lint/suspicious/noExplicitAny: handlers receive any event shape for '*'
    e: DomainEvent<any>,
    ctx: {
      tx: Tx;
      /** This pass's clock: the wall clock, or the tick's injected `now` (tests, QA fake clock). */
      now: Date;
    },
  ): Promise<void>;
}

/** Explicitly-ignored event types (coverage check; BUILD_PLAN §7.2 last paragraph). */
export interface IgnoreReg {
  ignore: EventType;
  reason: string;
}

export const EVENTS_LOCK_KEY = 4_242_042;
export const MAX_EVENT_ATTEMPTS = 8;

// ------------------------------------------------------------------ emit

let pendingHint = false;

/**
 * Insert a domain event in the SAME transaction as the domain write. The base
 * fields { id, at, actor_user_id } are added; actor defaults to the current
 * action/handler context. The emitter also writes its own activity row.
 */
export async function emit<E extends EventType>(
  tx: Tx,
  type: E,
  entity: EntityRef | null,
  payload: EventMap[E] & { actor_user_id?: string | null },
  opts: { actor?: Actor } = {},
): Promise<void> {
  const actorUserId =
    payload.actor_user_id !== undefined
      ? payload.actor_user_id
      : ((opts.actor ?? currentActor())?.userId ?? null);
  const full = {
    ...payload,
    id: newId(),
    at: new Date().toISOString(),
    actor_user_id: actorUserId,
  } as EventPayload<E>;
  await tx.insert(events).values({
    type,
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
    payload: full as unknown as Record<string, unknown>,
    actorUserId,
  });
  pendingHint = true;
  const ctx = currentContext();
  if (ctx) ctx.emitted = true;
}

/** True if this process emitted events since the last processEvents() run (cheap after() guard). */
export function hasPendingHint(): boolean {
  return pendingHint;
}

// ------------------------------------------------------------------ handler registry

const g = globalThis as typeof globalThis & {
  __crmExtraHandlers?: Map<string, HandlerReg>;
};
function extraHandlers(): Map<string, HandlerReg> {
  g.__crmExtraHandlers ??= new Map();
  return g.__crmExtraHandlers;
}

/** Register a handler at runtime (tests, ad-hoc). Module handlers belong in events.ts. */
export function registerHandler(h: HandlerReg): () => void {
  extraHandlers().set(h.name, h);
  return () => {
    extraHandlers().delete(h.name);
  };
}

/** All handlers: every module's events.ts `handlers` + runtime registrations. */
export async function getHandlers(): Promise<HandlerReg[]> {
  const { moduleHandlers } = await import("./event-handlers");
  const byName = new Map<string, HandlerReg>();
  for (const h of moduleHandlers()) byName.set(h.name, h);
  for (const h of extraHandlers().values()) byName.set(h.name, h);
  return [...byName.values()];
}

/** Event types with no handler and no explicit ignore (should be empty once B5's '*' engine ships). */
export async function uncoveredEvents(): Promise<EventType[]> {
  const { EVENT_TYPES } = await import("./event-types");
  const { moduleIgnores } = await import("./event-handlers");
  const hs = await getHandlers();
  if (hs.some((h) => h.event === "*")) return [];
  const covered = new Set<string>([
    ...hs.map((h) => h.event),
    ...moduleIgnores().map((i) => i.ignore),
  ]);
  return EVENT_TYPES.filter((t) => !covered.has(t));
}

// ------------------------------------------------------------------ processor

interface RetryState {
  message?: string;
  done?: string[];
  failed?: { name: string; error: string }[];
  nextAt?: string;
  dead?: boolean;
}

function parseState(error: string | null): RetryState {
  if (!error) return {};
  try {
    const v = JSON.parse(error) as RetryState;
    return v && typeof v === "object" ? v : { message: error };
  } catch {
    return { message: error };
  }
}

/** Backoff after `attempts` failures: 1, 2, 4 … minutes, capped at 60. */
export function eventBackoffMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

export interface ProcessResult {
  processed: number;
  failed: number;
  dead: number;
  skipped: boolean;
}

/**
 * Dispatch unprocessed events to handlers. Safe to call concurrently (advisory lock:
 * a second caller returns `skipped`). Loops until the queue is drained or the time
 * budget is spent (handlers may emit follow-up events).
 */
export async function processEvents(
  opts: { timeBudgetMs?: number; batchSize?: number; now?: () => Date } = {},
): Promise<ProcessResult> {
  const budget = opts.timeBudgetMs ?? 10_000;
  const batchSize = opts.batchSize ?? 100;
  const now = opts.now ?? (() => new Date());
  const result: ProcessResult = {
    processed: 0,
    failed: 0,
    dead: 0,
    skipped: false,
  };
  pendingHint = false;

  const locked = await withAdvisoryLock(EVENTS_LOCK_KEY, async () => {
    const started = Date.now();
    const handlers = await getHandlers();
    // Keyset cursor: rows still in backoff are skipped, not re-read, so a page full
    // of failing events can never starve newer ones. Follow-up events emitted by
    // handlers get higher ids and are picked up by later pages of the same run.
    let cursor = 0;
    for (;;) {
      if (Date.now() - started > budget) break;
      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            isNull(events.processedAt),
            lt(events.attempts, MAX_EVENT_ATTEMPTS),
            gt(events.id, cursor),
          ),
        )
        .orderBy(asc(events.id))
        .limit(batchSize);
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]?.id ?? cursor;
      const ready = rows.filter((r) => {
        const st = parseState(r.error);
        return !st.nextAt || new Date(st.nextAt).getTime() <= now().getTime();
      });
      for (const row of ready) {
        if (Date.now() - started > budget) break;
        const outcome = await dispatchOne(row, handlers, now());
        if (outcome === "ok") result.processed++;
        else if (outcome === "dead") result.dead++;
        else result.failed++;
      }
    }
  });
  if (!locked.acquired) result.skipped = true;
  return result;
}

type EventRow = typeof events.$inferSelect;

async function dispatchOne(
  row: EventRow,
  handlers: HandlerReg[],
  at: Date,
): Promise<"ok" | "failed" | "dead"> {
  const state = parseState(row.error);
  const done = new Set(state.done ?? []);
  const evt: DomainEvent = {
    id: row.id,
    type: row.type as EventType,
    entity:
      row.entityType && row.entityId
        ? ({ type: row.entityType, id: row.entityId } as EntityRef)
        : null,
    payload: row.payload as unknown as EventPayload<EventType>,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
  const matching = handlers.filter(
    (h) => (h.event === row.type || h.event === "*") && !done.has(h.name),
  );
  const failed: { name: string; error: string }[] = [];
  for (const h of matching) {
    try {
      await runWithContext({ actor: SYSTEM_ACTOR }, () =>
        db.transaction(async (tx) => {
          await h.run(evt, { tx, now: at });
        }),
      );
      done.add(h.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ name: h.name, error: message.slice(0, 500) });
      console.error(
        `[events] handler ${h.name} failed on #${row.id} ${row.type}:`,
        err,
      );
    }
  }
  const attempts = row.attempts + 1;
  if (failed.length === 0) {
    await db
      .update(events)
      .set({ processedAt: at, attempts, error: null })
      .where(eq(events.id, row.id));
    return "ok";
  }
  const dead = attempts >= MAX_EVENT_ATTEMPTS;
  const next: RetryState = {
    message: failed
      .map((f) => `${f.name}: ${f.error}`)
      .join("; ")
      .slice(0, 1000),
    done: [...done],
    failed,
    nextAt: new Date(at.getTime() + eventBackoffMs(attempts)).toISOString(),
    dead,
  };
  await db
    .update(events)
    .set({ attempts, error: JSON.stringify(next) })
    .where(eq(events.id, row.id));
  return dead ? "dead" : "failed";
}

// ------------------------------------------------------------------ dead letters

/** Events that exhausted their retries (attempts ≥ MAX, still unprocessed). */
export async function listDeadEvents(limit = 50): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.processedAt),
        sql`${events.attempts} >= ${MAX_EVENT_ATTEMPTS}`,
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit);
}

/** Re-queue a dead event (keeps the list of handlers that already succeeded). */
export async function retryDeadEvent(id: number): Promise<void> {
  const [row] = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  if (!row || row.processedAt) return;
  const st = parseState(row.error);
  await db
    .update(events)
    .set({
      attempts: 0,
      error: JSON.stringify({ ...st, nextAt: undefined, dead: false }),
    })
    .where(eq(events.id, id));
}

/**
 * Schedule processEvents() after the response (Next `after()`), falling back to a
 * detached promise outside a request scope (scripts, tests).
 */
export async function processEventsSoon(): Promise<void> {
  if (process.env.CRM_DISABLE_BACKGROUND === "1") return;
  const run = () =>
    processEvents().catch((err) =>
      console.error("[events] processEvents failed:", err),
    );
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    void run();
  }
}
