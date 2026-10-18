import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import type { PublicTokenKind } from "@/db/enums";
import { portalAccessLog, publicTokens } from "@/db/schema";
import { appUrl, sessionSecret } from "./env";
import { hmacSha256Base64url, safeEqual, sha256Hex } from "./hash";
import type { EntityRef } from "./types";

// Random secrets for sessions, invites, password resets, public (magic-link) tokens
// and API keys. Only the SHA-256 hex of a token is stored (`*_hash` columns);
// the raw token is shown/sent once.

/** URL-safe random token (base64url, no padding). 32 bytes ≈ 43 chars, 256 bits. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Storage hash for a token: sha256 hex (e.g. sessions.token_hash). */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Generate a token and its storage hash together. */
export function newTokenPair(bytes = 32): { token: string; hash: string } {
  const token = generateToken(bytes);
  return { token, hash: hashToken(token) };
}

/** Constant-time check of a presented token against a stored hash. */
export function verifyToken(token: string, storedHash: string): boolean {
  return safeEqual(hashToken(token), storedHash);
}

export interface ApiKey {
  /** Full secret shown once, e.g. 'sk_live_3Jf…'. */
  key: string;
  /** Non-secret display prefix stored in api_keys.prefix, e.g. 'sk_live_3Jf9'. */
  prefix: string;
  /** sha256 hex stored in api_keys.key_hash / lead_sources.secret_hash. */
  hash: string;
}

/** Secret API key with a recognizable prefix ('sk_live_' by default). */
export function generateApiKey(kind = "sk_live_", bytes = 24): ApiKey {
  const key = `${kind}${generateToken(bytes)}`;
  return { key, prefix: key.slice(0, kind.length + 4), hash: hashToken(key) };
}

/** Public (non-secret) key for lead forms, e.g. 'pk_live_…'. */
export function generatePublicKey(kind = "pk_live_", bytes = 12): string {
  return `${kind}${generateToken(bytes)}`;
}

/** Short numeric code (e.g. for verbal confirmation), uniformly random. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(digits, "0");
  }
}

// ------------------------------------------------------------------ public magic links
// (SPEC M23; BUILD_PLAN §2 tokens.ts) — added by F2. Tokens are 32 random bytes,
// sha256-hashed at rest, minted per send, expiring; every hit is logged.

export type PortalAction =
  | "viewed"
  | "signed"
  | "approved"
  | "declined"
  | "pay_opened"
  | "paid"
  | "confirmed"
  | "reschedule_requested"
  | "rated"
  | "clicked"
  | "receipt_flagged";

export type PublicTokenRow = typeof publicTokens.$inferSelect;

const DAY = 86_400_000;

/** Default lifetimes (SPEC M23). Callers pass `expiresAt` when the rule is relative (e.g. job: completion + 30 d). */
export const TOKEN_TTL: Record<PublicTokenKind, number> = {
  job: 30 * DAY,
  estimate: 30 * DAY,
  invoice: 180 * DAY,
  pay: 7 * DAY,
  review: 30 * DAY,
  tracking: 3 * 3600_000,
  sub_job: 7 * DAY,
};

export const TOKEN_PATH: Record<PublicTokenKind, string> = {
  job: "/j/",
  estimate: "/e/",
  invoice: "/i/",
  pay: "/p/",
  review: "/r/",
  tracking: "/t/",
  sub_job: "/s/",
};

/** Mint a magic link. The raw token appears only in the returned url (never stored or emitted). */
export async function mintPublicToken(
  tx: Tx,
  i: {
    kind: PublicTokenKind;
    entity: EntityRef;
    customerId?: string | null;
    jobId?: string | null;
    expiresAt?: Date;
  },
): Promise<{ token: string; tokenId: string; url: string }> {
  const { token, hash } = newTokenPair(32);
  const [row] = await tx
    .insert(publicTokens)
    .values({
      tokenHash: hash,
      kind: i.kind,
      entityType: i.entity.type,
      entityId: i.entity.id,
      customerId: i.customerId ?? null,
      jobId: i.jobId ?? null,
      expiresAt: i.expiresAt ?? new Date(Date.now() + TOKEN_TTL[i.kind]),
    })
    .returning({ id: publicTokens.id });
  if (!row) throw new Error("public token insert failed");
  return {
    token,
    tokenId: row.id,
    url: appUrl(`${TOKEN_PATH[i.kind]}${token}`),
  };
}

