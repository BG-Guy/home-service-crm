import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { aiProviderName } from "@/adapters/ai";
import { db, type Tx } from "@/db";
import {
  aiTasks,
  approvals,
  fuelLogs,
  inspections,
  media,
  mileageRates,
  odometerReadings,
  serviceRecords,
  trips,
  vehicleDocuments,
  vehicleReminderRules,
  vehicles,
} from "@/db/schema";
import { createApproval } from "@/features/approvals/api";
import { notify } from "@/features/notify/api";
import { postLedgerEntry } from "@/features/payroll/api";
import { writeActivity } from "@/lib/activity";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { Actor, SessionUser } from "@/lib/types";
import {
  ANOMALY_LABELS,
  DOCUMENT_TASKS,
  forecastReminder,
  MISSING_LABELS,
  mileageReimbursementCents,
  type PolicyOutcome,
  taskLabel,
  taskMatchKey,
  trailingAvgDailyMiles,
  type VehicleLogType,
  type VehiclePolicies,
} from "./rules";

// Vehicle log engine (SPEC M17): shared by actions, approval kinds, AI handlers,
// cron and event handlers. Everything takes the caller's `tx`; nothing here opens
// its own transaction or calls a provider.

export type VehicleRow = typeof vehicles.$inferSelect;

export const VEHICLE_TABLE: Record<VehicleLogType, string> = {
  odometer: "odometer_readings",
  fuel: "fuel_logs",
  service: "service_records",
  document: "vehicle_documents",
  inspection: "inspections",
  trip: "trips",
};

export const LOG_LABEL: Record<VehicleLogType, string> = {
  odometer: "Odometer",
  fuel: "Fuel",
  service: "Service",
  document: "Document",
  inspection: "Inspection",
  trip: "Trip",
};

export async function vehiclePolicies(): Promise<VehiclePolicies> {
  return (await getSettings()).vehicles.policies as VehiclePolicies;
}

export function aiEnabled(): boolean {
  return aiProviderName() !== "none";
}

// ------------------------------------------------------------------ access

export async function loadVehicle(
  exec: Tx,
  vehicleId: string,
): Promise<VehicleRow> {
  const [v] = await exec
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.deletedAt)))
    .limit(1);
  if (!v) throw new NotFoundError("Vehicle");
  return v;
}

/** Row scope: `view_all`, or `view_own` on the vehicle assigned to the viewer. */
export function canViewVehicle(
  user: SessionUser,
  v: Pick<VehicleRow, "assignedUserId">,
): boolean {
  if (user.perms.has("vehicles.view_all")) return true;
  return user.perms.has("vehicles.view_own") && v.assignedUserId === user.id;
}

/**
 * Logging scope: office/admin with `view_all` may log for any vehicle; everyone
 * else only for the vehicle assigned to them.
 */
export async function assertVehicleAccess(
  exec: Tx,
  user: SessionUser,
  vehicleId: string,
  mode: "view" | "log" | "manage",
): Promise<VehicleRow> {
  const v = await loadVehicle(exec, vehicleId);
  if (mode === "manage") {
    if (!user.perms.has("vehicles.manage"))
      throw new ForbiddenError(undefined, "vehicles.manage");
    return v;
  }
  if (!canViewVehicle(user, v))
    throw new ForbiddenError("That vehicle isn't assigned to you.");
  if (mode === "log" && v.status === "retired")
    throw new ForbiddenError("This vehicle is retired.");
  return v;
}

// ------------------------------------------------------------------ readings

export async function prevApprovedReading(
  exec: Tx,
  vehicleId: string,
  before: Date,
  excludeId?: string,
): Promise<{ value: number; at: Date } | null> {
  const [r] = await exec
    .select({ value: odometerReadings.value, at: odometerReadings.recordedAt })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, vehicleId),
        eq(odometerReadings.approvalStatus, "approved"),
        lte(odometerReadings.recordedAt, before),
        excludeId ? ne(odometerReadings.id, excludeId) : undefined,
      ),
    )
    .orderBy(desc(odometerReadings.recordedAt))
    .limit(1);
  return r ?? null;
}

/** Media attached to an entity by the uploader (offline uploads land after the row). */
export async function mediaForEntity(
  exec: Tx,
  entityType: string,
  entityId: string,
): Promise<string[]> {
  const rows = await exec
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.entityType, entityType),
        eq(media.entityId, entityId),
        isNull(media.deletedAt),
      ),
    )
    .orderBy(media.createdAt);
  return rows.map((r) => r.id);
}

