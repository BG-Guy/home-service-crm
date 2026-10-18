import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { type SQL, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Pool } from "pg";

/**
 * Database access (docs/SPEC.md §2, §6).
 *
 * - `DATABASE_URL` set  → node-postgres Pool (max 5) + `attachDatabasePool` on Vercel.
 * - otherwise           → PGlite in `PGLITE_DIR` (default ./.data/pglite), migrated automatically.
 *
 * `db` is lazy: nothing connects until the first query. Every query is gated on
 * `ensureDb()`, which (once per process) applies migrations (always on PGlite; on
 * Postgres only when DB_MIGRATE_ON_BOOT=1) and runs registered boot hooks
 * (e.g. the idempotent base seed). Core query builder only — no relational API.
 */

/** Driver-agnostic Drizzle database type used by all app code. */
export type DB = PgDatabase<PgQueryResultHKT>;
/** Transaction handle passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];
/**
 * What every data-access / api function accepts (BUILD_PLAN §2): the db itself or an
 * open transaction. Seeds pass `db`; actions pass their transaction.
 */
export type Tx = DB | DbTransaction;
/** Anything that can run a query: the db or a transaction (alias of `Tx`). */
export type Executor = Tx;

/** Run `fn` inside a transaction (BUILD_PLAN §2). Keep it short on PGlite. */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}

export type BootHook = (db: DB) => Promise<void>;

type DriverKind = "pglite" | "pg";

interface DbState {
  kind: DriverKind;
  db: DB;
  /** Un-gated drizzle instance over the raw client (migrations only). */
  rawDb: DB;
  pglite?: PGlite;
  pool?: Pool;
  done: Set<string>;
  migrated: boolean;
  /** Last boot promise (resolved once booted). */
  boot: Promise<void> | null;
  booting: boolean;
  heldLocks: Set<string>;
  /** PGlite close in progress (shutdown or closeDb), so it runs once. */
  closing?: Promise<void>;
}

const BOOT_LOCK_KEY = 4_242_001;
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Marks async work that runs inside the boot sequence (bypasses the gate). */
const bootContext = new AsyncLocalStorage<true>();

const g = globalThis as typeof globalThis & {
  __crmDb?: DbState;
  __crmDbHooks?: Map<string, { fn: BootHook; order: number; seq: number }>;
  /** Shutdown hooks installed (once per process, survives HMR re-evaluation). */
  __crmDbShutdown?: boolean;
};

// Hooks may be registered before the db is first touched; keep them on globalThis
// so HMR re-evaluation of modules does not duplicate or lose them.
function hookRegistry() {
  g.__crmDbHooks ??= new Map();
  return g.__crmDbHooks;
}

let hookSeq = 0;

/**
 * Register an idempotent function to run once per process after migrations and
 * before any other query (e.g. `registerBootHook('base-seed', seedBase)`).
 * Re-registering the same name replaces the function (HMR-safe) without re-running it.
 * Hooks run in ascending `order`, then registration order.
 */
export function registerBootHook(
  name: string,
  fn: BootHook,
  opts: { order?: number } = {},
): void {
  const reg = hookRegistry();
  const existing = reg.get(name);
  reg.set(name, {
    fn,
    order: opts.order ?? existing?.order ?? 100,
    seq: existing?.seq ?? hookSeq++,
  });
}

function pendingHooks(s: DbState) {
  return [...hookRegistry().entries()]
    .filter(([name]) => !s.done.has(name))
    .sort((a, b) => a[1].order - b[1].order || a[1].seq - b[1].seq);
}

function gate(): Promise<void> | undefined {
  if (bootContext.getStore()) return undefined;
  return ensureDb();
}

