import "server-only";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { timeEntries, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError } from "@/lib/errors";
import type { SessionUser } from "@/lib/types";

// Time-clock DAL: own entries with time.clock_self; anyone's with time.manage.

export interface TimeEntryView {
  id: string;
  userId: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number;
  minutes: number;
  source: string;
  editedByName: string | null;
  editReason: string | null;
  hasGeo: boolean;
  hasOdometer: boolean;
}

export function canSeeTime(viewer: SessionUser, userId: string): boolean {
  return (
    viewer.perms.has("time.manage") ||
    (viewer.id === userId && viewer.perms.has("time.clock_self"))
  );
}

export function workedMinutes(
  e: { clockInAt: Date; clockOutAt: Date | null; breakMinutes: number },
  now = new Date(),
): number {
  const end = e.clockOutAt ?? now;
  return Math.max(
    0,
    Math.round((end.getTime() - e.clockInAt.getTime()) / 60_000) -
      e.breakMinutes,
  );
}

export async function listTimeEntries(
  userId: string,
  from: Date,
  to: Date,
  viewer?: SessionUser,
): Promise<TimeEntryView[]> {
  const v = viewer ?? (await requireUser());
  if (!canSeeTime(v, userId)) throw new ForbiddenError();
  const editor = alias(users, "editor");
  const rows = await db
    .select({ e: timeEntries, editorName: editor.name })
    .from(timeEntries)
    .leftJoin(editor, eq(editor.id, timeEntries.editedBy))
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.clockInAt, from),
        lt(timeEntries.clockInAt, to),
      ),
    )
    .orderBy(desc(timeEntries.clockInAt))
    .limit(400);
  return rows.map(({ e, editorName }) => ({
    id: e.id,
    userId: e.userId,
    clockInAt: e.clockInAt.toISOString(),
    clockOutAt: e.clockOutAt?.toISOString() ?? null,
    breakMinutes: e.breakMinutes,
    minutes: workedMinutes(e),
    source: e.source,
    editedByName: editorName ?? null,
    editReason: e.editReason,
    hasGeo: e.inLat != null,
    hasOdometer: e.inOdometerId != null || e.outOdometerId != null,
  }));
}

export async function getOpenEntry(userId: string): Promise<{
  id: string;
  clockInAt: string;
  breakMinutes: number;
  vehicleId: string | null;
} | null> {
  const [e] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutAt)))
    .orderBy(desc(timeEntries.clockInAt))
    .limit(1);
  return e
    ? {
        id: e.id,
        clockInAt: e.clockInAt.toISOString(),
        breakMinutes: e.breakMinutes,
        vehicleId: e.vehicleId,
      }
    : null;
}

export async function timeUsers(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(asc(users.name));
}
