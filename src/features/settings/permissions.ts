// Permission keys + default grants for module `settings` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B8. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "settings.manage": "A", // General settings (company, services, taxes, invoices)
  "tags.manage": "AO", // Create/edit/archive custom tags
  "custom_fields.manage": "A", // Custom fields and checklist templates
  "settings.permissions": "A", // Role grid & user overrides
  "settings.features": "A", // Feature flags
  "settings.integrations": "A", // Payment/SMS/email/AI/storage credentials
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type SettingsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as SettingsPerm[];

export const flags = [] as const;
