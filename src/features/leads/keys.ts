import "server-only";
import { randomBytes } from "node:crypto";
import { sessionSecret } from "@/lib/env";
import { safeEqual, sha256Hex } from "@/lib/hash";
import { getSecret } from "@/lib/secrets";

// Lead-source keys (SPEC §6.3 lead_sources, M04):
//   pk_live_…  public site key (not secret; stored in clear, embedded in forms)
//   sk_live_…  per-source server secret (sha256 stored; shown once)
//   hk_…       preset hook path secret (sha256 stored; shown once)
//   sk_live_…  general API keys live in `api_keys` (sha256 stored; shown once)

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function randomToken(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[(bytes[i] as number) % 62];
  return out;
}

export const newPublicKey = () => `pk_live_${randomToken(20)}`;
export const newSecretKey = () => `sk_live_${randomToken(32)}`;
export const newHookSecret = () => `hk_${randomToken(32)}`;
export const hashKey = (k: string) => sha256Hex(k.trim());
export const keyMatches = (k: string, hash: string | null | undefined) =>
  !!hash && safeEqual(hashKey(k), hash);

/** Server secret for `_ts` HMACs (derived from SESSION_SECRET; never leaves the server). */
export function tsSecret(): string {
  return sha256Hex(`lead-ts:${sessionSecret()}`);
}

/** Cloudflare Turnstile site key (public) — env `TURNSTILE_SITE_KEY`. */
export function turnstileSiteKey(): string | null {
  return (
    process.env.TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    null
  );
}

/**
 * Verify a Turnstile token. Returns 'ok' | 'fail', or 'unconfigured' when no secret is
 * set (we then accept the lead instead of silently dropping it).
 */
export async function verifyTurnstile(
  token: string | null,
  ip: string | null,
): Promise<"ok" | "fail" | "unconfigured"> {
  const secret = await getSecret("TURNSTILE_SECRET");
  if (!secret) return "unconfigured";
  if (!token) return "fail";
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body, signal: ctrl.signal },
    );
    clearTimeout(timer);
    const json = (await res.json()) as { success?: boolean };
    return json.success ? "ok" : "fail";
  } catch {
    // Network trouble on our side must not cost a real lead.
    return "unconfigured";
  }
}
