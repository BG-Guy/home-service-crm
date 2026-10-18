import "server-only";
import {
  type CountryCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";

// Phone normalization (server only — libphonenumber must never reach the client
// bundle, SPEC §14). Phones are stored as E.164 text.

export const DEFAULT_COUNTRY: CountryCode = "US";

/** Normalize free-form input to E.164 ('+15125550100'); null if not a valid number. */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed?.isValid()) return null;
  return parsed.number;
}

/** Like normalizePhone but accepts "possible" numbers (lenient for imports/leads). */
export function normalizePhoneLenient(
  input: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(
    String(input).trim(),
    defaultCountry,
  );
  if (!parsed?.isPossible()) return null;
  return parsed.number;
}

export function isValidPhone(
  input: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): boolean {
  return normalizePhone(input, defaultCountry) !== null;
}

/**
 * Display format. Domestic numbers (same country as `homeCountry`) render national
 * '(512) 555-0100'; foreign ones international '+44 20 7946 0958'.
 * Unparseable input is returned unchanged.
 */
export function formatPhone(
  e164: string | null | undefined,
  homeCountry: CountryCode = DEFAULT_COUNTRY,
): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164, homeCountry);
  if (!parsed) return e164;
  return parsed.country === homeCountry
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/** 'tel:' href for a stored number. */
export function telHref(e164: string): string {
  return `tel:${e164.replace(/[^\d+]/g, "")}`;
}
