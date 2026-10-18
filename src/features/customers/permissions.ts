// Permission keys + default grants for module `customers` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B1. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "customers.view": "AOT", // View customer list/records (masked contact if lacking contact_view); techs: assigned jobs only
  "customers.view_all": "AO", // See all customers, not just ones on own jobs
  "customers.contact_view": "AO", // Full phone/email/address outside active job window
  "customers.create": "AOT", // Create customers/properties
  "customers.edit": "AO", // Edit customers/properties
  "customers.delete": "A", // Soft-delete / anonymize
  "customers.merge": "AO", // Merge duplicates
  "customers.export": "A", // Export customer list
  "customers.flags_manage": "AO", // Set do-not-service, prepay-required, dispute flags
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type CustomersPerm = keyof typeof grants;
export const perms = Object.keys(grants) as CustomersPerm[];

export const flags = [] as const;
