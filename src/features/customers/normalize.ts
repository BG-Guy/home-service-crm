// Pure, isomorphic helpers for customers/properties (no DB, no server-only).
// Shared by the customers API, lead intake, CSV import and tests.

import { mapsHref } from "@/lib/links";
import type { AddressInput } from "./contracts";

/** Lower-cased, trimmed email; null when empty or obviously invalid. */
export function normEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const v = String(e).trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

const STREET_ABBR: Record<string, string> = {
  street: "st",
  avenue: "ave",
  av: "ave",
  road: "rd",
  drive: "dr",
  lane: "ln",
  boulevard: "blvd",
  court: "ct",
  circle: "cir",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  terrace: "ter",
  trail: "trl",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  apartment: "apt",
  suite: "ste",
};

/**
 * Normalized street for duplicate detection: lower-case, punctuation removed,
 * whitespace collapsed, common suffixes abbreviated ("123 Oak Street" ≡ "123 oak st.").
 */
export function normStreet(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_ABBR[w] ?? w)
    .join(" ");
}

/** First 5 digits of a US ZIP ("78701-1234" → "78701"). */
export function normZip(z: string | null | undefined): string {
  if (!z) return "";
  const m = /\d{5}/.exec(String(z));
  return m ? m[0] : String(z).trim();
}

// Masking lives in src/lib/mask.ts (shared with jobs and documents); re-exported
// here so existing customer-module imports keep working.
export { maskEmail, maskPhone, maskStreet } from "@/lib/mask";

export function addressShort(p: {
  street: string;
  unit?: string | null;
}): string {
  return p.unit ? `${p.street} ${p.unit}` : p.street;
}

export function addressLine(p: {
  street: string;
  unit?: string | null;
  city: string;
  state: string;
  zip: string;
}): string {
  return `${addressShort(p)}, ${p.city}, ${p.state} ${p.zip}`;
}

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(
    " ",
  ),
);

/**
 * Parse a one-line US address ("12 Oak St Apt 4, Austin, TX 78701") into parts.
 * Returns null when a street and a 5-digit ZIP can't be found. City/state are
 * optional fallbacks ("" when missing) so callers can fill them from the ZIP.
 */
export function parseAddressLine(
  line: string | null | undefined,
): AddressInput | null {
  if (!line) return null;
  const s = String(line).replace(/\s+/g, " ").trim();
  if (!s) return null;
  const zipM = /(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA?|United States))?$/i.exec(
    s,
  );
  if (!zipM) return null;
  const zip = zipM[1] as string;
  let rest = s.slice(0, zipM.index).trim().replace(/,$/, "").trim();
  let state = "";
  const stM = /(?:,|\s)\s*([A-Za-z]{2})$/.exec(rest);
  if (stM && STATES.has((stM[1] as string).toUpperCase())) {
    state = (stM[1] as string).toUpperCase();
    rest = rest.slice(0, stM.index).trim().replace(/,$/, "").trim();
  }
  const parts = rest
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  let street = parts[0] as string;
  let city = parts.length > 1 ? (parts[parts.length - 1] as string) : "";
  let unit: string | null = null;
  if (parts.length > 2) unit = parts.slice(1, -1).join(", ");
  const unitM = /\s+((?:apt|unit|ste|suite|#)\s*[\w-]+)$/i.exec(street);
  if (unitM) {
    unit = unit ?? (unitM[1] as string);
    street = street.slice(0, unitM.index).trim();
  }
  if (!city && parts.length === 1) {
    // "12 Oak St Austin" — cannot split reliably; keep everything as street.
    city = "";
  }
  return { street, unit, city, state, zip };
}

/** Display name from parts (company wins for commercial accounts when no person). */
export function displayNameOf(i: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string | null {
  const d = i.displayName?.trim();
  if (d) return d;
  const person = [i.firstName, i.lastName]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(" ");
  return person || i.companyName?.trim() || null;
}

/** Split "Dana Lee" → { first: "Dana", last: "Lee" }. */
export function splitName(name: string | null | undefined): {
  first: string | null;
  last: string | null;
} {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0] as string, last: null };
  return {
    first: parts[0] as string,
    last: parts.slice(1).join(" "),
  };
}

/** Navigate deep link: Apple Maps on Apple devices, Google Maps otherwise. */
export function navigateHref(
  p: {
    street: string;
    city: string;
    state: string;
    zip: string;
    lat?: number | null;
    lng?: number | null;
  },
  userAgent: string | null | undefined,
): string {
  return mapsHref(p, userAgent) ?? "https://www.google.com/maps";
}
