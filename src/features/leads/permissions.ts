// Permission keys + default grants for module `leads` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B1. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "leads.view": "AO", // View leads inbox
  "leads.create": "AOT", // Manual lead entry
  "leads.edit": "AO", // Edit/assign/mark contacted/lost
  "leads.convert": "AO", // Convert lead → job/estimate
  "leads.receive_alerts": "AO", // Gets new-lead push/escalations
  "settings.api_keys": "A", // Lead sources & API keys
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type LeadsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as LeadsPerm[];

export const flags = [{ key: "leads", default: true }] as const;
