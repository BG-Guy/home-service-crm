// Permission keys + default grants for module `insights` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B8. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "insights.view_own": "AOT", // Personal dashboard (own KPIs/earnings)
  "insights.view_ops": "AO", // Operations dashboard (leads, schedule, AR, outbox)
  "insights.view_financials": "A", // Revenue, margin, payroll cost, source ROI
  "insights.view_team": "AO", // Per-tech leaderboard & comparisons
  "reports.export": "A", // CSV export of any report
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type InsightsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as InsightsPerm[];

export const flags = [] as const;