/** Wrap a client so the listed async methods await `ensureDb()` first. */
function gated<T extends object>(target: T, methods: readonly string[]): T {
  const wrapped = new Set(methods);
  return new Proxy(target, {
    get(t, prop, _receiver) {
      const value = Reflect.get(t, prop, t);
      if (typeof value !== "function" || prop === "constructor") return value;
      if (typeof prop === "string" && wrapped.has(prop)) {
        return async (...args: unknown[]) => {
          await gate();
          return (value as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(t);
    },
  });
}

function resolvePgliteDir(): string {
  const dir = process.env.PGLITE_DIR || "./.data/pglite";
  // Runtime-only path (dev data dir): keep it out of output file tracing.
  return path.isAbsolute(dir)
    ? dir
    : path.join(/* turbopackIgnore: true */ process.cwd(), dir);
}

function createState(): DbState {
  const base = {
    done: new Set<string>(),
    migrated: false,
    boot: null,
    booting: false,
    heldLocks: new Set<string>(),
  };

  const url = process.env.DATABASE_URL;
  if (url) {
    // Lazy requires keep the unused driver out of the module graph's hot path.
    const { Pool: PgPool } = require("pg") as typeof import("pg");
    const { drizzle } =
      require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
    const pool = new PgPool({ connectionString: url, max: 5 });
    if (process.env.VERCEL) {
      try {
        const { attachDatabasePool } =
          require("@vercel/functions") as typeof import("@vercel/functions");
        attachDatabasePool(pool);
      } catch {
        // harmless outside Vercel
      }
    }
    const client = gated(pool, ["query", "connect"]);
    return {
      ...base,
      kind: "pg",
      pool,
      db: drizzle({ client }) as unknown as DB,
      rawDb: drizzle({ client: pool }) as unknown as DB,
    };
  }

  const { PGlite: PGliteCtor } =
    require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle } =
    require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const dir = resolvePgliteDir();
  mkdirSync(path.dirname(dir), { recursive: true });
  const pglite = new PGliteCtor(dir);
  installPgliteShutdown();
  const client = gated(pglite, ["query", "exec", "transaction", "sql"]);
  return {
    ...base,
    kind: "pglite",
    pglite,
    db: drizzle({ client }) as unknown as DB,
    rawDb: drizzle({ client: pglite }) as unknown as DB,
  };
}

function state(): DbState {
  g.__crmDb ??= createState();
  return g.__crmDb;
}

/** Which driver is active ("pglite" in zero-config dev, "pg" with DATABASE_URL). */
export function dbKind(): DriverKind {
  return process.env.DATABASE_URL ? "pg" : "pglite";
}

async function migrateIfNeeded(s: DbState): Promise<void> {
  if (s.migrated) return;
  if (s.kind === "pglite") {
    const { migrate } =
      require("drizzle-orm/pglite/migrator") as typeof import("drizzle-orm/pglite/migrator");
    await migrate(s.rawDb as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else if (process.env.DB_MIGRATE_ON_BOOT === "1") {
    const { migrate } =
      require("drizzle-orm/node-postgres/migrator") as typeof import("drizzle-orm/node-postgres/migrator");
    await migrate(s.rawDb as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
  s.migrated = true;
}

async function runBoot(s: DbState): Promise<void> {
  await bootContext.run(true, async () => {
    const work = async () => {
      await migrateIfNeeded(s);
      for (const [name, hook] of pendingHooks(s)) {
        await hook.fn(s.db);
        s.done.add(name);
      }
    };
    if (s.kind === "pg" && s.pool) {
      // Serialize boot across instances (cold starts) with a blocking session lock.
      const conn = await s.pool.connect();
      try {
        await conn.query("select pg_advisory_lock($1::bigint)", [
          BOOT_LOCK_KEY,
        ]);
        try {
          await work();
        } finally {
          await conn.query("select pg_advisory_unlock($1::bigint)", [
            BOOT_LOCK_KEY,
          ]);
        }
      } finally {
        conn.release();
      }
    } else {
      await work();
    }
  });
}

/**
 * Apply migrations and run pending boot hooks (once per process; cheap afterwards).
 * Called automatically before the first query; call it explicitly from scripts or
 * `instrumentation.ts` to boot eagerly.
 */
export function ensureDb(): Promise<void> {
  const s = state();
  // Fast path: booted and no hooks registered since.
  if (
    s.boot &&
    (s.booting || (s.migrated && hookRegistry().size === s.done.size))
  ) {
    return s.boot;
  }
  const prev = s.boot ?? Promise.resolve();
  s.booting = true;
  const next: Promise<void> = prev
    .catch(() => undefined)
    .then(() => runBoot(s))
    .then(
      () => {
        if (s.boot === next) s.booting = false;
      },
      (err: unknown) => {
        // allow a retry on the next call
        if (s.boot === next) {
          s.boot = null;
          s.booting = false;
        }
        throw err;
      },
    );
  s.boot = next;
  return next;
}

/**
 * Active transaction of the current async context (set by `db.transaction`).
 * PGlite has ONE connection: a query on the global `db` issued while a transaction is
 * open (e.g. a cached getSettings() inside an action) would wait for that transaction
 * forever. So inside a `db.transaction(...)` callback, `db.*` is routed to the open
 * transaction (on Postgres this also makes such reads transactionally consistent).
 */
const txContext = new AsyncLocalStorage<{ tx: DbTransaction; done: boolean }>();

function activeTx(): DbTransaction | null {
  const store = txContext.getStore();
  return store && !store.done ? store.tx : null;
}

function wrapTransaction(base: DB | DbTransaction): DB["transaction"] {
  const run = base.transaction.bind(base) as DB["transaction"];
  return ((fn: (tx: DbTransaction) => Promise<unknown>, config?: unknown) =>
    run(async (tx) => {
      const store = { tx, done: false };
      try {
        return await txContext.run(store, () => fn(tx));
      } finally {
        store.done = true;
      }
    }, config as never)) as DB["transaction"];
}

/** The app database (lazy; first query triggers `ensureDb()`). */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const tx = activeTx();
    if (prop === "transaction") return wrapTransaction(tx ?? state().db);
    const real = (tx ?? state().db) as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, prop, real);
    if (typeof value === "function" && prop !== "constructor") {
      return (value as (...a: unknown[]) => unknown).bind(real);
    }
    return value;
  },
  has(_t, prop) {
    return prop in (state().db as object);
  },
  getPrototypeOf() {
    return Object.getPrototypeOf(state().db);
  },
});

/** Run a raw SQL query and return its rows (both drivers expose `.rows`). */
export async function execRows<T = Record<string, unknown>>(
  query: SQL,
  executor: Executor = db,
): Promise<T[]> {
  const result = (await executor.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/**
 * Cross-instance mutex (e.g. the cron tick uses key 42, SPEC §3.1).
 * Uses a session-level `pg_try_advisory_lock` on a dedicated connection (Postgres)
 * or the single PGlite connection, plus an in-process guard (advisory locks are
 * re-entrant within one session). Never waits: returns `{ acquired: false }` if held.
 * Do NOT hold a long `db.transaction` inside `fn` on PGlite — it serializes all queries.
 */
export async function withAdvisoryLock<T>(
  key: number | bigint,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  await ensureDb();
  const s = state();
  const k = String(key);
  if (s.heldLocks.has(k)) return { acquired: false };
  s.heldLocks.add(k);
  try {
    if (s.kind === "pg" && s.pool) {
      const conn = await s.pool.connect();
      try {
        const res = await conn.query<{ ok: boolean }>(
          "select pg_try_advisory_lock($1::bigint) as ok",
          [k],
        );
        if (!res.rows[0]?.ok) return { acquired: false };
        try {
          return { acquired: true, value: await fn() };
        } finally {
          await conn.query("select pg_advisory_unlock($1::bigint)", [k]);
        }
      } finally {
        conn.release();
      }
    }
    const pg = s.pglite as PGlite;
    const res = await pg.query<{ ok: boolean }>(
      "select pg_try_advisory_lock($1::bigint) as ok",
      [k],
    );
    if (!res.rows[0]?.ok) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await pg.query("select pg_advisory_unlock($1::bigint)", [k]);
    }
  } finally {
    s.heldLocks.delete(k);
  }
}

/**
 * Transaction-scoped advisory lock (released at commit/rollback). Returns false if
 * another transaction holds it. Use inside `db.transaction(async (tx) => …)`.
 */
export async function tryAdvisoryXactLock(
  tx: Executor,
  key: number | bigint,
): Promise<boolean> {
  const rows = await execRows<{ ok: boolean }>(
    sql`select pg_try_advisory_xact_lock(${String(key)}::bigint) as ok`,
    tx,
  );
  return rows[0]?.ok === true;
}

/** Close the underlying client (scripts/tests). The next query reopens a fresh one. */
export async function closeDb(): Promise<void> {
  const s = g.__crmDb;
  if (!s) return;
  g.__crmDb = undefined;
  if (s.pool) await s.pool.end();
  if (s.pglite) await closePglite(s);
}

const PGLITE_CLOSE_TIMEOUT_MS = 5_000;
/** Fallback exit when another signal listener (Next) never calls process.exit. */
const SHUTDOWN_FALLBACK_MS = 10_000;

/** Close a state's PGlite once (bounded wait; logs instead of throwing). */
function closePglite(s: DbState): Promise<void> {
  const pg = s.pglite;
  if (!pg || pg.closed) return Promise.resolve();
  s.closing ??= Promise.race([
    pg.close(),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        console.error(
          `[db] PGlite did not close within ${PGLITE_CLOSE_TIMEOUT_MS} ms`,
        );
        resolve();
      }, PGLITE_CLOSE_TIMEOUT_MS).unref();
    }),
  ]).catch((err: unknown) => {
    console.error("[db] closing PGlite failed:", err);
  });
  return s.closing;
}