/** Recompute odometer cache, trailing average and reminders after an approval. */
export async function refreshVehicleOdometer(
  exec: Tx,
  vehicleId: string,
  now = new Date(),
): Promise<void> {
  const rows = await exec
    .select({ value: odometerReadings.value, at: odometerReadings.recordedAt })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, vehicleId),
        eq(odometerReadings.approvalStatus, "approved"),
        gte(
          odometerReadings.recordedAt,
          new Date(now.getTime() - 90 * 86_400_000),
        ),
      ),
    )
    .orderBy(odometerReadings.recordedAt);
  const [latest] = await exec
    .select({ value: odometerReadings.value })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, vehicleId),
        eq(odometerReadings.approvalStatus, "approved"),
      ),
    )
    .orderBy(desc(odometerReadings.recordedAt))
    .limit(1);
  const avg = trailingAvgDailyMiles(rows, now);
  await exec
    .update(vehicles)
    .set({
      odometerCached: latest?.value ?? null,
      avgDailyMiles: avg,
      updatedAt: new Date(),
    })
    .where(eq(vehicles.id, vehicleId));
  await recomputeReminders(exec, vehicleId, now);
}

export interface ReminderChange {
  ruleId: string;
  task: string;
  from: string;
  to: string;
}

/** Forecast every active rule of a vehicle; returns status changes. */
export async function recomputeReminders(
  exec: Tx,
  vehicleId: string,
  now = new Date(),
): Promise<ReminderChange[]> {
  const tz = await getCompanyTimezone();
  const today = dateKey(now, tz);
  const [v] = await exec
    .select({
      odometer: vehicles.odometerCached,
      avg: vehicles.avgDailyMiles,
      recalls: vehicles.openRecalls,
    })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  if (!v) return [];
  const rules = await exec
    .select()
    .from(vehicleReminderRules)
    .where(
      and(
        eq(vehicleReminderRules.vehicleId, vehicleId),
        eq(vehicleReminderRules.active, true),
      ),
    );
  const docs = await exec
    .select({
      kind: vehicleDocuments.kind,
      expiresOn: vehicleDocuments.expiresOn,
    })
    .from(vehicleDocuments)
    .where(
      and(
        eq(vehicleDocuments.vehicleId, vehicleId),
        eq(vehicleDocuments.approvalStatus, "approved"),
      ),
    );
  const latestExpiry = (kind: string) =>
    docs
      .filter((d) => d.kind === kind && d.expiresOn)
      .map((d) => d.expiresOn as string)
      .sort()
      .pop() ?? null;
  const changes: ReminderChange[] = [];
  for (const r of rules) {
    let f = forecastReminder(r, {
      odometer: v.odometer,
      avgDailyMiles: v.avg,
      today,
      documentExpiresOn: DOCUMENT_TASKS.includes(r.task)
        ? latestExpiry(r.task)
        : null,
    });
    if (r.task === "recall") {
      const open = Array.isArray(v.recalls) ? v.recalls.length : 0;
      f = {
        nextDueOn: null,
        nextDueMiles: null,
        status: open > 0 ? "overdue" : "ok",
      };
    }
    if (
      f.status !== r.status ||
      f.nextDueOn !== r.nextDueOn ||
      f.nextDueMiles !== r.nextDueMiles
    ) {
      await exec
        .update(vehicleReminderRules)
        .set({
          status: f.status,
          nextDueOn: f.nextDueOn,
          nextDueMiles: f.nextDueMiles,
          updatedAt: new Date(),
        })
        .where(eq(vehicleReminderRules.id, r.id));
      if (f.status !== r.status) {
        changes.push({
          ruleId: r.id,
          task: r.task,
          from: r.status,
          to: f.status,
        });
        // Status changes into due_soon / overdue → vehicle.reminder_due (SPEC M17, §8.1).
        if (f.status !== "ok") {
          const entity = { type: "vehicle" as const, id: vehicleId };
          await emit(exec, "vehicle.reminder_due", entity, {
            vehicle_id: vehicleId,
            task: r.task,
            status: f.status,
          });
          await writeActivity(exec, {
            entity,
            kind: "vehicle.reminder_due",
            summary: `${taskLabel(r.task)} ${f.status === "overdue" ? "overdue" : "due soon"}`,
            data: { task: r.task, status: f.status, next_due_on: f.nextDueOn },
          });
        }
      }
    }
  }
  return changes;
}

