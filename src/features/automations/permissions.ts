// Permission keys + default grants for module `automations` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B5. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "automations.manage": "A", // Edit automations
  "reminders.manage": "AO", // Create/edit custom reminders
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type AutomationsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as AutomationsPerm[];

export const flags = [] as const;
