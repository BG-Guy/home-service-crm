// Permission keys + default grants for module `jobs` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B2. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "jobs.view_all": "AO", // All jobs
  "jobs.view_own": "AOT", // Jobs assigned to me
  "jobs.create": "AOT", // Create jobs
  "jobs.edit": "AO", // Edit job details (non-financial)
  "jobs.assign": "AO", // Assign/reassign techs, dispatch board
  "jobs.reschedule": "AO", // Change date/window
  "jobs.status_own": "AOT", // Move own job through tech flow
  "jobs.status_any": "AO", // Change status of any job
  "jobs.cancel": "AO", // Cancel before arrival
  "jobs.cancel_after_arrival": "AT", // Cancel after arrived (reason + photo; admin review if not admin)
  "jobs.reopen": "A", // Reopen completed/closed job
  "jobs.override_requirements": "A", // Complete without required photos/signature/checklist
  "jobs.approve_start": "A", // Approve starting a Critical-risk job
  "jobs.review_cancellations": "A", // Review after-arrival cancellations
  "jobs.set_custom_rate": "A", // Set a per-job commission rate
  "jobs.view_financials": "A", // See job cost/margin/commission
  "schedule.view_all": "AO", // Company calendar
  "time.clock_self": "AOT", // Clock in/out
  "time.manage": "A", // Edit others' time entries
  "tasks.view_all": "AO", // See and assign everyone's tasks
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type JobsPerm = keyof typeof grants;
export const perms = Object.keys(grants) as JobsPerm[];

export const flags = [] as const;