/** Reset rules whose task was serviced (only from an APPROVED service record). */
export async function resetRemindersForService(
  exec: Tx,
  vehicleId: string,
  tasks: string[],
  performedOn: string,
  odometer: number | null,
): Promise<void> {
  if (tasks.length === 0) return;
  // Brakes services also satisfy the brake inspection reminder. Custom tasks match
  // regardless of case/spacing ("custom:DPF filter" resets a "dpf_filter" rule).
  const keys = new Set(tasks.map(taskMatchKey));
  if (keys.has("brakes")) keys.add("brake_inspection");
  if (keys.has("brake_inspection")) keys.add("brakes");
  await exec
    .update(vehicleReminderRules)
    .set({
      lastDoneOn: performedOn,
      lastDoneOdometer: odometer,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vehicleReminderRules.vehicleId, vehicleId),
        inArray(
          sql`regexp_replace(regexp_replace(lower(trim(${vehicleReminderRules.task})), '^custom:', ''), '[[:space:]_]+', '_', 'g')`,
          [...keys],
        ),
      ),
    );
}

/** Create the seeded reminder rules for a new vehicle (baseline = today/odometer). */
export async function seedReminderRules(
  exec: Tx,
  vehicleId: string,
  odometer: number | null,
  today: string,
): Promise<void> {
  const seeds = (await getSettings()).vehicles.reminder_seeds;
  if (seeds.length === 0) return;
  await exec
    .insert(vehicleReminderRules)
    .values(
      seeds.map((s) => {
        const doc =
          DOCUMENT_TASKS.includes(s.task) &&
          !s.interval_miles &&
          !s.interval_days;
        return {
          vehicleId,
          task: s.task,
          intervalMiles: s.interval_miles,
          intervalDays: s.interval_days,
          dueSoonMiles: s.due_soon_miles,
          dueSoonDays: s.due_soon_days,
          lastDoneOn: doc ? null : today,
          lastDoneOdometer: doc ? null : odometer,
        };
      }),
    )
    .onConflictDoNothing();
}

// ------------------------------------------------------------------ submit

export interface FinalizeInput {
  type: VehicleLogType;
  entityId: string;
  vehicle: Pick<VehicleRow, "id" | "nickname">;
  outcome: PolicyOutcome;
  flags: string[];
  missing: string[];
  /** Snapshot for the approval row: typed values, AI, previous reading, media ids. */
  evidence: Record<string, unknown>;
  summary: string;
  requestedBy: string | null;
  actor: Actor;
}

/**
 * After a log row is inserted with its approval status: open the review item when
 * pending, emit `vehicle.log_submitted` (+ `vehicle.anomaly`), write the vehicle
 * timeline, and apply approval effects right away when approved.
 */
export async function finalizeLog(
  tx: Tx,
  i: FinalizeInput,
): Promise<{ approvalId: string | null }> {
  let approvalId: string | null = null;
  if (i.outcome.status === "pending") {
    const res = await createApproval(
      tx,
      {
        entityType: i.type,
        entityId: i.entityId,
        policy: i.outcome.effectivePolicy,
        requestedBy: i.requestedBy,
        evidence: {
          ...i.evidence,
          vehicle_id: i.vehicle.id,
          vehicle: i.vehicle.nickname,
          flags: i.flags,
          missing: i.missing,
          reason: i.outcome.reason,
          awaiting_ai: i.outcome.reason === "awaiting_ai",
        },
      },
      i.actor,
    );
    approvalId = res.approvalId;
  }
  const entity = { type: "vehicle" as const, id: i.vehicle.id };
  await emit(
    tx,
    "vehicle.log_submitted",
    entity,
    {
      entity_type: i.type,
      entity_id: i.entityId,
      vehicle_id: i.vehicle.id,
      approval_id: approvalId,
    },
    { actor: i.actor },
  );
  await writeActivity(tx, {
    entity,
    kind: "vehicle.log_submitted",
    summary: `${i.summary}${i.outcome.status === "pending" ? " · in review" : ""}`,
    data: {
      entity_type: i.type,
      entity_id: i.entityId,
      status: i.outcome.status,
      reason: i.outcome.reason,
    },
    actorUserId: i.actor.userId,
  });
  if (i.flags.length) {
    await emit(
      tx,
      "vehicle.anomaly",
      entity,
      { vehicle_id: i.vehicle.id, flags: i.flags },
      { actor: i.actor },
    );
    await writeActivity(tx, {
      entity,
      kind: "vehicle.anomaly",
      summary: `Flagged: ${i.flags.map((f) => ANOMALY_LABELS[f] ?? f).join(", ")}`,
      data: { flags: i.flags, entity_type: i.type, entity_id: i.entityId },
      actorUserId: i.actor.userId,
    });
  }
  if (i.outcome.status === "approved")
    await applyApproved(tx, i.type, i.entityId, i.actor);
  return { approvalId };
}

