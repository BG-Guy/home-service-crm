// Permission keys + default grants for module `parts` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B6. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "parts.add_to_job": "AOT", // Add parts to job
  "parts.view_cost": "AOT", // See part cost & margin (techs: own purchases)
  "parts.submit_receipt": "AOT", // Upload tech-paid receipt
  "parts.approve_reimbursement": "A", // Approve tech-paid parts
  "inventory.view": "AOT", // View stock (own truck if tech)
  "inventory.manage": "AO", // Adjust stock, transfers, POs
  "inventory.request_restock": "AOT", // Request restock for own truck
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type PartsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as PartsPerm[];

export const flags = [
  { key: "parts", default: true },
  { key: "inventory", default: false },
] as const;
