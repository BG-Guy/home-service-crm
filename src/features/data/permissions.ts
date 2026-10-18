// Permission keys + default grants for module `data` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B1. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "data.export": "A", // Full export
  "data.import": "A", // CSV import
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type DataPerm = keyof typeof grants;
export const perms = Object.keys(grants) as DataPerm[];

export const flags = [] as const;
