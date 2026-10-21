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

/**
 * Profile date checks for the Assign hub fields (Edit profile sheet). `today` is the
 * company-zone calendar day. Returns field errors (empty = valid).
 * - hire date: not in the future
 * - years in the trade: whole number 0–60
 * - date of birth: in the past, age 16–100
 */
export function memberProfileDateErrors(
  v: {
    hireDate?: string | null;
    experienceYears?: number | null;
    birthDate?: string | null;
  },
  today: string,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (v.hireDate && v.hireDate > today)
    errors.hireDate = ["The hire date can't be in the future."];
  if (
    v.experienceYears != null &&
    (!Number.isInteger(v.experienceYears) ||
      v.experienceYears < 0 ||
      v.experienceYears > 60)
  )
    errors.experienceYears = ["Enter 0 to 60 years."];
  if (v.birthDate) {
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const shift = (years: number) =>
      `${String(y - years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (v.birthDate >= today)
      errors.birthDate = ["The date of birth must be in the past."];
    else if (v.birthDate > shift(16))
      errors.birthDate = ["Team members must be at least 16."];
    else if (v.birthDate <= shift(101))
      errors.birthDate = ["Check the year: that's over 100 years ago."];
  }
  return errors;
}
