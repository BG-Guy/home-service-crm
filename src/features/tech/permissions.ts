// Permission keys + default grants for module `tech` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B2. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {} as const satisfies Record<string, string>;

export type TechPerm = keyof typeof grants;
export const perms = Object.keys(grants) as TechPerm[];

export const flags = [] as const;
