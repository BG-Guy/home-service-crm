import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedLead } from "./normalize";

// Spam defense (SPEC M04, §8.3 step 3). Hard checks (honeypot, a tampered or too-fast
// `_ts`, Turnstile) mark a lead as spam; soft signals (including a missing `_ts`) only
// raise `spam_score` so no real lead is lost.

export const TS_MIN_AGE_MS = 3_000;
export const TS_MAX_AGE_MS = 24 * 3600_000;

function tsSig(secret: string, publicKey: string, ms: number): string {
  return createHmac("sha256", secret)
    .update(`lead-ts:${publicKey}:${ms}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Signed render timestamp: `<ms>.<sig>` bound to the source's public key. */
export function signTs(
  secret: string,
  publicKey: string,
  now = Date.now(),
): string {
  return `${now}.${tsSig(secret, publicKey, now)}`;
}

export type TsCheck =
  | "ok"
  | "missing"
  | "malformed"
  | "bad_signature"
  | "too_fast"
  | "expired";

export function verifyTs(
  secret: string,
  publicKey: string,
  ts: string | null | undefined,
  now = Date.now(),
): TsCheck {
  if (!ts) return "missing";
  const m = /^(\d{12,14})\.([\w-]{22})$/.exec(ts.trim());
  if (!m) return "malformed";
  const ms = Number(m[1]);
  const want = Buffer.from(tsSig(secret, publicKey, ms));
  const got = Buffer.from(m[2] as string);
  if (want.length !== got.length || !timingSafeEqual(want, got))
    return "bad_signature";
  const age = now - ms;
  if (age < TS_MIN_AGE_MS) return "too_fast";
  if (age > TS_MAX_AGE_MS) return "expired";
  return "ok";
}

export interface TsVerdict {
  /** Hard spam: stored with status `spam`, no customer, fake success to the sender. */
  spam: boolean;
  reason: string | null;
  /**
   * Soft signal: not spam, but the lead goes to "Check" (spam score raised to the
   * review threshold) so a person looks at it before a customer is created.
   */
  review?: string;
}

/**
 * `_ts` rule (QA2 T2-03/T2-04, lead decision). A *missing* `_ts` is never hard spam:
 * embed.js may be blocked or slow, or the owner pasted the plain HTML form, and real
 * leads must not vanish. On a source that requires `_ts` it only sends the lead to
 * "Check". An expired `_ts` (tab left open > 24 h) is also a review signal. A tampered
 * (malformed / bad signature) or too-fast `_ts` stays hard spam.
 */
export function tsVerdict(check: TsCheck, requireTs: boolean): TsVerdict {
  if (check === "ok") return { spam: false, reason: null };
  if (check === "missing")
    return requireTs
      ? { spam: false, reason: null, review: "ts_missing" }
      : { spam: false, reason: null };
  if (check === "expired")
    return { spam: false, reason: null, review: "ts_expired" };
  return { spam: true, reason: `ts_${check}` };
}

/** Points a `_ts` review signal adds; the score is also raised to the review threshold. */
export const TS_REVIEW_POINTS = 50;

/** Fold a `_ts` review signal into the soft score so the lead lands in "Check". */
export function applyTsReview(
  soft: SpamScore,
  review: string | null | undefined,
  threshold: number,
): SpamScore {
  if (!review) return soft;
  return {
    score: Math.min(
      100,
      Math.max(soft.score + TS_REVIEW_POINTS, Math.max(0, threshold)),
    ),
    reasons: [...soft.reasons, review],
  };
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/** "asdkjh qwrtzp" style names: long consonant runs, no vowels, or digits mixed in. */
export function looksGibberish(name: string | null | undefined): boolean {
  if (!name) return false;
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return false;
  return words.some(
    (w) =>
      /[bcdfghjklmnpqrstvwxz]{5,}/.test(w) ||
      (w.length >= 6 && !/[aeiouy]/.test(w)) ||
      /\d/.test(w) ||
      /(.)\1{3,}/.test(w),
  );
}

export interface SpamScore {
  score: number;
  reasons: string[];
}

/** Soft spam score 0–100 (§M04): URLs in notes, no contact, non-US phone, gibberish name. */
export function scoreLead(
  l: Pick<NormalizedLead, "name" | "phone" | "phoneIsUs" | "email" | "notes">,
): SpamScore {
  const reasons: string[] = [];
  let score = 0;
  const urls = (l.notes ?? "").match(URL_RE)?.length ?? 0;
  if (urls > 2) {
    score += 40;
    reasons.push("many_urls");
  } else if (urls > 0 && !l.phone) {
    score += 15;
    reasons.push("url_no_phone");
  }
  if (!l.phone && !l.email) {
    score += 40;
    reasons.push("no_contact");
  }
  if (l.phone && !l.phoneIsUs) {
    score += 25;
    reasons.push("non_us_phone");
  }
  if (looksGibberish(l.name)) {
    score += 30;
    reasons.push("gibberish_name");
  }
  if (l.name && /(?:https?:\/\/|www\.)\S+/i.test(l.name)) {
    score += 30;
    reasons.push("url_in_name");
  }
  if (/[Ѐ-ӿ一-鿿]/.test(`${l.name ?? ""}${l.notes ?? ""}`)) {
    score += 15;
    reasons.push("foreign_script");
  }
  return { score: Math.min(100, score), reasons };
}
