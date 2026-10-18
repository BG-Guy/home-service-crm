import "server-only";
import { eq } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { actionReceipts } from "@/db/schema";
import { type ActivityInput, writeActivity } from "./activity";
import { type AuditInput, redact, writeAudit } from "./audit";
import { actorOf, requireUser } from "./auth/current";
import { requestMeta } from "./auth/session";
import { type OpContext, runWithContext } from "./context";
import {
  AppError,
  FeatureDisabledError,
  ForbiddenError,
  ValidationError,
} from "./errors";
import type { EventMap, EventType } from "./event-types";
import { emit as emitEvent, processEventsSoon } from "./events";
import type { FeatureFlag } from "./flags";
import { parseMoneyToCents } from "./money";
import type { Perm } from "./permissions";
import { isEnabled } from "./settings";
import type { ActionResult, Actor, EntityRef, SessionUser } from "./types";
import { installFriendlyZodMessages } from "./zod-messages";

// "Required." instead of "Too small: expected string to have >=1 characters".
installFriendlyZodMessages();

// Server-action wrapper (SPEC §8.2 minus cache tags; BUILD_PLAN §2):
//   requireUser(perm) → feature flag → zod parse (FormData or object) → idempotency on
//   clientId → ONE db transaction around run() (domain write + events + audit +
//   activity) → revalidatePath() hints + refresh() → after(processEvents).
// Usage (in a 'use server' file):
//   export const markEnRoute = action({ perm: 'jobs.status_own', input: Schema, audit: 'job.en_route',
//     async run({ input, user, tx, emit }) { …; return { jobId } },
//     revalidate: ({ input }) => [`/jobs/${input.jobId}`, '/today'] });
// The returned function also fits useActionState: (prevState, formData) => Promise<ActionResult>.

export type { ActionResult } from "./types";

export interface ActionRunContext<I> {
  input: I;
  user: SessionUser;
  tx: Tx;
  actor: Actor;
  /** emit() bound to this transaction and actor. */
  emit<E extends EventType>(
    type: E,
    entity: EntityRef | null,
    payload: EventMap[E],
  ): Promise<void>;
  /** Write an audit row now (otherwise `cfg.audit` writes one with the redacted input). */
  audit(
    a: Omit<AuditInput, "actor" | "action"> & { action?: string },
  ): Promise<void>;
  /** Write a timeline row (actor defaults to the user). */
  activity(a: ActivityInput): Promise<void>;
  /** Add a path to revalidate after commit. */
  revalidate(path: string): void;
}

export interface ActionConfig<S extends z.ZodType, O> {
  /** Stable name for action_receipts (defaults to `audit`). */
  name?: string;
  /** Required permission(s); an array means ALL of them. */
  perm?: Perm | readonly Perm[];
  /** At least one of these permissions. */
  anyPerm?: readonly Perm[];
  /** Feature flag(s) that must be on (FeatureDisabledError otherwise). */
  feature?: FeatureFlag | readonly FeatureFlag[];
  input: S;
  /** Audit action name, e.g. 'job.en_route'. */
  audit?: string;
  /** Entity for the automatic audit row. */
  auditEntity?: (a: { input: z.output<S>; data: O }) => EntityRef | null;
  run(a: ActionRunContext<z.output<S>>): Promise<O>;
  /** Paths to revalidatePath() after commit; refresh() is always called. */
  revalidate?: (a: { input: z.output<S>; data: O }) => string[];
}

export type ServerAction<In, O> = {
  (input: In | FormData): Promise<ActionResult<O>>;
  (
    prevState: ActionResult<O> | null | undefined,
    input: In | FormData,
  ): Promise<ActionResult<O>>;
};

const GENERIC_ERROR = "Something went wrong. Please try again.";

