import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { timeOff, users } from "@/db/schema";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  formatDateKey,
  formatInTz,
  formatTimeRange,
  zonedParts,
} from "@/lib/time";
import {
  businessAsWorkHours,
  normalizeWorkHours,
  type WorkHoursDay,
} from "@/lib/work-hours";

// A team member's booking schedule (leads-flow redesign, item 8): their working
// hours and upcoming time off, for the member page. Pages call requireUser first.

export interface TimeOffView {
  id: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
  /** "Fri, Oct 23", "Fri, Oct 23 – Mon, Oct 26", "Fri, Oct 23 · 1:00 – 5:00 PM". */
  label: string;
  /** Whole days (local midnight to midnight). */
  allDay: boolean;
  /** Happening now. */
  current: boolean;
}

export interface MemberSchedule {
  /** Their own hours, or null = the company's business hours. */
  workHours: WorkHoursDay[] | null;
  /** Business hours (Settings → Company) as work-hours rows. */
  business: WorkHoursDay[];
  /** Time off that hasn't ended yet, soonest first. */
  timeOff: TimeOffView[];
  timeZone: string;
}

const DAY: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

const isMidnight = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return p.hour === 0 && p.minute === 0;
};

/** Human label for a time-off range in the company time zone. */
export function timeOffLabel(
  startsAt: Date,
  endsAt: Date,
  tz: string,
): { label: string; allDay: boolean } {
  const startKey = dateKey(startsAt, tz);
  if (isMidnight(startsAt, tz) && isMidnight(endsAt, tz)) {
    const lastKey = addDaysToKey(dateKey(endsAt, tz), -1);
    const first = formatDateKey(startKey, "en-US", DAY);
    return {
      label:
        lastKey <= startKey
          ? first
          : `${first} – ${formatDateKey(lastKey, "en-US", DAY)}`,
      allDay: true,
    };
  }
  if (dateKey(endsAt, tz) === startKey)
    return {
      label: `${formatInTz(startsAt, tz, DAY)} · ${formatTimeRange(startsAt, endsAt, tz)}`,
      allDay: false,
    };
  const at: Intl.DateTimeFormatOptions = {
    ...DAY,
    hour: "numeric",
    minute: "2-digit",
  };
  return {
    label: `${formatInTz(startsAt, tz, at)} – ${formatInTz(endsAt, tz, at)}`,
    allDay: false,
  };
}

export async function getMemberSchedule(
  userId: string,
): Promise<MemberSchedule> {
  const now = new Date();
  const [tz, settings, [u], rows] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
    db
      .select({ workHours: users.workHours })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select()
      .from(timeOff)
      .where(and(eq(timeOff.userId, userId), gt(timeOff.endsAt, now)))
      .orderBy(asc(timeOff.startsAt))
      .limit(50),
  ]);
  return {
    workHours: u?.workHours ? normalizeWorkHours(u.workHours) : null,
    business: businessAsWorkHours(settings.company.business_hours),
    timeZone: tz,
    timeOff: rows.map((r) => ({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      note: r.note,
      ...timeOffLabel(r.startsAt, r.endsAt, tz),
      current: r.startsAt <= now,
    })),
  };
}
