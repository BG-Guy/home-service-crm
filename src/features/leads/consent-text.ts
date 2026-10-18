// SMS consent wording as the visitor saw it (SPEC §7.2, 10DLC): the business name is
// part of the consent, so every surface that shows the box (plain HTML snippet, embed.js
// config, hosted form) and the stored `consent_events.text_shown` use the same text.
// Pure: safe for client and server.

const LEAD_IN =
  /^I agree to receive (?:text messages|texts|SMS(?: messages)?)/i;

/** Insert the business name: "I agree to receive text messages from Acme about …". */
export function consentWithCompany(text: string, company: string): string {
  const t = text.trim();
  const name = company.trim();
  if (!t || !name || t.toLowerCase().includes(name.toLowerCase())) return t;
  const m = LEAD_IN.exec(t);
  if (m) return `${m[0]} from ${name}${t.slice(m[0].length)}`;
  return `${name}: ${t}`;
}

/** A form's page URL from the Referer header (http(s) only, no fragment, ≤ 500 chars). */
export function pageUrlFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}
