// Permission keys + default grants for module `invoices` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B3. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "invoices.view": "AOT", // View invoices (own jobs if tech)
  "invoices.create": "AOT", // Create/issue invoice
  "invoices.revise": "AO", // Revise issued invoice (creates revision)
  "invoices.void": "A", // Void / write off
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type InvoicesPerm = keyof typeof grants;
export const perms = Object.keys(grants) as InvoicesPerm[];

export const flags = [] as const;
