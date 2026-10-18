// Client IP behind a reverse proxy (QA T5-13). Per-IP rate limits and audit IPs
// must not trust a header the client can write: the leftmost X-Forwarded-For is
// whatever the caller sent. TRUST_PROXY says which hop to believe:
//
//   (unset) | "1"   one proxy (Caddy/nginx, Vercel) appends the client: rightmost XFF
//   "2", "3", …     that many proxies: the n-th entry from the right
//   "cloudflare"    Cloudflare in front: cf-connecting-ip
//   "x-real-ip"     the proxy sets X-Real-IP to the peer address
//   "none" | "0"    no proxy: no header is trusted (ip = null)
//
// Pure (no server-only): used by lib/http (route handlers) and auth/session.

type HeaderSource = { get(name: string): string | null };

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function clean(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // "[::1]:443" → "::1"; "1.2.3.4:5678" → "1.2.3.4"
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket?.[1]) s = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, "");
  return IP_RE.test(s) ? s : null;
}

/** Pick the client IP from request headers under a TRUST_PROXY mode. */
export function pickClientIp(
  h: HeaderSource,
  mode: string | undefined = process.env.TRUST_PROXY,
): string | null {
  const m = (mode ?? "").trim().toLowerCase();
  if (m === "none" || m === "0" || m === "false") return null;
  if (m === "cloudflare") return clean(h.get("cf-connecting-ip"));
  if (m === "x-real-ip") return clean(h.get("x-real-ip"));
  const hops = m === "" || m === "true" ? 1 : Number.parseInt(m, 10);
  if (!Number.isFinite(hops) || hops < 1) return null;
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (chain.length === 0) return clean(h.get("x-real-ip"));
  // Never fall off the left end: with fewer entries than hops, the leftmost
  // entry is the best we have (it came through every trusted proxy).
  return clean(chain[Math.max(0, chain.length - hops)]);
}

/** Client IP from a Headers object (pages: `await headers()`). */
export function clientIpFromHeaders(h: HeaderSource): string | null {
  return pickClientIp(h);
}
