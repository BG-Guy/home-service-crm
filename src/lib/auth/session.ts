import "server-only";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { sessions } from "@/db/schema";
import { clientIpFromHeaders } from "../client-ip";
import { generateToken, hashToken } from "../tokens";
import {
  formatSessionCookie,
  parseSessionCookie,
  REMEMBER_TTL_MS,
  SESSION_TTL_MS,
  secureCookiesEnabled,
  sessionCookieName,
} from "./cookie-name";

// DB sessions (SPEC M01, §6.2): 32 random bytes base64url; the DB stores only
// sha256(token). Sliding expiry: 30 days with "remember me", otherwise 12 hours;
// last_seen_at/expires_at are refreshed at most every 5 minutes (after()).

export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionRow = typeof sessions.$inferSelect;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export function sessionTtlMs(remember: boolean): number {
  return remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
}

/** Insert a session; returns the cookie value (shown once) and the row id. */
export async function createSession(
  tx: Tx,
  userId: string,
  opts: { remember: boolean } & RequestMeta,
): Promise<{
  cookieValue: string;
  sessionId: string;
  expiresAt: Date;
  remember: boolean;
}> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + sessionTtlMs(opts.remember));
  const [row] = await tx
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      remember: opts.remember,
      expiresAt,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 400) ?? null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("session insert failed");
  return {
    cookieValue: formatSessionCookie(token, opts.remember),
    sessionId: row.id,
    expiresAt,
    remember: opts.remember,
  };
}

/** Find a live (not revoked, not expired) session by cookie value. */
export async function findSession(
  cookieValue: string | null | undefined,
): Promise<SessionRow | null> {
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed) return null;
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(parsed.token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Slide the expiry and bump last_seen_at (call via after(); cheap no-op within 5 min). */
export async function touchSession(
  s: Pick<SessionRow, "id" | "remember" | "lastSeenAt">,
): Promise<boolean> {
  if (Date.now() - s.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return false;
  await db
    .update(sessions)
    .set({
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + sessionTtlMs(s.remember)),
    })
    .where(and(eq(sessions.id, s.id), isNull(sessions.revokedAt)));
  return true;
}

export async function revokeSession(tx: Tx, sessionId: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Revoke every live session of a user ("sign out other devices", deactivation, password reset). */
export async function revokeAllSessions(
  tx: Tx,
  userId: string,
  opts: { exceptSessionId?: string } = {},
): Promise<number> {
  const conds = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (opts.exceptSessionId) conds.push(ne(sessions.id, opts.exceptSessionId));
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(...conds))
    .returning({ id: sessions.id });
  return rows.length;
}

/** Delete long-expired/revoked sessions (system.prune). */
export async function pruneSessions(olderThanDays = 30): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(
      sql`coalesce(${sessions.revokedAt}, ${sessions.expiresAt}) < now() - make_interval(days => ${olderThanDays})`,
    )
    .returning({ id: sessions.id });
  return rows.length;
}

// ------------------------------------------------------------------ cookies (request scope)

/** Set the session cookie (Server Actions / Route Handlers only). */
export async function setSessionCookie(
  cookieValue: string,
  remember: boolean,
  expiresAt: Date,
): Promise<void> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const secure = secureCookiesEnabled();
  store.set(sessionCookieName(secure), cookieValue, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(remember ? { expires: expiresAt } : {}),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const secure = secureCookiesEnabled();
  // A bare delete(name) emits no Secure/Path, and browsers reject that for a
  // `__Host-` cookie, so the cookie would survive sign-out. Repeat the attributes.
  store.set(sessionCookieName(secure), "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

/** Read the raw session cookie value for this request (null outside a request). */
export async function readSessionCookie(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(sessionCookieName(secureCookiesEnabled()))?.value ?? null;
  } catch {
    return null;
  }
}

/** Client IP + user agent of the current request (best effort). */
export async function requestMeta(): Promise<RequestMeta> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return { ip: clientIpFromHeaders(h), userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}
