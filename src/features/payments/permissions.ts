// Permission keys + default grants for module `payments` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B4. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "payments.collect": "AOT", // Take card payment / send pay link
  "payments.record_manual": "AOT", // Record cash/check/Zelle/Venmo
  "payments.keyed_entry": "AO", // Type a card number (requires settings.payments.allow_keyed)
  "payments.verify_manual": "AO", // Mark manual payment verified in bank
  "payments.view_all": "AO", // Payments list, reconciliation
  "payments.refund": "A", // Issue refund up to limit
  "deposits.waive": "AO", // Waive required deposit
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type PaymentsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as PaymentsPerm[];

export const flags = [{ key: "deposits", default: true }] as const;
