import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Hashing helpers (server only). Content hashes for evidence (photos, signatures,
// policy versions, invoice snapshots) are lowercase hex SHA-256.

export type Bytes = string | Uint8Array;

export function sha256Hex(data: Bytes): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256Base64url(data: Bytes): string {
  return createHash("sha256").update(data).digest("base64url");
}

export function hmacSha256Hex(key: Bytes, data: Bytes): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

export function hmacSha256Base64url(key: Bytes, data: Bytes): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

/** Constant-time string comparison (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verify an HMAC-SHA256 hex signature in constant time. */
export function verifyHmacSha256Hex(
  key: Bytes,
  data: Bytes,
  signatureHex: string,
): boolean {
  return safeEqual(hmacSha256Hex(key, data), signatureHex.toLowerCase());
}

/**
 * Deterministic JSON (sorted keys) for hashing document snapshots, so the same
 * content always yields the same sha256.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return v;
  });
}

/** sha256 hex of a JSON snapshot (stable key order). */
export function sha256Json(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

// BUILD_PLAN §2 names (aliases): sha256(x) hex and canonicalJson(x) (sorted keys).
export const sha256 = sha256Hex;
export const canonicalJson = stableStringify;