// ------------------------------------------------------------------ FormData

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * FormData → plain object. `a.b` nests, `x[]` and repeated keys become arrays,
 * Next's `$ACTION_*` keys and empty file inputs are dropped. Values stay strings —
 * use z.coerce / zf.* helpers in schemas.
 */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of fd.entries()) {
    if (rawKey.startsWith("$ACTION")) continue;
    if (typeof value !== "string" && value.size === 0 && !value.name) continue;
    const isArray = rawKey.endsWith("[]");
    const path = (isArray ? rawKey.slice(0, -2) : rawKey).split(".");
    // Never let a field name walk into Object.prototype (`__proto__.x=1` would
    // pollute every object in the process; reachable from unauthenticated forms).
    if (path.some((seg) => UNSAFE_KEYS.has(seg))) continue;
    let cur = out;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i] as string;
      const next = cur[seg];
      if (!next || typeof next !== "object" || Array.isArray(next))
        cur[seg] = {};
      cur = cur[seg] as Record<string, unknown>;
    }
    const last = path[path.length - 1] as string;
    const existing = cur[last];
    if (isArray) {
      cur[last] = Array.isArray(existing) ? [...existing, value] : [value];
    } else if (existing !== undefined) {
      cur[last] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      cur[last] = value;
    }
  }
  return out;
}

/** zod error → { "a.b": ["message"] } (root errors under "_"). */
export function flattenZodError(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    const list = out[key] ?? [];
    list.push(issue.message);
    out[key] = list;
  }
  return out;
}

/** Map any thrown error to a failed ActionResult (never leaks internals). */
export function actionFailure(err: unknown): {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
} {
  if (err instanceof ValidationError)
    return { ok: false, error: err.userMessage, fieldErrors: err.fieldErrors };
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: flattenZodError(err),
    };
  }
  if (err instanceof AppError) return { ok: false, error: err.userMessage };
  const pgCode =
    (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  if (pgCode === "23505") return { ok: false, error: "That already exists." };
  if (pgCode === "40001" || pgCode === "40P01")
    return { ok: false, error: "Busy — please try again." };
  console.error("[action] unexpected error:", err);
  return { ok: false, error: GENERIC_ERROR };
}

function extractClientId(input: unknown): string | null {
  const v = (input as { clientId?: unknown } | null)?.clientId;
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

function toJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null));
}

async function schedulePiggyback(emitted: boolean): Promise<void> {
  if (emitted) await processEventsSoon();
  try {
    const { maybeTickSoon } = await import("./cron");
    await maybeTickSoon();
  } catch {
    // cron piggy-back is best effort
  }
}

// ------------------------------------------------------------------ action()

