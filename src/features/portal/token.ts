import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import type { PublicTokenKind } from "@/db/enums";
import { publicTokens } from "@/db/schema";
import { requestMeta } from "@/lib/auth/session";
import { RateLimitedError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import {
  hashToken,
  logPortalAccess,
  type PortalAction,
  type PublicTokenRow,
  resolvePublicToken,
} from "@/lib/tokens";
import type { Actor } from "@/lib/types";

// Magic-link plumbing for the B3 portal pages (/j /e /i) and their public actions
// (SPEC M23): per-IP rate limit (settings.portal.rate_limit_per_minute, default
// 60/min), token resolution with portal_access_log, and a public_token actor.

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** True when the caller is within the per-IP portal budget (fails open without an IP). */
export async function portalRateOk(): Promise<boolean> {
  const { ip } = await requestMeta();
  if (!ip) return true;
  const limit = (await getSettings()).portal.rate_limit_per_minute;
  const r = await rateLimit({
    key: `portal:${ip}`,
    limit,
    windowSec: 60,
    store: "memory",
  });
  return r.ok;
}

/** Throwing variant for public actions. */
export async function assertPortalRate(): Promise<void> {
  if (!(await portalRateOk())) throw new RateLimitedError(60);
}

/**
 * Page load: validate + log ("viewed" by default). Returns null for unknown,
 * expired or revoked tokens and when rate-limited (the page shows "link expired").
 */
export async function openPortalToken(
  kind: PublicTokenKind,
  token: string,
  path: string,
  action: PortalAction = "viewed",
): Promise<PublicTokenRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  if (!(await portalRateOk())) return null;
  const meta = await requestMeta();
  return resolvePublicToken(kind, token, {
    path,
    action,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** Validate without logging or counting a use (upload helpers, re-checks). */
export async function peekPublicToken(
  kinds: readonly PublicTokenKind[],
  token: string,
): Promise<PublicTokenRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select()
    .from(publicTokens)
    .where(
      and(
        eq(publicTokens.tokenHash, hashToken(token)),
        isNull(publicTokens.revokedAt),
        gt(publicTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row || !kinds.includes(row.kind as PublicTokenKind)) return null;
  return row;
}

/** Log a portal action (signed, approved, declined, …) against a token. */
export async function logPortal(
  row: PublicTokenRow,
  path: string,
  action: PortalAction,
): Promise<void> {
  const meta = await requestMeta();
  await logPortalAccess(row.id, {
    path,
    action,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** Actor for writes made through a magic link. */
export async function portalActor(row: PublicTokenRow): Promise<Actor> {
  const meta = await requestMeta();
  return {
    kind: "public_token",
    userId: null,
    tokenId: row.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}
