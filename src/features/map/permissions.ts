// Permission keys + default grants for module `map` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B7. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "map.view": "AO", // Live tech map
  "location.share": "T", // Send location pings while on shift
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type MapPerm = keyof typeof grants;
export const perms = Object.keys(grants) as MapPerm[];

export const flags = [{ key: "map", default: true }] as const;
