import "server-only";
import { ConfigError } from "./errors";

// Environment helpers (SPEC §2 env table). Every var is optional in development;
// production requires APP_URL, SESSION_SECRET and CRON_SECRET.

export const isProd = process.env.NODE_ENV === "production";

const DEV_SESSION_SECRET =
  "dev-insecure-session-secret-change-me-in-production";
let warned = false;

/** HMAC/HKDF root secret. Throws in production when missing. */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (isProd && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new ConfigError(
      "SESSION_SECRET must be set (≥ 16 chars) in production",
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[env] SESSION_SECRET not set; using an insecure development secret",
    );
  }
  return DEV_SESSION_SECRET;
}

/**
 * Production settings that are missing or invalid (env var names; [] in dev).
 * `fatal`: the app can't work safely (boot refuses to start, health is 503).
 */
export function configProblems(): { fatal: string[]; warnings: string[] } {
  if (!isProd) return { fatal: [], warnings: [] };
  const fatal: string[] = [];
  const warnings: string[] = [];
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) fatal.push("SESSION_SECRET");
  if (!process.env.APP_URL && !process.env.VERCEL_URL) warnings.push("APP_URL");
  if (!process.env.CRON_SECRET) warnings.push("CRON_SECRET");
  return { fatal, warnings };
}

/** Absolute base URL for links in messages (no trailing slash). */
export function appUrl(path = ""): string {
  const base = (
    process.env.APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  ).replace(/\/+$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function appVersion(): string {
  return (
    process.env.APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    "dev"
  );
}
