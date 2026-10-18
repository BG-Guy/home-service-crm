// Contact masking shared by customers, jobs and documents (SPEC §4.2, QA T5-11).
// Pure and client-safe. Outside the viewer's contact window people see enough to
// plan the day (street name, city, ZIP; last 4 phone digits) but not the exact
// location or a way to reach the customer directly.

/** "•••• 0100" (last 4 digits only). */
export function maskPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "••••";
}

/** "j•••@example.com". */
export function maskEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const [user, domain] = e.split("@");
  if (!domain) return "•••";
  return `${(user ?? "").slice(0, 1)}•••@${domain}`;
}

/**
 * Street with the house and unit numbers hidden ("123 Oak St Apt 4" → "••• Oak St"):
 * what a tech sees outside the job's contact window. City/state/ZIP stay visible.
 */
export function maskStreet(s: string | null | undefined): string {
  if (!s) return "";
  const out = s
    .trim()
    .replace(
      /\s*(?:,\s*)?(?:\b(?:apt|apartment|unit|ste|suite|lot|bldg)\b\.?|#)\s*[\w-]+.*$/i,
      "",
    )
    .replace(/^\d[\w-]*(?:\s+\d+\/\d+)?\s*/, "")
    .trim();
  return out ? `••• ${out}` : "•••";
}

// ------------------------------------------------------------------ message text

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const SUFFIX =
  "St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|Trail|Loop|Sq|Square|Row|Run|Pike|Plz|Plaza";
const UNIT = String.raw`(?:,?\s*(?:apt|apartment|unit|ste|suite|lot|bldg|#)\.?\s*[\w-]+)?`;
/**
 * A house number, up to four capitalized (or numbered) words and a street suffix:
 * "3943 Airport Blvd", "12 N Lamar St Apt 4". Lowercase words in between stop it,
 * so "Oct 24 at 3943 Airport Blvd" only matches the address.
 */
const STREET_RE = new RegExp(
  String.raw`\b\d{1,6}[A-Za-z]?(?:-\d+)?\s+(?:[A-Z0-9][\w'.-]*\s+){0,4}(?:${SUFFIX})\b\.?${UNIT}`,
  "g",
);
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const CODE_RE =
  /\b((?:gate|door|lock\s?box|alarm|access|garage|entry|key)?\s*code\s*(?:is|:|#|=)?\s*)([A-Za-z0-9*#-]{3,})/gi;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "3943 Airport Blvd Apt 4" → "••• Airport Blvd" (every leading number goes). */
function maskStreetSpan(span: string): string {
  const noUnit = span.replace(new RegExp(`${UNIT}$`, "i"), "");
  const rest = noUnit.replace(/^(?:\d+[A-Za-z]?(?:-\d+)?\s+)+/, "").trim();
  return rest ? `••• ${rest}` : "•••";
}

/**
 * Message text for a viewer outside the customer's contact window (QA2 NEW-3): the
 * thread must not give away what the customer and job pages mask. Links are dropped
 * (a /j/ link opens the job portal with the full address), house numbers and units
 * go (the customer's own streets by value, any other address by shape), and phone
 * numbers, email addresses and gate/door codes are masked. Pure; client-safe.
 */
export function redactMessageText(
  text: string,
  known: { streets?: readonly (string | null | undefined)[] } = {},
): string {
  if (!text) return text;
  let out = text.replace(URL_RE, "[link hidden]");
  for (const street of known.streets ?? []) {
    const s = street?.trim();
    if (!s || !/\d/.test(s)) continue;
    const re = new RegExp(
      `${escapeRe(s).replace(/\s+/g, "\\s+")}${UNIT}`,
      "gi",
    );
    out = out.replace(re, maskStreet(s));
  }
  return out
    .replace(STREET_RE, (m) => maskStreetSpan(m))
    .replace(EMAIL_RE, (m) => maskEmail(m) ?? "•••")
    .replace(PHONE_RE, (m) => maskPhone(m) ?? "••••")
    .replace(CODE_RE, (_m, lead: string) => `${lead}•••`);
}
