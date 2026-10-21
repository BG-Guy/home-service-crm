// Calendar-date helpers for team profiles (pure, client-safe). Dates are
// 'YYYY-MM-DD' keys compared to "today" in the company time zone, so a hire date
// or birthday never shifts with the server's zone.

function parts(key: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whole months from `from` to `to` (0 when `to` is earlier). */
export function monthsBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return 0;
  let m = (b[0] - a[0]) * 12 + (b[1] - a[1]);
  if (b[2] < a[2]) m -= 1;
  return Math.max(0, m);
}

/** Time at the company from the hire date: "2 y 4 mo", "7 mo", "New". */
export function tenureLabel(
  hireDate: string | null | undefined,
  today: string,
): string | null {
  if (!hireDate || !parts(hireDate)) return null;
  if (hireDate > today) return "Starts soon";
  const m = monthsBetween(hireDate, today);
  if (m < 1) return "New";
  const y = Math.floor(m / 12);
  const mo = m % 12;
  if (y === 0) return `${mo} mo`;
  return mo ? `${y} y ${mo} mo` : `${y} y`;
}

/** Age in whole years on `today` (null for a missing or future date). */
export function ageOn(
  birthDate: string | null | undefined,
  today: string,
): number | null {
  if (!birthDate || !parts(birthDate) || birthDate > today) return null;
  return Math.floor(monthsBetween(birthDate, today) / 12);
}

/** "12 years", "1 year", "Under a year". */
export function experienceLabel(
  years: number | null | undefined,
): string | null {
  if (years == null) return null;
  if (years <= 0) return "Under a year";
  return `${years} year${years === 1 ? "" : "s"}`;
}
