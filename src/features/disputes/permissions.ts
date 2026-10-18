// Permission keys + default grants for module `disputes` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B4. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "disputes.view": "AO", // Disputes list
  "disputes.manage": "A", // Edit/submit/accept dispute evidence
  "evidence.view": "AO", // View/print evidence pack
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type DisputesPerm = keyof typeof grants;
export const perms = Object.keys(grants) as DisputesPerm[];

export const flags = [{ key: "chargeback_protection", default: true }] as const;
