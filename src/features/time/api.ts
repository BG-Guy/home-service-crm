import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import type { ClockStatus } from "./contracts";

// B2 time API (BUILD_PLAN §6.2). F stubs (level F) — B2 may refine, keep signatures.

export type * from "./contracts";

export async function getClockStatuses(
  userIds: string[],
): Promise<Record<string, ClockStatus>> {
  const out: Record<string, ClockStatus> = {};
  for (const id of userIds)
    out[id] = { clockedIn: false, since: null, timeEntryId: null };
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      clockInAt: timeEntries.clockInAt,
    })
    .from(timeEntries)
    .where(
      and(inArray(timeEntries.userId, userIds), isNull(timeEntries.clockOutAt)),
    );
  for (const r of rows)
    out[r.userId] = { clockedIn: true, since: r.clockInAt, timeEntryId: r.id };
  return out;
}

export async function getHoursWorked(
  userId: string,
  from: Date,
  to: Date,
): Promise<{
  minutes: number;
  entries: {
    id: string;
    clockInAt: Date;
    clockOutAt: Date | null;
    breakMinutes: number;
  }[];
}> {
  const entries = await db
    .select({
      id: timeEntries.id,
      clockInAt: timeEntries.clockInAt,
      clockOutAt: timeEntries.clockOutAt,
      breakMinutes: timeEntries.breakMinutes,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.clockInAt, from),
        lt(timeEntries.clockInAt, to),
      ),
    )
    .orderBy(asc(timeEntries.clockInAt));
  let minutes = 0;
  for (const e of entries) {
    const end = e.clockOutAt ?? new Date(Math.min(Date.now(), to.getTime()));
    minutes += Math.max(
      0,
      Math.round((end.getTime() - e.clockInAt.getTime()) / 60_000) -
        e.breakMinutes,
    );
  }
  return { minutes, entries };
}
