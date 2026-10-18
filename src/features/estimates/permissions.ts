// Permission keys + default grants for module `estimates` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B3. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "estimates.view": "AOT", // View estimates (own jobs if tech)
  "estimates.create": "AOT", // Create/edit drafts
  "estimates.send": "AOT", // Send to customer
  "estimates.discount": "AOT", // Apply discount up to role limit
  "estimates.approve_on_behalf": "AO", // Mark approved with verbal consent (logged)
  "pricebook.manage": "AO", // Edit price book items
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type EstimatesPerm = keyof typeof grants;
export const perms = Object.keys(grants) as EstimatesPerm[];

export const flags = [{ key: "estimates", default: true }] as const;
