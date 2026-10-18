// Permission keys + default grants for module `reviews` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B5. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "reviews.view": "AOT", // Review requests & stats (techs: own)
  "reviews.send_manual": "AO", // Manually trigger review request
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type ReviewsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as ReviewsPerm[];

export const flags = [{ key: "reviews", default: true }] as const;
