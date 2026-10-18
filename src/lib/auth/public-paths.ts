// Routes reachable without a session (used by src/proxy.ts; no server imports).
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/invite/",
  "/reset",
  "/offline",
  "/sms-terms",
  "/privacy",
  "/j/",
  "/e/",
  "/i/",
  "/p/",
  "/r/",
  "/t/",
  "/f/",
  "/s/",
  "/dev/",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/")
      ? pathname.startsWith(p)
      : pathname === p || pathname.startsWith(`${p}/`),
  );
}
