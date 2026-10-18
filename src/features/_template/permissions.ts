// Permission keys + default grants for this module (SPEC §4, §15.1).
// Letters: A = admin, O = office, T = tech. Keys are frozen once shipped (BUILD_PLAN §11.3).
// After registering the module, import `grants`/`flags` in src/lib/permissions.ts and
// src/lib/flags.ts so the keys join the `Perm` / `FeatureFlag` unions.
export const grants = {
  "example.view": "AOT",
  "example.manage": "AO",
} as const satisfies Record<string, string>;

export type TemplatePerm = keyof typeof grants;
export const perms = Object.keys(grants) as TemplatePerm[];

// Optional modules declare a flag (default OFF for anything ⚖️ or niche), e.g.
//   export const flags = [{ key: "example", default: false }] as const;
// Flags appear automatically on /settings/features.
export const flags = [] as const;
