// Address autocomplete adapter interface (search-as-you-type for US street addresses).
// Types only: the client imports AddressSuggestion from here.

export interface AddressSuggestion {
  /** Stable per provider result (React key). */
  id: string;
  /** One line, e.g. "1600 Pennsylvania Ave NW, Washington, DC 20500". */
  label: string;
  /** Number + street, e.g. "1600 Pennsylvania Ave NW". */
  street: string;
  city: string;
  /** USPS two-letter code ("" when the provider gave none). */
  state: string;
  /** Five-digit ZIP ("" when the provider gave none). */
  zip: string;
  lat: number;
  lng: number;
}

/** GET /api/places/autocomplete response (and suggestAddresses() result). */
export interface AddressLookup {
  suggestions: AddressSuggestion[];
  /** Data credit to show under the list, e.g. "© OpenStreetMap contributors". */
  attribution: string | null;
  /** False when the deployment turned autocomplete off (ADDRESS_AUTOCOMPLETE=none). */
  enabled: boolean;
  /** The provider failed or timed out: no suggestions this time, and nothing cached. */
  unavailable?: boolean;
}

export interface PlacesProvider {
  id: "photon" | "geoapify" | "none";
  suggest(i: {
    query: string;
    limit?: number;
    /** Rank results near this point first (the company's location). */
    bias?: { lat: number; lng: number } | null;
  }): Promise<AddressSuggestion[]>;
}
