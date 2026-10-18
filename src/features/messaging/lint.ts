// Client-safe text rules for messages and templates (SPEC M12). Pure.
//  - GSM-7 lint + segment count (wraps lib/template smsSegments)
//  - own-domain link rule (public shorteners are rejected in templates)
//  - "Reply STOP to opt out" footer
//  - inbound keyword classification (STOP/START/HELP, C/R replies, natural-language opt-outs)
import { smsSegments, toGsmSafe } from "@/lib/template";

export { smsSegments, toGsmSafe };

// ------------------------------------------------------------------ GSM-7

export interface GsmLint {
  segments: number;
  encoding: "GSM-7" | "UCS-2";
  units: number;
  /** Characters that force UCS-2 (emoji, curly quotes…). */
  nonGsmChars: string[];
  /** Characters with an automatic GSM-safe replacement (curly quotes, dashes…). */
  fixable: string[];
  warnings: string[];
}

export function gsmLint(text: string): GsmLint {
  const s = smsSegments(text);
  const fixable = s.nonGsmChars.filter((c) => toGsmSafe(c) !== c);
  const warnings: string[] = [];
  if (s.encoding === "UCS-2")
    warnings.push(
      `Contains ${s.nonGsmChars.map((c) => `"${c}"`).join(" ")} — the text switches to UCS-2 (70 characters per segment).`,
    );
  if (s.segments > 3)
    warnings.push(
      `${s.segments} segments — long texts cost more and may arrive split.`,
    );
  return {
    segments: s.segments,
    encoding: s.encoding,
    units: s.units,
    nonGsmChars: s.nonGsmChars,
    fixable,
    warnings,
  };
}

// ------------------------------------------------------------------ links

/** Public URL shorteners (carriers filter them; SPEC M12 own-domain rule). */
export const SHORTENER_HOSTS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "tiny.cc",
  "bl.ink",
  "lnkd.in",
  "short.io",
  "s.id",
] as const;

/** Hosts allowed in template text besides the app's own (review targets, maps). */
export const ALLOWED_EXTERNAL_HOSTS = ["g.page", "search.google.com"] as const;

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;

function hostOf(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface LinkIssue {
  url: string;
  reason: "shortener" | "external";
}

/**
 * Literal links in template text. Links should come from variables (`{{job.link}}`,
 * `{{review.link}}` …) which always point at the app's own domain. Shorteners are
 * rejected; other external domains are flagged.
 */
export function lintLinks(text: string, appHost?: string | null): LinkIssue[] {
  const own = appHost ? hostOf(appHost) : null;
  const out: LinkIssue[] = [];
  const stripped = text.replace(/\{\{[^}]*\}\}/g, " ");
  for (const m of stripped.matchAll(URL_RE)) {
    const url = m[1] ?? "";
    // Skip things like "e.g." or decimals that the loose regex can catch.
    if (!/[a-z]{2,}$/i.test(url.split("/")[0] ?? "")) continue;
    const host = hostOf(url);
    if (!host) continue;
    if (own && (host === own || host.endsWith(`.${own}`))) continue;
    if ((SHORTENER_HOSTS as readonly string[]).includes(host))
      out.push({ url, reason: "shortener" });
    else if (
      !(ALLOWED_EXTERNAL_HOSTS as readonly string[]).some(
        (h) => host === h || host.endsWith(`.${h}`),
      )
    )
      out.push({ url, reason: "external" });
  }
  return out;
}

// ------------------------------------------------------------------ STOP footer

export const STOP_FOOTER = "Reply STOP to opt out.";

/** Append the opt-out footer unless the text already mentions STOP. */
export function withStopFooter(body: string): string {
  if (/\bSTOP\b/.test(body)) return body;
  const trimmed = body.trimEnd();
  return `${trimmed}${/[.!?]$/.test(trimmed) ? " " : ". "}${STOP_FOOTER}`;
}

// ------------------------------------------------------------------ inbound

export const STOP_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
  "OPT OUT",
] as const;
export const START_KEYWORDS = ["START", "YES", "UNSTOP"] as const;
export const HELP_KEYWORDS = ["HELP", "INFO"] as const;

const NL_OPTOUT: readonly [RegExp, number][] = [
  [
    /\b(stop|quit|don'?t|do not|no more)\b.{0,20}\b(text|texting|messag|sms)/i,
    0.9,
  ],
  [/\bwrong (number|person)\b/i, 0.85],
  [/\bremove me\b|\btake me off\b|\bunsubscribe me\b/i, 0.9],
  [/\bleave me alone\b|\bstop contacting\b|\bnot interested\b/i, 0.7],
  [/\b(who is this|who'?s this)\b/i, 0.4],
];

export type InboundKind =
  | "stop"
  | "start"
  | "help"
  | "confirm"
  | "reschedule"
  | "optout_nl"
  | "other";

export interface InboundClass {
  kind: InboundKind;
  /** 0–1; keywords are 1. */
  confidence: number;
}

/**
 * Classify an inbound reply. Exact keywords (whole message, case-insensitive,
 * punctuation ignored) win; then the C/R appointment replies; then natural-language
 * opt-out phrases, which are only *flagged* for one-tap review (never auto-applied).
 */
export function classifyInbound(body: string): InboundClass {
  const norm = body
    .trim()
    .replace(/[.!?,;:"'()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if ((STOP_KEYWORDS as readonly string[]).includes(norm))
    return { kind: "stop", confidence: 1 };
  if ((START_KEYWORDS as readonly string[]).includes(norm))
    return { kind: "start", confidence: 1 };
  if ((HELP_KEYWORDS as readonly string[]).includes(norm))
    return { kind: "help", confidence: 1 };
  if (norm === "C" || norm === "CONFIRM" || norm === "CONFIRMED")
    return { kind: "confirm", confidence: 1 };
  if (norm === "R" || norm === "RESCHEDULE")
    return { kind: "reschedule", confidence: 1 };
  let best = 0;
  for (const [re, conf] of NL_OPTOUT)
    if (re.test(body)) best = Math.max(best, conf);
  if (best >= 0.5) return { kind: "optout_nl", confidence: best };
  return { kind: "other", confidence: 0 };
}