export function action<S extends z.ZodType, O = undefined>(
  cfg: ActionConfig<S, O>,
): ServerAction<z.input<S>, O> {
  const name = cfg.name ?? cfg.audit ?? "action";
  const flags: readonly FeatureFlag[] = cfg.feature
    ? Array.isArray(cfg.feature)
      ? cfg.feature
      : [cfg.feature as FeatureFlag]
    : [];

  async function serverAction(...args: unknown[]): Promise<ActionResult<O>> {
    const raw = args.length >= 2 ? args[1] : args[0];
    try {
      // 1. auth + permission (redirects to /login when signed out)
      const user = await requireUser(cfg.perm);
      if (cfg.anyPerm?.length && !cfg.anyPerm.some((p) => user.perms.has(p))) {
        throw new ForbiddenError(undefined, cfg.anyPerm.join("|"));
      }
      // 2. feature flags
      for (const f of flags)
        if (!(await isEnabled(f))) throw new FeatureDisabledError(f);
      // 3. validation
      const obj = raw instanceof FormData ? formDataToObject(raw) : (raw ?? {});
      const parsed = cfg.input.safeParse(obj);
      if (!parsed.success) {
        return {
          ok: false,
          error: "Please fix the highlighted fields.",
          fieldErrors: flattenZodError(parsed.error),
        };
      }
      const input = parsed.data as z.output<S>;
      // 4. idempotency (offline replays reuse the same clientId)
      const clientId = extractClientId(input);
      if (clientId) {
        const [prior] = await db
          .select()
          .from(actionReceipts)
          .where(eq(actionReceipts.clientId, clientId))
          .limit(1);
        if (prior) {
          if (prior.userId !== user.id)
            return { ok: false, error: "Duplicate request." };
          return prior.result as ActionResult<O>;
        }
      }
      // 5. one transaction: domain write + events + audit + activity (+ receipt)
      const actor = actorOf(user, await requestMeta());
      const op: OpContext = { actor, user };
      const extraPaths: string[] = [];
      const data = await runWithContext(op, () =>
        db.transaction(async (tx) => {
          let audited = false;
          const ctx: ActionRunContext<z.output<S>> = {
            input,
            user,
            tx,
            actor,
            emit: (type, entity, payload) =>
              emitEvent(tx, type, entity, payload, { actor }),
            audit: async (a) => {
              audited = true;
              await writeAudit(tx, {
                ...a,
                actor,
                action: a.action ?? cfg.audit ?? name,
              });
            },
            activity: (a) => writeActivity(tx, { actorUserId: user.id, ...a }),
            revalidate: (p) => {
              extraPaths.push(p);
            },
          };
          const out = await cfg.run(ctx);
          if (cfg.audit && !audited) {
            await writeAudit(tx, {
              actor,
              action: cfg.audit,
              entity: cfg.auditEntity?.({ input, data: out }) ?? null,
              after: redact(input),
              full: true,
            });
          }
          if (clientId) {
            await tx
              .insert(actionReceipts)
              .values({
                clientId,
                userId: user.id,
                action: name,
                result: toJson({ ok: true, data: out }) as Record<
                  string,
                  unknown
                >,
              })
              .onConflictDoNothing();
          }
          return out;
        }),
      );
      // 6. after commit: revalidate + refresh + background work
      for (const p of new Set([
        ...(cfg.revalidate?.({ input, data }) ?? []),
        ...extraPaths,
      ])) {
        try {
          revalidatePath(p);
        } catch {
          // outside a request (tests/scripts)
        }
      }
      try {
        refresh();
      } catch {
        // refresh() only works inside a Server Action request
      }
      await schedulePiggyback(op.emitted === true);
      return { ok: true, data };
    } catch (err) {
      // Domain errors first: ForbiddenError carries Next's forbidden() digest, which
      // unstable_rethrow would otherwise turn into a page-level interrupt.
      if (err instanceof AppError) return actionFailure(err);
      unstable_rethrow(err); // redirect()/notFound() from requireUser or run()
      return actionFailure(err);
    }
  }

  return serverAction as ServerAction<z.input<S>, O>;
}

// ------------------------------------------------------------------ form helpers

/** zod helpers for FormData inputs. */
export const zf = {
  /** Checkbox: 'on' | 'true' | '1' | true → true; absent → false. */
  checkbox: () =>
    z.preprocess(
      (v) => v === true || v === "on" || v === "true" || v === "1",
      z.boolean(),
    ),
  /** '' → undefined, otherwise trimmed string. */
  optionalText: (max = 5000) =>
    z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(max).optional(),
    ),
  /** Integer from a form string ('' → undefined). */
  optionalInt: () =>
    z.preprocess(
      (v) =>
        v === "" || v === null || v === undefined ? undefined : Number(v),
      z.number().int().optional(),
    ),
  /** Money string ("$1,234.50") → integer cents; "12.345" fails (no silent rounding). */
  cents: () =>
    z.preprocess(
      (v) =>
        typeof v === "string"
          ? (parseMoneyToCents(v, { strict: true }) ?? v)
          : v,
      z.number().int(),
    ),
  /** Array field that may arrive as a single value. */
  array: <T extends z.ZodType>(item: T) =>
    z.preprocess(
      (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
      z.array(item),
    ),
};
