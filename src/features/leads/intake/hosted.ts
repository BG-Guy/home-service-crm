// Hosted form helpers (no server-only imports needed; pure).

const PASS_THROUGH =
  /^(utm_[a-z_]{1,30}|gclid|gbraid|wbraid|fbclid|msclkid|referrer|landing_url)$/i;

/**
 * Attribution fields to carry from the hosted form URL into hidden inputs
 * (e.g. `/f/pk_…?utm_source=google&gclid=…`). Values are length-capped.
 */
export function processLeadFormFields(
  sp: Record<string, string | string[] | undefined>,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, raw] of Object.entries(sp)) {
    if (!PASS_THROUGH.test(k)) continue;
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === "string" && v.trim())
      out.push([k.toLowerCase(), v.trim().slice(0, 500)]);
    if (out.length >= 15) break;
  }
  return out;
}
