// Permission keys + default grants for module `tools` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B7. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "tools.view_own": "AOT", // My tools
  "tools.view_all": "AO", // All tools
  "tools.manage": "A", // Add/edit/assign/retire tools
  "tools.audit_submit": "AOT", // Complete tool audits
  "tools.audit_review": "A", // Review audits/incidents
  "tools.report_incident": "AOT", // Report own tool lost/stolen/damaged
  "tools.maintenance_log": "AOT", // Log maintenance on a tool in own custody
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type ToolsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as ToolsPerm[];

export const flags = [{ key: "tools", default: false }] as const;