export function reviewReasonText(flags: string[], missing: string[]): string {
  const parts = [
    ...flags.map((f) => ANOMALY_LABELS[f] ?? f),
    ...missing.map((m) => MISSING_LABELS[m] ?? m),
  ];
  return parts.join(" · ");
}

// ------------------------------------------------------------------ decisions

async function setStatus(
  exec: Tx,
  type: VehicleLogType,
  id: string,
  status: "approved" | "rejected",
): Promise<void> {
  switch (type) {
    case "odometer":
      await exec
        .update(odometerReadings)
        .set({ approvalStatus: status })
        .where(eq(odometerReadings.id, id));
      return;
    case "fuel": {
      const [f] = await exec
        .update(fuelLogs)
        .set({ approvalStatus: status })
        .where(eq(fuelLogs.id, id))
        .returning({ readingId: fuelLogs.odometerReadingId });
      if (f?.readingId)
        await exec
          .update(odometerReadings)
          .set({ approvalStatus: status })
          .where(eq(odometerReadings.id, f.readingId));
      return;
    }
    case "service":
      await exec
        .update(serviceRecords)
        .set({ approvalStatus: status })
        .where(eq(serviceRecords.id, id));
      // The reading created alongside the record shares its fate.
      await exec
        .update(odometerReadings)
        .set({ approvalStatus: status })
        .where(
          and(
            eq(odometerReadings.source, "service"),
            eq(odometerReadings.clientId, id),
          ),
        );
      return;
    case "document":
      await exec
        .update(vehicleDocuments)
        .set({ approvalStatus: status })
        .where(eq(vehicleDocuments.id, id));
      return;
    case "inspection":
      await exec
        .update(inspections)
        .set({ approvalStatus: status })
        .where(eq(inspections.id, id));
      return;
    case "trip":
      await exec
        .update(trips)
        .set({ approvalStatus: status })
        .where(eq(trips.id, id));
      return;
  }
}

/** Vehicle id of a log row (for revalidation and effects). */
export async function vehicleIdOf(
  exec: Tx,
  type: VehicleLogType,
  id: string,
): Promise<string | null> {
  const t = {
    odometer: odometerReadings,
    fuel: fuelLogs,
    service: serviceRecords,
    document: vehicleDocuments,
    inspection: inspections,
    trip: trips,
  }[type];
  const [r] = await exec
    .select({ v: t.vehicleId })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  return r?.v ?? null;
}

/**
 * Approval effects (SPEC M17): odometer cache + reminders; service resets its
 * reminders; documents feed expiry reminders; approved reimbursable trips post the
 * mileage line. Idempotent: re-applying an approved row is harmless.
 */
export async function applyApproved(
  tx: Tx,
  type: VehicleLogType,
  id: string,
  actor: Actor,
): Promise<void> {
  await setStatus(tx, type, id, "approved");
  const vehicleId = await vehicleIdOf(tx, type, id);
  if (!vehicleId) return;
  if (type === "service") {
    const [s] = await tx
      .select()
      .from(serviceRecords)
      .where(eq(serviceRecords.id, id))
      .limit(1);
    if (s)
      await resetRemindersForService(
        tx,
        vehicleId,
        s.tasks,
        s.performedOn,
        s.odometer,
      );
  }
  if (type === "trip") await postTripReimbursement(tx, id, actor);
  await refreshVehicleOdometer(tx, vehicleId);
}

export async function applyRejected(
  tx: Tx,
  type: VehicleLogType,
  id: string,
): Promise<void> {
  await setStatus(tx, type, id, "rejected");
  const vehicleId = await vehicleIdOf(tx, type, id);
  if (vehicleId) await refreshVehicleOdometer(tx, vehicleId);
}

/** Mileage rate (millicents/mile) effective on a date (latest effective_from ≤ date). */
export async function mileageRateOn(
  exec: Tx,
  day: string,
): Promise<number | null> {
  const [r] = await exec
    .select({ rate: mileageRates.millicentsPerMile })
    .from(mileageRates)
    .where(lte(mileageRates.effectiveFrom, day))
    .orderBy(desc(mileageRates.effectiveFrom))
    .limit(1);
  return r?.rate ?? null;
}

