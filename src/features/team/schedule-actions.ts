"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { timeOff, users } from "@/db/schema";
import { action } from "@/lib/action";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getCompanyTimezone } from "@/lib/settings";
import { addDaysToKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { isValidWorkDay, normalizeWorkHours } from "@/lib/work-hours";

// A team member's booking schedule (leads-flow redesign, item 8): working hours
// (users.work_hours) and time off (time_off). Booking availability reads both.
// Managers only (users.manage), like the rest of the member page.

const TEAM = "/team";
const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Pick a time.");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

async function memberExists(tx: Tx, userId: string) {
  const [u] = await tx
    .select({ id: users.id, workHours: users.workHours })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new NotFoundError("Team member");
  return u;
}

/** Save working hours: business hours (null) or the member's own week. */
export const saveWorkHoursAction = action({
  name: "team.work_hours",
  perm: "users.manage",
  input: z.object({
    userId: z.uuid(),
    useBusinessHours: z.boolean(),
    days: z
      .array(
        z.object({
          day: z.number().int().min(0).max(6),
          start: HHMM,
          end: HHMM,
        }),
      )
      .max(14)
      .default([]),
  }),
  async run({ input, tx, audit, activity }) {
    const before = await memberExists(tx, input.userId);
    let next: { day: number; start: string; end: string }[] | null = null;
    if (!input.useBusinessHours) {
      const bad = input.days.findIndex((d) => !isValidWorkDay(d));
      if (bad >= 0)
        throw new ValidationError({
          [`days.${bad}.end`]: ["End after the start."],
        });
      const seen = new Set<number>();
      for (const d of input.days) {
        if (seen.has(d.day))
          throw new ValidationError({ days: ["One time range per day."] });
        seen.add(d.day);
      }
      next = normalizeWorkHours(input.days);
    }
    await tx
      .update(users)
      .set({ workHours: next, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    await audit({
      action: "user.work_hours_updated",
      entity: { type: "user", id: input.userId },
      before: { workHours: before.workHours },
      after: { workHours: next },
      full: true,
    });
    await activity({
      entity: { type: "user", id: input.userId },
      kind: "user.work_hours_updated",
      summary: next
        ? "Working hours changed"
        : "Working hours set to business hours",
    });
    return { workHours: next };
  },
  revalidate: ({ input }) => [`${TEAM}/${input.userId}`],
});

/**
 * Add time off. Dates are company-time-zone days; `allDay` covers whole days from
 * `from` through `to`, otherwise `startTime` on `from` to `endTime` on `to`.
 */
export const addTimeOffAction = action({
  name: "team.time_off_add",
  perm: "users.manage",
  input: z.object({
    userId: z.uuid(),
    from: DATE,
    to: DATE,
    allDay: z.boolean().default(true),
    startTime: HHMM.optional(),
    endTime: HHMM.optional(),
    note: z.string().trim().max(200).optional(),
  }),
  async run({ input, tx, user, audit, activity }) {
    await memberExists(tx, input.userId);
    if (input.to < input.from)
      throw new ValidationError({ to: ["End on or after the first day."] });
    if (addDaysToKey(input.from, 366) < input.to)
      throw new ValidationError({ to: ["A year at most."] });
    const tz = await getCompanyTimezone();
    const at = (key: string, hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return zonedTimeToUtc({ ...parseDateKey(key), hour: h, minute: m }, tz);
    };
    let startsAt: Date;
    let endsAt: Date;
    if (input.allDay) {
      startsAt = zonedTimeToUtc(parseDateKey(input.from), tz);
      endsAt = zonedTimeToUtc(parseDateKey(addDaysToKey(input.to, 1)), tz);
    } else {
      if (!input.startTime)
        throw new ValidationError({ startTime: ["Pick a start time."] });
      if (!input.endTime)
        throw new ValidationError({ endTime: ["Pick an end time."] });
      startsAt = at(input.from, input.startTime);
      endsAt =
        input.endTime === "24:00"
          ? zonedTimeToUtc(parseDateKey(addDaysToKey(input.to, 1)), tz)
          : at(input.to, input.endTime);
      if (endsAt <= startsAt)
        throw new ValidationError({ endTime: ["End after the start."] });
    }
    const [row] = await tx
      .insert(timeOff)
      .values({
        userId: input.userId,
        startsAt,
        endsAt,
        note: input.note || null,
        createdBy: user.id,
      })
      .returning({ id: timeOff.id });
    if (!row) throw new Error("insert failed");
    await audit({
      action: "user.time_off_added",
      entity: { type: "user", id: input.userId },
      after: {
        id: row.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        note: input.note || null,
      },
      full: true,
    });
    await activity({
      entity: { type: "user", id: input.userId },
      kind: "user.time_off_added",
      summary: "Time off added",
    });
    return { id: row.id };
  },
  revalidate: ({ input }) => [`${TEAM}/${input.userId}`],
});

export const removeTimeOffAction = action({
  name: "team.time_off_remove",
  perm: "users.manage",
  input: z.object({ id: z.uuid() }),
  async run({ input, tx, audit, activity }) {
    const [row] = await tx
      .delete(timeOff)
      .where(eq(timeOff.id, input.id))
      .returning();
    if (!row) throw new NotFoundError("Time off");
    await audit({
      action: "user.time_off_removed",
      entity: { type: "user", id: row.userId },
      before: {
        id: row.id,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        note: row.note,
      },
      full: true,
    });
    await activity({
      entity: { type: "user", id: row.userId },
      kind: "user.time_off_removed",
      summary: "Time off removed",
    });
    return { userId: row.userId };
  },
  revalidate: ({ data }) => [`${TEAM}/${data.userId}`],
});
