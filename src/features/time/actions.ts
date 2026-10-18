"use server";

import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { odometerReadings, timeEntries, users } from "@/db/schema";
import { getAssignedVehicle } from "@/features/vehicles/api";
import { action } from "@/lib/action";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import type { Actor, Geo } from "@/lib/types";

// Time clock (SPEC M02 time clock, M06 start/end of day): clock in/out with a
// geostamp, breaks, odometer via B7 S48 when settings.vehicles.require_odometer_on_clock,
// admin edits with a reason (time.manage). Clock in/out are offline-capable.

const uuid = z.string().uuid();
const zGeo = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().nullable().optional(),
    at: z.string().optional(),
  })
  .nullable()
  .optional();

/** Device time for offline replays (within 12 h), else now. */
function stampFrom(clientTs?: string | null): Date {
  const now = new Date();
  if (!clientTs) return now;
  const d = new Date(clientTs);
  if (Number.isNaN(d.getTime())) return now;
  return Math.abs(now.getTime() - d.getTime()) < 12 * 3600_000 && d <= now
    ? d
    : now;
}

async function openEntry(tx: Tx, userId: string) {
  const [e] = await tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutAt)))
    .orderBy(desc(timeEntries.clockInAt))
    .limit(1);
  return e ?? null;
}

async function vehicleFor(userId: string, usesCompanyVehicle: boolean) {
  if (!(await isEnabled("vehicles"))) return null;
  const v = await getAssignedVehicle(userId).catch(() => null);
  if (!v) return null;
  return {
    vehicle: v,
    required: usesCompanyVehicle || v.ownership === "tech_owned",
  };
}

async function emitClock(
  tx: Tx,
  type: "time.clocked_in" | "time.clocked_out",
  e: {
    id: string;
    userId: string;
    vehicleId: string | null;
    odometerId: string | null;
    at: Date;
  },
  actor: Actor,
  emit: (
    t: typeof type,
    entity: { type: "user"; id: string },
    p: {
      time_entry_id: string;
      user_id: string;
      vehicle_id: string | null;
      odometer_reading_id: string | null;
      date: string;
    },
  ) => Promise<void>,
  activity: (a: {
    entity: { type: "user"; id: string };
    kind: string;
    summary: string;
    data?: unknown;
  }) => Promise<void>,
) {
  const tz = await getCompanyTimezone();
  await emit(
    type,
    { type: "user", id: e.userId },
    {
      time_entry_id: e.id,
      user_id: e.userId,
      vehicle_id: e.vehicleId,
      odometer_reading_id: e.odometerId,
      date: dateKey(e.at, tz),
    },
  );
  await activity({
    entity: { type: "user", id: e.userId },
    kind: type,
    summary: type === "time.clocked_in" ? "Clocked in" : "Clocked out",
    data: { time_entry_id: e.id },
  });
  void tx;
  void actor;
}

export const clockIn = action({
  perm: "time.clock_self",
  input: z.object({
    geo: zGeo,
    odometerReadingId: uuid.nullable().optional(),
    clientId: uuid.optional(),
    clientTs: z.string().optional(),
  }),
  audit: "time.clocked_in",
  async run({ input, tx, user, actor, emit, activity }) {
    const existing = await openEntry(tx, user.id);
    if (existing) return { timeEntryId: existing.id, already: true };
    const settings = await getSettings();
    const v = await vehicleFor(user.id, user.usesCompanyVehicle);
    if (
      settings.vehicles.require_odometer_on_clock &&
      v?.required &&
      !input.odometerReadingId
    )
      throw new ValidationError(
        { odometerReadingId: ["Log your odometer to clock in."] },
        "Log your odometer to clock in.",
      );
    const at = stampFrom(input.clientTs);
    const geo = input.geo as Geo | null | undefined;
    const [row] = await tx
      .insert(timeEntries)
      .values({
        userId: user.id,
        clockInAt: at,
        inLat: geo?.lat ?? null,
        inLng: geo?.lng ?? null,
        inOdometerId: input.odometerReadingId ?? null,
        vehicleId: v?.vehicle.id ?? null,
        clientId: input.clientId ?? null,
      })
      .returning({ id: timeEntries.id });
    if (!row) throw new Error("time entry insert failed");
    await emitClock(
      tx,
      "time.clocked_in",
      {
        id: row.id,
        userId: user.id,
        vehicleId: v?.vehicle.id ?? null,
        odometerId: input.odometerReadingId ?? null,
        at,
      },
      actor,
      emit,
      activity,
    );
    return { timeEntryId: row.id, already: false };
  },
  auditEntity: ({ data }) => ({ type: "time_entry", id: data.timeEntryId }),
  revalidate: () => ["/today", "/time", "/schedule", "/map"],
});

