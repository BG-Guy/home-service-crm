// US state / territory names → USPS two-letter codes. Pure and client-safe.
// The 50 states + DC come from the signup picker's table (one list for the app);
// territories are added here because addresses can use them but the picker doesn't.

import { US_STATES } from "@/app/(auth)/signup/options";

const TERRITORIES = [
  ["PR", "Puerto Rico"],
  ["GU", "Guam"],
  ["VI", "U.S. Virgin Islands"],
  ["AS", "American Samoa"],
  ["MP", "Northern Mariana Islands"],
] as const;

const ALIASES: Record<string, string> = {
  "washington dc": "DC",
  "washington d c": "DC",
  "virgin islands": "VI",
  "united states virgin islands": "VI",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();

const CODES = new Set<string>();
const BY_NAME = new Map<string, string>();
for (const [code, name] of [...US_STATES, ...TERRITORIES]) {
  CODES.add(code);
  BY_NAME.set(norm(name), code);
}

/**
 * USPS code for a US state or territory given by name or code
 * ("Texas", "tx", "US-TX", "District of Columbia" → "TX" / "DC"). "" when unknown.
 */
export function usStateCode(input: string | null | undefined): string {
  if (!input) return "";
  const raw = input.trim();
  const code = raw.toUpperCase().replace(/^US-/, "");
  if (CODES.has(code)) return code;
  const n = norm(raw);
  return BY_NAME.get(n) ?? ALIASES[n] ?? "";
}
