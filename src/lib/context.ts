import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor, SessionUser } from "./types";

// Per-operation context (actor of the current action / handler / cron hook).
// `emit()`, `writeAudit()` and `writeActivity()` fall back to it when no actor is passed.

export interface OpContext {
  actor: Actor;
  user?: SessionUser | null;
  /** Set by emit() so callers know to schedule processEvents(). */
  emitted?: boolean;
}

const als = new AsyncLocalStorage<OpContext>();

export function runWithContext<T>(
  ctx: OpContext,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(ctx, fn);
}

export function currentContext(): OpContext | undefined {
  return als.getStore();
}

export function currentActor(): Actor | undefined {
  return als.getStore()?.actor;
}
