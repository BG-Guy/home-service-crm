// Address autocomplete lookups from the browser (src/ui/components/AddressAutocomplete).
// GET /api/places/autocomplete, abortable. Every failure resolves to "no suggestions"
// so the field keeps working as a plain input; repeat queries come from the HTTP
// cache (private, max-age=300).

import type { AddressLookup } from "@/adapters/places/types";

export type { AddressLookup, AddressSuggestion } from "@/adapters/places/types";

/** Worth asking about: 3–120 characters with a letter (same rule as the route). */
export function isAddressQuery(query: string): boolean {
  const q = query.trim();
  return q.length >= 3 && q.length <= 120 && /\p{L}/u.test(q);
}

// The server said autocomplete is off (ADDRESS_AUTOCOMPLETE=none): stop asking.
let off = false;

const none = (enabled: boolean): AddressLookup => ({
  suggestions: [],
  attribution: null,
  enabled,
});

/** Suggestions for a partial street address. Rejects only when `signal` aborts. */
export async function fetchAddressSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<AddressLookup> {
  const q = query.trim();
  if (off) return none(false);
  if (!isAddressQuery(q) || !navigator.onLine) return none(true);
  try {
    const res = await fetch(
      `/api/places/autocomplete?q=${encodeURIComponent(q)}`,
      { signal, headers: { Accept: "application/json" } },
    );
    if (!res.ok) return none(true);
    const json = (await res.json()) as Partial<AddressLookup>;
    if (json.enabled === false) off = true;
    return {
      suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
      attribution:
        typeof json.attribution === "string" ? json.attribution : null,
      enabled: json.enabled !== false,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return none(true);
  }
}
