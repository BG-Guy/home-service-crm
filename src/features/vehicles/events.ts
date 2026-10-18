// Event handlers for `vehicles` (BUILD_PLAN §4, §7). Owner: B7.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'vehicles.<what>'. Slow work → enqueueJob().
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { odometerReadings, timeEntries, trips, vehicles } from "@/db/schema";
import { getTechDay } from "@/features/jobs/api";
import { notify } from "@/features/notify/api";
import { writeActivity } from "@/lib/activity";
import type { EventPayload, HandlerReg, IgnoreReg } from "@/lib/events";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { addDaysToKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { inspectionDue, readingsOnDay } from "./engine";

type ClockPayload = EventPayload<"time.clocked_in">;

async function vehicleFor(
  tx: Parameters<HandlerReg["run"]>[1]["tx"],
  p: ClockPayload,
) {
  const rows = await tx
    .select()
    .from(vehicles)
    .where(
      p.vehicle_id
        ? eq(vehicles.id, p.vehicle_id)
        : and(
            eq(vehicles.assignedUserId, p.user_id),
            eq(vehicles.status, "active"),
          ),
    )
    .limit(1);
  const v = rows[0];
  return v && !v.deletedAt && v.status !== "retired" ? v : null;
}

export const handlers: HandlerReg[] = [
  {
    // Start-of-day inspection prompt (template staff.inspection_due, Appendix B).
    event: "time.clocked_in",
    name: "vehicles.inspection_due",
    async run(e, { tx }) {
      if (!(await isEnabled("vehicles"))) return;
      const p = e.payload as ClockPayload;
      const v = await vehicleFor(tx, p);
      if (!v || !(await inspectionDue(tx, v.id, e.createdAt))) return;
      await notify(tx, {
        to: { userIds: [p.user_id] },
        type: "staff.inspection_due",
        title: `Inspection due: ${v.nickname}`,
        body: "Take two minutes to check tires, lights, fluids and brakes before your first job.",
        url: `/vehicles/${v.id}?log=inspection`,
        entity: { type: "vehicle", id: v.id },
      });
    },
  },
  {
    // Draft the day's IRS-style trip from the clock odometers and job stops.
    event: "time.clocked_out",
    name: "vehicles.draft_trip",
    async run(e, { tx }) {
      if (!(await isEnabled("vehicles"))) return;
      const p = e.payload as ClockPayload;
      const v = await vehicleFor(tx, p);
      if (!v) return;
      const [te] = await tx
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, p.time_entry_id))
        .limit(1);
      const ids = [
        te?.inOdometerId,
        p.odometer_reading_id ?? te?.outOdometerId,
      ].filter((x): x is string => !!x);
      const clockReadings = ids.length
        ? await tx
            .select({ id: odometerReadings.id, value: odometerReadings.value })
            .from(odometerReadings)
            .where(inArray(odometerReadings.id, ids))
        : [];
      const byId = new Map(clockReadings.map((r) => [r.id, r.value]));
      const tz = await getCompanyTimezone();
      const from = zonedTimeToUtc(
        { ...parseDateKey(p.date), hour: 0, minute: 0 },
        tz,
      );
      const to = zonedTimeToUtc(
        { ...parseDateKey(addDaysToKey(p.date, 1)), hour: 0, minute: 0 },
        tz,
      );
      const day = await readingsOnDay(tx, v.id, from, to);
      const start =
        (te?.inOdometerId ? byId.get(te.inOdometerId) : undefined) ??
        day[0]?.value ??
        null;
      const endId = p.odometer_reading_id ?? te?.outOdometerId ?? null;
      const end =
        (endId ? byId.get(endId) : undefined) ?? day.at(-1)?.value ?? null;
      const jobs = await getTechDay(p.user_id, p.date).catch(() => []);
      const visited = jobs.filter((j) => j.arrivedAt || j.completedAt);
      const destinations = visited.map((j) => ({
        job_id: j.jobId,
        address_short: j.addressShort,
      }));
      const services = [
        ...new Set(visited.map((j) => j.serviceTypeName).filter(Boolean)),
      ];
      const purpose = visited.length
        ? `Service calls (${visited.length})${services.length ? `: ${services.join(", ")}` : ""}`
        : null;
      const miles =
        start != null && end != null && end >= start ? end - start : 0;
      const [existing] = await tx
        .select()
        .from(trips)
        .where(
          and(
            eq(trips.userId, p.user_id),
            eq(trips.tripDate, p.date),
            eq(trips.vehicleId, v.id),
          ),
        )
        .limit(1);
      if (existing) {
        // A second shift the same day extends the draft (never touches reviewed trips).
        if (existing.approvalStatus !== "pending") return;
        await tx
          .update(trips)
          .set({
            startOdometer: existing.startOdometer ?? start,
            endOdometer: end ?? existing.endOdometer,
            miles:
              (existing.startOdometer ?? start) != null && end != null
                ? Math.max(
                    0,
                    end - (existing.startOdometer ?? (start as number)),
                  )
                : existing.miles,
            destinations: [
              ...(existing.destinations ?? []),
              ...destinations.filter(
                (d) =>
                  !(existing.destinations ?? []).some(
                    (x) => x.job_id === d.job_id,
                  ),
              ),
            ],
            purpose: existing.purpose ?? purpose,
          })
          .where(eq(trips.id, existing.id));
        return;
      }
      const [row] = await tx
        .insert(trips)
        .values({
          userId: p.user_id,
          vehicleId: v.id,
          tripDate: p.date,
          startOdometer: start,
          endOdometer: end,
          miles,
          destinations,
          purpose,
          classification: "business",
          reimbursable: v.ownership === "tech_owned",
          approvalStatus: "pending",
        })
        .onConflictDoNothing()
        .returning({ id: trips.id });
      if (!row) return;
      await writeActivity(tx, {
        entity: { type: "vehicle", id: v.id },
        kind: "trip.drafted",
        summary: `Trip drafted for ${p.date}: ${miles} mi, ${destinations.length} stop${destinations.length === 1 ? "" : "s"}`,
        data: { trip_id: row.id },
        actorUserId: null,
      });
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
