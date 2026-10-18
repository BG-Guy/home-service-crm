import "server-only";
import { and, count, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { aiProviderName } from "@/adapters/ai";
import { db, execRows } from "@/db";
import {
  fuelLogs,
  serviceRecords,
  vehicleIssues,
  vehicleReminderRules,
  vehicles,
} from "@/db/schema";
import { getSettings } from "@/lib/settings";
import type { AssignedVehicle, FleetSummary } from "./contracts";
import {
  type ApprovalHint,
  approvalHint,
  type PolicyUser,
  type VehiclePolicies,
} from "./rules";

// B7 vehicles API (BUILD_PLAN §6.7). No permission checks (callers already did).

export type * from "./contracts";

/**
 * What happens when this viewer saves an odometer reading (copy only), for screens
 * outside the vehicles module that host OdometerCaptureButton (B2 ClockCard).
 * Same rule as the vehicle page: `rules.ts#approvalHint`.
 */
export async function odometerApprovalHint(
  viewer: PolicyUser,
): Promise<ApprovalHint> {
  const settings = await getSettings();
  return approvalHint(
    viewer,
    "odometer",
    settings.vehicles.policies as VehiclePolicies,
    aiProviderName() !== "none",
  );
}

/** The non-retired vehicle assigned to a user (B2 clock, B5). */
export async function getAssignedVehicle(
  userId: string,
): Promise<AssignedVehicle | null> {
  const [v] = await db
    .select({
      id: vehicles.id,
      nickname: vehicles.nickname,
      odometer: vehicles.odometerCached,
      ownership: vehicles.ownership,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.assignedUserId, userId),
        ne(vehicles.status, "retired"),
        isNull(vehicles.deletedAt),
      ),
    )
    .orderBy(vehicles.createdAt)
    .limit(1);
  return v
    ? { ...v, ownership: v.ownership as AssignedVehicle["ownership"] }
    : null;
}

/** Cached latest APPROVED reading (B5 `every_n_miles` reminders). */
export async function getVehicleOdometer(
  vehicleId: string,
): Promise<number | null> {
  const [v] = await db
    .select({ odometer: vehicles.odometerCached })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  return v?.odometer ?? null;
}

/**
 * Fleet KPIs for [from, to): miles from approved readings (per vehicle: max in
 * range − last reading before range, else min in range), approved fuel and
 * service spend, cost per mile, current overdue / due-soon reminders and open issues.
 */
export async function getFleetSummary(
  from: Date,
  to: Date,
): Promise<FleetSummary> {
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);
  const [miles, fuel, service, rem, issues] = await Promise.all([
    execRows<{ miles: number }>(sql`
      with active as (
        select id from vehicles where deleted_at is null
      ),
      hi as (
        select vehicle_id, max(value) as v from odometer_readings
        where approval_status = 'approved' and recorded_at >= ${from.toISOString()}::timestamptz
          and recorded_at < ${to.toISOString()}::timestamptz
        group by vehicle_id
      ),
      base as (
        select distinct on (vehicle_id) vehicle_id, value as v from odometer_readings
        where approval_status = 'approved' and recorded_at < ${from.toISOString()}::timestamptz
        order by vehicle_id, recorded_at desc
      ),
      lo as (
        select vehicle_id, min(value) as v from odometer_readings
        where approval_status = 'approved' and recorded_at >= ${from.toISOString()}::timestamptz
          and recorded_at < ${to.toISOString()}::timestamptz
        group by vehicle_id
      )
      select coalesce(sum(greatest(0, hi.v - coalesce(base.v, lo.v))), 0)::int as miles
      from hi join active a on a.id = hi.vehicle_id
      left join base on base.vehicle_id = hi.vehicle_id
      left join lo on lo.vehicle_id = hi.vehicle_id`),
    db
      .select({
        c: sql<number>`coalesce(sum(${fuelLogs.totalCents}),0)::bigint`,
      })
      .from(fuelLogs)
      .where(
        and(
          eq(fuelLogs.approvalStatus, "approved"),
          gte(fuelLogs.filledAt, from),
          lt(fuelLogs.filledAt, to),
        ),
      ),
    db
      .select({
        c: sql<number>`coalesce(sum(${serviceRecords.costCents}),0)::bigint`,
      })
      .from(serviceRecords)
      .where(
        and(
          eq(serviceRecords.approvalStatus, "approved"),
          gte(serviceRecords.performedOn, fromKey),
          lt(serviceRecords.performedOn, toKey),
        ),
      ),
    db
      .select({ status: vehicleReminderRules.status, n: count() })
      .from(vehicleReminderRules)
      .innerJoin(vehicles, eq(vehicles.id, vehicleReminderRules.vehicleId))
      .where(
        and(
          eq(vehicleReminderRules.active, true),
          inArray(vehicleReminderRules.status, ["overdue", "due_soon"]),
          isNull(vehicles.deletedAt),
          ne(vehicles.status, "retired"),
        ),
      )
      .groupBy(vehicleReminderRules.status),
    db
      .select({ n: count() })
      .from(vehicleIssues)
      .where(sql`${vehicleIssues.status} <> 'resolved'`),
  ]);
  const m = Number(miles[0]?.miles ?? 0);
  const fuelCents = Number(fuel[0]?.c ?? 0);
  const serviceCents = Number(service[0]?.c ?? 0);
  return {
    costPerMileCents: m > 0 ? Math.round((fuelCents + serviceCents) / m) : null,
    fuelSpendCents: fuelCents,
    miles: m,
    overdueReminders: Number(rem.find((r) => r.status === "overdue")?.n ?? 0),
    dueSoon: Number(rem.find((r) => r.status === "due_soon")?.n ?? 0),
    openIssues: Number(issues[0]?.n ?? 0),
  };
}
