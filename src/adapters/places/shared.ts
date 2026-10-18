// Mapping shared by the places drivers: USPS-style street lines, ZIPs, one-line
// labels and dedupe. Pure (no fetch, no env), so the drivers' tests cover it.

import { usStateCode } from "@/lib/us-states";
import type { AddressSuggestion } from "./types";

/** A provider answered with a non-2xx status. The message never holds the query or a key. */
export class PlacesHttpError extends Error {
  readonly status: number;
  constructor(provider: string, status: number) {
    super(`${provider} HTTP ${status}`);
    this.name = "PlacesHttpError";
    this.status = status;
  }
}

/** 1–10 results (default 5). */
export function clampLimit(n: number | undefined): number {
  return Math.min(10, Math.max(1, Math.floor(n ?? 5) || 5));
}

// USPS Publication 28 abbreviations for the common street suffixes. OpenStreetMap
// spells names out ("Pennsylvania Avenue Northwest"); people type and print "Ave NW".
const SUFFIX: Record<string, string> = {
  alley: "Aly",
  avenue: "Ave",
  boulevard: "Blvd",
  bypass: "Byp",
  causeway: "Cswy",
  center: "Ctr",
  circle: "Cir",
  court: "Ct",
  cove: "Cv",
  crescent: "Cres",
  crossing: "Xing",
  drive: "Dr",
  expressway: "Expy",
  extension: "Ext",
  freeway: "Fwy",
  grove: "Grv",
  heights: "Hts",
  highway: "Hwy",
  hollow: "Holw",
  junction: "Jct",
  lane: "Ln",
  manor: "Mnr",
  parkway: "Pkwy",
  place: "Pl",
  plaza: "Plz",
  point: "Pt",
  ridge: "Rdg",
  road: "Rd",
  route: "Rte",
  square: "Sq",
  station: "Sta",
  street: "St",
  terrace: "Ter",
  trail: "Trl",
  turnpike: "Tpke",
  valley: "Vly",
  view: "Vw",
  village: "Vlg",
};

const DIRECTION: Record<string, string> = {
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  northeast: "NE",
  northwest: "NW",
  southeast: "SE",
  southwest: "SW",
};

/**
 * USPS-style street name: abbreviates the suffix and the directionals around the
 * name ("North Lamar Boulevard" → "N Lamar Blvd", "Pennsylvania Avenue Northwest" →
 * "Pennsylvania Ave NW"). A word that is the name itself stays ("North Street" →
 * "North St", "Avenue of the Americas" unchanged).
 */
export function uspsStreetName(name: string): string {
  const w = name.trim().split(/\s+/);
  if (w.length < 2) return w.join(" ");
  let end = w.length;
  const post = DIRECTION[(w[end - 1] as string).toLowerCase()];
  if (post && end >= 3) {
    w[end - 1] = post;
    end--;
  }
  const suffix = SUFFIX[(w[end - 1] as string).toLowerCase()];
  if (suffix) w[end - 1] = suffix;
  const pre = DIRECTION[(w[0] as string).toLowerCase()];
  if (pre && w.length >= 3) w[0] = pre;
  return w.join(" ");
}

/** First five-digit ZIP in a postcode ("20500-0003", "78701;78702" → "20500", "78701"). */
export function zip5(postcode: string | null | undefined): string {
  return /\b(\d{5})\b/.exec(postcode ?? "")?.[1] ?? "";
}

/** House number typed at the start of the query ("123 Main", "12-34 Jackson" → "123", "12-34"). */
export function typedHouseNumber(query: string): string | null {
  return /^\s*(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)\s+\S/.exec(query)?.[1] ?? null;
}

/** "street, city, ST 12345", skipping missing parts. */
export function formatLabel(a: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): string {
  return [a.street, a.city, [a.state, a.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

/** One provider result, before mapping. `state` may be a name or a code. */
export interface RawAddress {
  id: string;
  housenumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Map a provider result to a suggestion; null without a street or coordinates.
 * A street-level result (no house number) takes the number the user typed, so
 * "123 Main" still offers "123 Main St, …" when the map has no house points.
 */
export function toSuggestion(
  r: RawAddress,
  typedNumber: string | null,
): AddressSuggestion | null {
  const name = r.street?.trim();
  if (!name || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
  const own = r.housenumber?.split(/[;,]/)[0]?.trim() || null;
  const number = own ?? typedNumber;
  const street = number
    ? `${number} ${uspsStreetName(name)}`
    : uspsStreetName(name);
  const city = r.city?.trim() ?? "";
  const state = usStateCode(r.state);
  const zip = zip5(r.postcode);
  return {
    id: own || !number ? r.id : `${r.id}#${number}`,
    label: formatLabel({ street, city, state, zip }),
    street,
    city,
    state,
    zip,
    lat: r.lat as number,
    lng: r.lng as number,
  };
}

/**
 * Drop empties and repeats (same label), keep the provider's order, at most `limit`.
 * Ids come out unique (they key the UI rows) even if a provider omits its own.
 */
export function uniqueSuggestions(
  list: readonly (AddressSuggestion | null)[],
  limit: number,
): AddressSuggestion[] {
  const labels = new Set<string>();
  const ids = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const s of list) {
    if (!s) continue;
    const label = s.label.toLowerCase();
    if (labels.has(label)) continue;
    labels.add(label);
    const id = ids.has(s.id) ? `${s.id}~${out.length}` : s.id;
    ids.add(id);
    out.push(id === s.id ? s : { ...s, id });
    if (out.length >= limit) break;
  }
  return out;
}
