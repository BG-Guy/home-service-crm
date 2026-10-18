import "server-only";
import { appUrl } from "@/lib/env";

// Our own magic links inside an already-rendered text (outbox cards, scheduled rows).
// A card rendered by another process — the demo seed runs separately, often on the
// default http://localhost:3000 — would otherwise text a customer a dead link
// (QA T2-17). The token path is kept; only the origin is swapped for this APP_URL.

const OWN_LINK =
  /\bhttps?:\/\/[^\s/?#]+(\/(?:j|e|i|p|r|t|s|f)\/[A-Za-z0-9_-]{8,}[^\s]*)/g;

/** Rewrite our token links (`/j/…`, `/i/…`, `/f/<key>` …) onto the current APP_URL. */
export function rebaseAppLinks(body: string, base: string = appUrl()): string {
  if (!body.includes("://")) return body;
  return body.replace(OWN_LINK, (match, path: string) =>
    match.startsWith(`${base}/`) ? match : `${base}${path}`,
  );
}
