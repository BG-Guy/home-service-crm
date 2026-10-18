import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { eq, inArray, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import {
  company,
  rolePermissions,
  roles,
  userPermissionOverrides,
  users,
} from "@/db/schema";
import { type EventMap, type EventType, emit } from "@/lib/events";
import {
  effective,
  type Perm,
  type PermEffect,
  toBaseRole,
} from "@/lib/permissions";
import { type CompanySettings, parseSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { Actor, EntityRef } from "@/lib/types";

// Shared B6 server helpers. Everything here takes an executor so it can run INSIDE a
// transaction: PGlite has a single connection, so a `db` query issued while a
// transaction is open would wait forever on the transaction mutex.

/** Settings read through `exec` (no React cache, no row lock). */
export async function settingsOf(exec: Tx = db): Promise<CompanySettings> {
  const [row] = await exec
    .select({ settings: company.settings })
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  return parseSettings(row?.settings ?? {});
}

/** Company time zone through `exec`. */
export async function companyTz(exec: Tx = db): Promise<string> {
  const [row] = await exec
    .select({ tz: company.timezone })
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  return row?.tz ?? "America/New_York";
}

export async function companyName(exec: Tx = db): Promise<string> {
  const [row] = await exec
    .select({ name: company.name })
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  return row?.name ?? "Company";
}

export function todayKey(tz: string, now: Date = new Date()): string {
  return dateKey(now, tz);
}

/** Effective permission check through `exec` (role grid + overrides). */
export async function userHasPerm(
  exec: Tx,
  userId: string,
  perm: Perm,
): Promise<boolean> {
  const [u] = await exec
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u || u.status !== "active") return false;
  const [r] = await exec
    .select({ baseRole: roles.baseRole })
    .from(roles)
    .where(eq(roles.key, u.role))
    .limit(1);
  const grid = await exec
    .select({ perm: rolePermissions.perm, granted: rolePermissions.granted })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, u.role));
  const ov = await exec
    .select({
      perm: userPermissionOverrides.perm,
      effect: userPermissionOverrides.effect,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
  return effective(
    {
      role: u.role,
      baseRole: toBaseRole(r?.baseRole ?? u.role),
      roleGrid: Object.fromEntries(grid.map((g) => [g.perm, g.granted])),
      overrides: Object.fromEntries(
        ov.map((o) => [o.perm, o.effect as PermEffect]),
      ),
    },
    perm,
  );
}

/** Active users holding `perm` (through `exec`; safe inside a transaction). */
export async function usersWithPerm(exec: Tx, perm: Perm): Promise<string[]> {
  const rows = await exec
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.status, "active"));
  const out: string[] = [];
  for (const r of rows) if (await userHasPerm(exec, r.id, perm)) out.push(r.id);
  return out;
}

export async function userNames(
  exec: Tx,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await exec
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** `uuid[]` literal for raw SQL `= any(...)`. */
export function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );
}

export { execRows };

// ------------------------------------------------------------------ quiet mode (seeds)
// Seeds must never emit events (BUILD_PLAN §10.1) but drive B6's own engine
// (recompute, settlements, payouts). Inside runQuietly() the B6 server code skips
// emit() and cross-module side effects that would emit (job close).

const quiet = new AsyncLocalStorage<boolean>();

export function runQuietly<T>(fn: () => Promise<T>): Promise<T> {
  return quiet.run(true, fn);
}

export function isQuiet(): boolean {
  return quiet.getStore() === true;
}

/** emit() unless running quietly (seed). */
export async function emitB6<E extends EventType>(
  tx: Tx,
  type: E,
  entity: EntityRef | null,
  payload: EventMap[E],
  opts: { actor?: Actor } = {},
): Promise<void> {
  if (isQuiet()) return;
  await emit(tx, type, entity, payload, opts);
}