async function postTripReimbursement(
  tx: Tx,
  tripId: string,
  actor: Actor,
): Promise<void> {
  const [t] = await tx
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  if (
    !t ||
    !t.reimbursable ||
    t.ledgerEntryId ||
    t.classification !== "business"
  )
    return;
  const rate = await mileageRateOn(tx, t.tripDate);
  if (!rate || t.miles <= 0) return;
  const amount = mileageReimbursementCents(t.miles, rate);
  if (amount <= 0) return;
  const { ledgerEntryId } = await postLedgerEntry(
    tx,
    {
      userId: t.userId,
      type: "reimbursement_mileage",
      amountCents: amount,
      effectiveDate: t.tripDate,
      refTable: "trips",
      refId: t.id,
      memo: `${t.miles} mi business @ ${(rate / 1000).toFixed(1)}¢`,
    },
    actor,
  );
  await tx.update(trips).set({ ledgerEntryId }).where(eq(trips.id, t.id));
}

/** Tell the submitter how their log was decided (in-app; push per prefs). */
export async function notifyDecision(
  tx: Tx,
  i: {
    requestedBy: string | null;
    type: VehicleLogType;
    vehicleId: string | null;
    decision: "approved" | "rejected";
    reason?: string | null;
    actorUserId: string | null;
  },
): Promise<void> {
  if (!i.requestedBy || i.requestedBy === i.actorUserId) return;
  if (i.decision === "approved") return; // quiet on approval; rejections need action
  await notify(tx, {
    to: { userIds: [i.requestedBy] },
    type: "staff.generic",
    title: `${LOG_LABEL[i.type]} log rejected`,
    body: i.reason
      ? `Reason: ${i.reason}`
      : "Open the vehicle to log it again.",
    url: i.vehicleId ? `/vehicles/${i.vehicleId}?tab=logs` : "/vehicles",
    entity: i.vehicleId ? { type: "vehicle", id: i.vehicleId } : undefined,
  });
}

// ------------------------------------------------------------------ AI lookups

/** Latest AI task touching any of these media (for typed-vs-AI display). */
export async function aiTaskForMedia(
  mediaIds: string[],
  kinds: string[],
): Promise<typeof aiTasks.$inferSelect | null> {
  if (mediaIds.length === 0) return null;
  const rows = await db
    .select()
    .from(aiTasks)
    .where(
      and(
        inArray(aiTasks.kind, kinds),
        sql`${aiTasks.mediaIds} && ${sql.raw(`ARRAY[${mediaIds.map((m) => `'${m.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]`)}`,
      ),
    )
    .orderBy(desc(aiTasks.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Pending approval row of a vehicle log, if any. */
export async function pendingApprovalFor(
  exec: Tx,
  type: VehicleLogType,
  id: string,
): Promise<typeof approvals.$inferSelect | null> {
  const [a] = await exec
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, type),
        eq(approvals.entityId, id),
        eq(approvals.status, "pending"),
      ),
    )
    .limit(1);
  return a ?? null;
}

/** Daily-inspection due check for the start-of-day prompt. */
export async function inspectionDue(
  exec: Tx,
  vehicleId: string,
  now = new Date(),
): Promise<boolean> {
  const freq = (await getSettings()).vehicles.inspection_frequency;
  if (freq === "none") return false;
  const tz = await getCompanyTimezone();
  const since =
    freq === "daily"
      ? new Date(now.getTime() - 20 * 3600_000)
      : new Date(now.getTime() - 7 * 86_400_000);
  const [r] = await exec
    .select({ id: inspections.id, at: inspections.createdAt })
    .from(inspections)
    .where(
      and(
        eq(inspections.vehicleId, vehicleId),
        ne(inspections.approvalStatus, "rejected"),
        gte(inspections.createdAt, since),
      ),
    )
    .orderBy(desc(inspections.createdAt))
    .limit(1);
  if (!r) return true;
  if (freq === "daily") return dateKey(r.at, tz) !== dateKey(now, tz);
  return false;
}

/** Odometer readings recorded on a company-local day (for trip drafting). */
export async function readingsOnDay(
  exec: Tx,
  vehicleId: string,
  from: Date,
  to: Date,
) {
  return exec
    .select({
      id: odometerReadings.id,
      value: odometerReadings.value,
      at: odometerReadings.recordedAt,
    })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, vehicleId),
        ne(odometerReadings.approvalStatus, "rejected"),
        gte(odometerReadings.recordedAt, from),
        lt(odometerReadings.recordedAt, to),
      ),
    )
    .orderBy(odometerReadings.recordedAt);
}

export { taskLabel };
