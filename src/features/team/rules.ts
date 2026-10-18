// Pure team rules (SPEC §4.1 locks; M02). Client-safe; golden-tested.

/**
 * "At least one active admin must exist": returns a reason when the change would
 * leave the company with no active admin, else null.
 */
export function lastAdminBlock(a: {
  /** The person being changed is currently an active admin. */
  targetIsActiveAdmin: boolean;
  /** Active admins other than the target. */
  otherActiveAdmins: number;
  /** After the change the target is still an (active) admin. */
  nextIsAdmin: boolean;
}): string | null {
  if (!a.targetIsActiveAdmin || a.nextIsAdmin) return null;
  if (a.otherActiveAdmins > 0) return null;
  return "This is the only active admin. Make someone else an admin first.";
}

/** ⚖️ Notes shown when switching worker type (SPEC M02/M16; never removed). */
export const WORKER_TYPE_NOTES = {
  w2: "W-2 employees: wage deductions (tools, cash shortages) are restricted or banned in many states, cash must be remitted separately (never netted from pay), and overtime and minimum-wage floors apply.",
  "1099":
    "1099 contractors: control over how the work is done, schedules and required equipment can make a contractor an employee under state ABC tests. Check with your accountant before switching.",
} as const;

export function workerTypeLabel(t: string): string {
  return t === "w2" ? "W-2" : "1099";
}