export const clockOut = action({
  perm: "time.clock_self",
  input: z.object({
    geo: zGeo,
    odometerReadingId: uuid.nullable().optional(),
    clientId: uuid.optional(),
    clientTs: z.string().optional(),
  }),
  audit: "time.clocked_out",
  async run({ input, tx, user, actor, emit, activity }) {
    const e = await openEntry(tx, user.id);
    if (!e) throw new ConflictError("not_clocked_in", "You're not clocked in.");
    const at = stampFrom(input.clientTs);
    let odo = input.odometerReadingId ?? null;
    if (!odo && e.vehicleId) {
      // S49 records the end-of-day reading on its own; pick it up for the entry.
      const [r] = await tx
        .select({ id: odometerReadings.id })
        .from(odometerReadings)
        .where(
          and(
            eq(odometerReadings.vehicleId, e.vehicleId),
            eq(odometerReadings.recordedBy, user.id),
            gte(odometerReadings.recordedAt, e.clockInAt),
            inArray(odometerReadings.source, ["clock", "manual", "photo"]),
          ),
        )
        .orderBy(desc(odometerReadings.recordedAt))
        .limit(1);
      if (r && r.id !== e.inOdometerId) odo = r.id;
    }
    const geo = input.geo as Geo | null | undefined;
    await tx
      .update(timeEntries)
      .set({
        clockOutAt: at < e.clockInAt ? new Date() : at,
        outLat: geo?.lat ?? null,
        outLng: geo?.lng ?? null,
        outOdometerId: odo,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, e.id));
    await emitClock(
      tx,
      "time.clocked_out",
      {
        id: e.id,
        userId: user.id,
        vehicleId: e.vehicleId,
        odometerId: odo,
        at,
      },
      actor,
      emit,
      activity,
    );
    return { timeEntryId: e.id };
  },
  auditEntity: ({ data }) => ({ type: "time_entry", id: data.timeEntryId }),
  revalidate: () => ["/today", "/today/finish", "/time", "/schedule", "/map"],
});

export const logBreak = action({
  perm: "time.clock_self",
  input: z.object({
    minutes: z.number().int().min(5).max(240),
    clientId: uuid.optional(),
  }),
  audit: "time.break_logged",
  async run({ input, tx, user }) {
    const e = await openEntry(tx, user.id);
    if (!e) throw new ConflictError("not_clocked_in", "Clock in first.");
    await tx
      .update(timeEntries)
      .set({
        breakMinutes: e.breakMinutes + input.minutes,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, e.id));
    return { timeEntryId: e.id, breakMinutes: e.breakMinutes + input.minutes };
  },
  auditEntity: ({ data }) => ({ type: "time_entry", id: data.timeEntryId }),
  revalidate: () => ["/today", "/time"],
});

/** 'YYYY-MM-DDTHH:MM' in the company zone → UTC. */
async function localToUtc(v: string): Promise<Date> {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) throw new ValidationError({ clockIn: ["Enter a date and time."] });
  const tz = await getCompanyTimezone();
  return zonedTimeToUtc(
    {
      ...parseDateKey(m[1] as string),
      hour: Number(m[2]),
      minute: Number(m[3]),
    },
    tz,
  );
}

const EditInput = z.object({
  clockIn: z.string().min(16, "Enter a date and time."),
  clockOut: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().min(16).nullable().optional(),
  ),
  breakMinutes: z.coerce.number().int().min(0).max(600),
  reason: z.string().trim().min(3, "Say why you're changing it.").max(500),
});

export const editTimeEntry = action({
  perm: "time.manage",
  input: EditInput.extend({ entryId: uuid }),
  name: "time.entry_edited",
  async run({ input, tx, user, audit }) {
    const [e] = await tx
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, input.entryId))
      .limit(1);
    if (!e) throw new NotFoundError("Time entry");
    const clockInAt = await localToUtc(input.clockIn);
    const clockOutAt = input.clockOut ? await localToUtc(input.clockOut) : null;
    if (clockOutAt && clockOutAt <= clockInAt)
      throw new ValidationError({
        clockOut: ["Clock-out must be after clock-in."],
      });
    await tx
      .update(timeEntries)
      .set({
        clockInAt,
        clockOutAt,
        breakMinutes: input.breakMinutes,
        source: "admin_edit",
        editedBy: user.id,
        editReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, e.id));
    await audit({
      action: "time.entry_edited",
      entity: { type: "time_entry", id: e.id },
      before: {
        clockInAt: e.clockInAt,
        clockOutAt: e.clockOutAt,
        breakMinutes: e.breakMinutes,
      },
      after: {
        clockInAt,
        clockOutAt,
        breakMinutes: input.breakMinutes,
        reason: input.reason,
      },
    });
    return { entryId: e.id, userId: e.userId };
  },
  revalidate: ({ data }) => ["/time", `/team/${data.userId}`],
});

export const addTimeEntry = action({
  perm: "time.manage",
  input: EditInput.extend({ userId: uuid }),
  name: "time.entry_added",
  async run({ input, tx, user, audit }) {
    const [u] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!u) throw new NotFoundError("User");
    const clockInAt = await localToUtc(input.clockIn);
    const clockOutAt = input.clockOut ? await localToUtc(input.clockOut) : null;
    if (!clockOutAt)
      throw new ValidationError({ clockOut: ["Enter the clock-out time."] });
    if (clockOutAt <= clockInAt)
      throw new ValidationError({
        clockOut: ["Clock-out must be after clock-in."],
      });
    const [row] = await tx
      .insert(timeEntries)
      .values({
        userId: input.userId,
        clockInAt,
        clockOutAt,
        breakMinutes: input.breakMinutes,
        source: "admin_edit",
        editedBy: user.id,
        editReason: input.reason,
      })
      .returning({ id: timeEntries.id });
    if (!row) throw new Error("insert failed");
    await audit({
      action: "time.entry_added",
      entity: { type: "time_entry", id: row.id },
      after: {
        userId: input.userId,
        clockInAt,
        clockOutAt,
        reason: input.reason,
      },
    });
    return { entryId: row.id, userId: input.userId };
  },
  revalidate: ({ data }) => ["/time", `/team/${data.userId}`],
});