/**
 * Dev data safety (QA2 re-check): PGlite writes its data dir from inside this process,
 * so a `next start` / `next dev` / script stopped with SIGINT or SIGTERM must close it
 * cleanly, or the dir may not open again ("RuntimeError: Aborted()"). Installed once
 * per process (globalThis flag, so HMR can't stack handlers), PGlite driver only; the
 * Postgres pool path is unchanged.
 * - Signal: process.exit() is held until PGlite is closed. When another listener owns
 *   the shutdown (Next drains requests, then exits 128+n), it simply exits later than
 *   it would have; otherwise this handler exits with 128+n itself. A fallback timer
 *   exits if nobody does.
 * - beforeExit (a script that didn't call closeDb): close it so the process ends
 *   cleanly. Scripts and tests that call closeDb() exit as before.
 */
function installPgliteShutdown(): void {
  if (g.__crmDbShutdown) return;
  g.__crmDbShutdown = true;
  const closeOpen = () => {
    const s = g.__crmDb;
    return s ? closePglite(s) : Promise.resolve();
  };
  const realExit = process.exit.bind(process);
  let held = false;
  const holdExit = () => {
    if (held) return;
    held = true;
    process.exit = ((code?: number | string | null) => {
      void closeOpen().finally(() => realExit(code ?? undefined));
      return undefined as never;
    }) as typeof process.exit;
  };
  for (const [sig, n] of [
    ["SIGINT", 2],
    ["SIGTERM", 15],
  ] as const) {
    process.on(sig, () => {
      holdExit();
      if (process.listenerCount(sig) > 1) {
        setTimeout(() => process.exit(128 + n), SHUTDOWN_FALLBACK_MS);
        return;
      }
      process.exit(128 + n);
    });
  }
  process.on("beforeExit", () => {
    void closeOpen();
  });
}
