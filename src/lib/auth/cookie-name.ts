// Session cookie naming (lead-engineer amendment 5). Shared by src/proxy.ts (no DB,
// no server-only imports allowed there) and the session code.
//  - production / https: `__Host-sid` (Secure, Path=/, no Domain)
//  - development over http://localhost: `sid`
// Cookie value: `r.<token>` (remember me, 30-day sliding) or `s.<token>` (browser
// session, 12-hour sliding in the DB). Only sha256(<token>) is stored server-side.

export const SECURE_SESSION_COOKIE = "__Host-sid";
export const DEV_SESSION_COOKIE = "sid";

export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function secureCookiesEnabled(
  env: {
    NODE_ENV?: string;
    APP_URL?: string;
    COOKIE_INSECURE?: string;
  } = process.env,
): boolean {
  if (env.COOKIE_INSECURE === "1") return false;
  return (
    env.NODE_ENV === "production" || (env.APP_URL ?? "").startsWith("https://")
  );
}

export function sessionCookieName(secure = secureCookiesEnabled()): string {
  return secure ? SECURE_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

/** Split a cookie value into its remember flag and raw token. */
export function parseSessionCookie(
  value: string | null | undefined,
): { remember: boolean; token: string } | null {
  if (!value) return null;
  const m = /^([rs])\.([A-Za-z0-9_-]{32,128})$/.exec(value);
  if (!m) return null;
  return { remember: m[1] === "r", token: m[2] as string };
}

export function formatSessionCookie(token: string, remember: boolean): string {
  return `${remember ? "r" : "s"}.${token}`;
}
