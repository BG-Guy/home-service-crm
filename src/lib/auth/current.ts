import "server-only";
import "@/db/seed/register";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { type Perm, resolvePerms, toBaseRole } from "../permissions";
import { loadPermSubject } from "../permissions-db";
import type { Actor, SessionUser } from "../types";
import {
  findSession,
  readSessionCookie,
  requestMeta,
  touchSession,
} from "./session";

// Current user (BUILD_PLAN §2): React cache() per request; permissions are re-read on
// every request (SPEC §4.1), so grid/override changes apply immediately.

/** Build a SessionUser for a user id (also used by tests and the cron/system paths). */
export async function loadSessionUser(
  userId: string,
  sessionId: string,
): Promise<SessionUser | null> {
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      workerType: users.workerType,
      usesCompanyTools: users.usesCompanyTools,
      usesCompanyVehicle: users.usesCompanyVehicle,
      monitoringNoticeAckAt: users.monitoringNoticeAckAt,
      baseRole: roles.baseRole,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(eq(users.id, userId))
    .limit(1);
  if (!u || u.status !== "active") return null;
  const subject = await loadPermSubject(u.id, u.role);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    firstName: u.name.trim().split(/\s+/)[0] ?? u.name,
    role: u.role,
    baseRole: toBaseRole(u.baseRole ?? u.role),
    status: u.status,
    workerType: u.workerType === "w2" ? "w2" : "1099",
    usesCompanyTools: u.usesCompanyTools,
    usesCompanyVehicle: u.usesCompanyVehicle,
    monitoringNoticeAckAt: u.monitoringNoticeAckAt,
    perms: resolvePerms(subject),
    sessionId,
  };
}

/** The signed-in user for this request, or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieValue = await readSessionCookie();
  if (!cookieValue) return null;
  const session = await findSession(cookieValue);
  if (!session) return null;
  const user = await loadSessionUser(session.userId, session.id);
  if (!user) return null;
  // Sliding expiry: refresh last_seen_at/expires_at after the response (≤ every 5 min).
  if (Date.now() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
    const touch = () => touchSession(session).catch(() => undefined);
    try {
      const { after } = await import("next/server");
      after(touch);
    } catch {
      void touch();
    }
  }
  return user;
});

function normalizePerms(perm?: Perm | readonly Perm[]): readonly Perm[] {
  if (!perm) return [];
  return Array.isArray(perm) ? perm : [perm as Perm];
}

/**
 * Pages, queries and actions: redirect to /login when signed out; throw ForbiddenError
 * when a required permission is missing. An array means ALL of the permissions.
 */
export async function requireUser(
  perm?: Perm | readonly Perm[],
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  for (const p of normalizePerms(perm)) {
    if (!user.perms.has(p)) throw new ForbiddenError(undefined, p);
  }
  return user;
}

/** Like requireUser, but at least ONE of the permissions is enough. */
export async function requireAnyPerm(
  perms: readonly Perm[],
): Promise<SessionUser> {
  const user = await requireUser();
  if (perms.length && !perms.some((p) => user.perms.has(p)))
    throw new ForbiddenError(undefined, perms.join("|"));
  return user;
}

/** Route handlers: throw UnauthorizedError (→ 401) instead of redirecting. */
export async function requireApiUser(
  perm?: Perm | readonly Perm[],
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  for (const p of normalizePerms(perm)) {
    if (!user.perms.has(p)) throw new ForbiddenError(undefined, p);
  }
  return user;
}

/** Does `user` hold `perm`? */
export function can(user: SessionUser | null | undefined, perm: Perm): boolean {
  return !!user && user.perms.has(perm);
}

/** Actor for audit/events from a session user (+ request ip/UA when available). */
export function actorOf(
  user: SessionUser,
  meta?: { ip?: string | null; userAgent?: string | null },
): Actor {
  return {
    kind: "user",
    userId: user.id,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  };
}

/** actorOf() with the current request's ip/UA filled in. */
export async function requestActor(user: SessionUser): Promise<Actor> {
  return actorOf(user, await requestMeta());
}