/**
 * Like mintPublicToken, but the same (kind, entity, customer, job, purpose) gets the
 * same link for a while, so re-rendering a page (e.g. the printed invoice's pay QR)
 * doesn't mint a new row each view (QA T4-28).
 *
 * The token is an HMAC of those fields and a time bucket under a key derived from
 * SESSION_SECRET: unguessable without the secret, and still stored only as its
 * sha256. Buckets are half the lifetime, so a returned link has between ttl/2 and
 * ttl left. `reused` is true when the bucket's row already existed. A revoked
 * token for the bucket falls back to a fresh random one.
 */
export async function mintOrReusePublicToken(
  tx: Tx,
  i: {
    kind: PublicTokenKind;
    entity: EntityRef;
    customerId?: string | null;
    jobId?: string | null;
    /** Distinguishes uses of the same entity, e.g. "invoice.print". */
    purpose: string;
    /** Lifetime; default TOKEN_TTL[kind]. */
    ttlMs?: number;
  },
  now: Date = new Date(),
): Promise<{ token: string; tokenId: string; url: string; reused: boolean }> {
  const ttl = i.ttlMs ?? TOKEN_TTL[i.kind];
  const bucketMs = Math.max(60_000, Math.floor(ttl / 2));
  const bucketStart = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const expiresAt = new Date(bucketStart + ttl);
  const token = hmacSha256Base64url(
    sessionSecret(),
    [
      "public-token-reuse/v1",
      i.kind,
      i.purpose,
      i.entity.type,
      i.entity.id,
      i.customerId ?? "",
      i.jobId ?? "",
      String(bucketStart),
    ].join("\n"),
  );
  const hash = hashToken(token);
  const url = appUrl(`${TOKEN_PATH[i.kind]}${token}`);
  const [inserted] = await tx
    .insert(publicTokens)
    .values({
      tokenHash: hash,
      kind: i.kind,
      entityType: i.entity.type,
      entityId: i.entity.id,
      customerId: i.customerId ?? null,
      jobId: i.jobId ?? null,
      expiresAt,
    })
    .onConflictDoNothing({ target: publicTokens.tokenHash })
    .returning({ id: publicTokens.id });
  if (inserted) return { token, tokenId: inserted.id, url, reused: false };
  const [row] = await tx
    .select({
      id: publicTokens.id,
      revokedAt: publicTokens.revokedAt,
      expiresAt: publicTokens.expiresAt,
    })
    .from(publicTokens)
    .where(eq(publicTokens.tokenHash, hash))
    .limit(1);
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) {
    const fresh = await mintPublicToken(tx, {
      kind: i.kind,
      entity: i.entity,
      customerId: i.customerId,
      jobId: i.jobId,
      expiresAt: new Date(now.getTime() + ttl),
    });
    return { ...fresh, reused: false };
  }
  return { token, tokenId: row.id, url, reused: true };
}

/** Append a portal_access_log row (feeds `access_activity_log` dispute evidence). */
export async function logPortalAccess(
  tokenId: string,
  a: {
    path: string;
    action: PortalAction;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.insert(portalAccessLog).values({
    tokenId,
    path: a.path.slice(0, 500),
    action: a.action,
    ip: a.ip ?? null,
    userAgent: a.userAgent?.slice(0, 400) ?? null,
  });
}

/**
 * Validate a raw token for `kind`: hash match, not revoked, not expired. On success
 * increments use_count/last_used_at and logs the access. Returns null otherwise.
 */
export async function resolvePublicToken(
  kind: PublicTokenKind,
  token: string,
  log: {
    path: string;
    action: PortalAction;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<PublicTokenRow | null> {
  if (
    !token ||
    token.length < 32 ||
    token.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  )
    return null;
  const [row] = await db
    .update(publicTokens)
    .set({
      useCount: sql`${publicTokens.useCount} + 1`,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(publicTokens.tokenHash, hashToken(token)),
        eq(publicTokens.kind, kind),
        isNull(publicTokens.revokedAt),
        gt(publicTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) return null;
  await logPortalAccess(row.id, log);
  return row;
}

/** Revoke live tokens (e.g. tracking links on arrival). Returns the count. */
export async function revokePublicTokens(
  tx: Tx,
  q: { kind?: PublicTokenKind; entity?: EntityRef; jobId?: string },
): Promise<number> {
  const conds = [isNull(publicTokens.revokedAt)];
  if (q.kind) conds.push(eq(publicTokens.kind, q.kind));
  if (q.entity)
    conds.push(
      eq(publicTokens.entityType, q.entity.type),
      eq(publicTokens.entityId, q.entity.id),
    );
  if (q.jobId) conds.push(eq(publicTokens.jobId, q.jobId));
  if (conds.length === 1) return 0; // refuse to revoke everything
  const rows = await tx
    .update(publicTokens)
    .set({ revokedAt: new Date() })
    .where(and(...conds))
    .returning({ id: publicTokens.id });
  return rows.length;
}
