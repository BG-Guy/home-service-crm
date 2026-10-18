// Permission keys + default grants for module `vehicles` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B7. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "vehicles.view_own": "AOT", // Assigned vehicle
  "vehicles.view_all": "AO", // Fleet
  "vehicles.manage": "A", // Add/edit vehicles, reminder rules, docs
  "vehicles.log": "AOT", // Submit odometer/fuel/service/inspection logs
  "vehicles.log_approve": "A", // Approve logs/documents
  "vehicles.log_trusted": "", // Own logs skip always_review (grant per user via overrides)
  "vehicles.report_issue": "AOT", // Report vehicle issue
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type VehiclesPerm = keyof typeof grants;
export const perms = Object.keys(grants) as VehiclesPerm[];

export const flags = [{ key: "vehicles", default: true }] as const;
