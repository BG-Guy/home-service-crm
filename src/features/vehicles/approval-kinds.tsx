// Approval kinds produced by `vehicles` (BUILD_PLAN §6.10). Owner: B7.
// Rendered by B6's /approvals (Row + Detail) and by /vehicles/approvals.
import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  fuelLogs,
  odometerReadings,
  serviceRecords,
  trips,
  vehicleDocuments,
} from "@/db/schema";
import type {
  ApprovalDecision,
  ApprovalKindDef,
  ApprovalRow,
} from "@/features/approvals/contracts";
import { writeActivity } from "@/lib/activity";
import type { Actor } from "@/lib/types";
import { ReviewDetail, ReviewRow } from "./components/Review";
import {
  applyApproved,
  applyRejected,
  LOG_LABEL,
  notifyDecision,
  vehicleIdOf,
} from "./engine";
import { loadReviewItem } from "./review";
import type { VehicleLogType } from "./rules";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** "Edit and approve": apply reviewer corrections before the approval effects. */
async function applyEdits(
  tx: Tx,
  type: VehicleLogType,
  id: string,
  edits: Record<string, unknown> | undefined,
): Promise<void> {
  if (!edits) return;
  switch (type) {
    case "odometer": {
      const value = num(edits.value);
      if (value != null)
        await tx
          .update(odometerReadings)
          .set({ value, flags: [] })
          .where(eq(odometerReadings.id, id));
      return;
    }
    case "fuel": {
      const gallons = num(edits.gallons);
      const totalCents = num(edits.totalCents);
      const odometer = num(edits.odometer);
      const [f] = await tx
        .update(fuelLogs)
        .set({
          ...(gallons != null ? { gallons } : {}),
          ...(totalCents != null ? { totalCents: Math.round(totalCents) } : {}),
        })
        .where(eq(fuelLogs.id, id))
        .returning({ readingId: fuelLogs.odometerReadingId });
      if (odometer != null && f?.readingId)
        await tx
          .update(odometerReadings)
          .set({ value: Math.round(odometer) })
          .where(eq(odometerReadings.id, f.readingId));
      return;
    }
    case "service": {
      const costCents = num(edits.costCents);
      const odometer = num(edits.odometer);
      const tasks = Array.isArray(edits.tasks)
        ? (edits.tasks as unknown[]).map(String).filter(Boolean)
        : null;
      await tx
        .update(serviceRecords)
        .set({
          ...(costCents != null ? { costCents: Math.round(costCents) } : {}),
          ...(odometer != null ? { odometer: Math.round(odometer) } : {}),
          ...(tasks?.length ? { tasks } : {}),
        })
        .where(eq(serviceRecords.id, id));
      if (odometer != null)
        await tx
          .update(odometerReadings)
          .set({ value: Math.round(odometer) })
          .where(eq(odometerReadings.clientId, id));
      return;
    }
    case "document": {
      if (typeof edits.expiresOn === "string")
        await tx
          .update(vehicleDocuments)
          .set({ expiresOn: edits.expiresOn })
          .where(eq(vehicleDocuments.id, id));
      return;
    }
    case "trip": {
      const miles = num(edits.miles);
      if (miles != null)
        await tx.update(trips).set({ miles }).where(eq(trips.id, id));
      return;
    }
    default:
      return;
  }
}

async function onDecide(
  tx: Tx,
  approval: ApprovalRow,
  d: ApprovalDecision,
  actor: Actor,
): Promise<void> {
  const type = approval.entityType as VehicleLogType;
  if (d.decision === "approved") {
    await applyEdits(tx, type, approval.entityId, d.edits);
    await applyApproved(tx, type, approval.entityId, actor);
  } else {
    await applyRejected(tx, type, approval.entityId);
  }
  const vehicleId = await vehicleIdOf(tx, type, approval.entityId);
  if (vehicleId) {
    await writeActivity(tx, {
      entity: { type: "vehicle", id: vehicleId },
      kind:
        d.decision === "approved"
          ? "vehicle.log_approved"
          : "vehicle.log_rejected",
      summary: `${LOG_LABEL[type]} log ${d.decision}${d.edits ? " (edited)" : ""}${d.reason ? `: ${d.reason}` : ""}`,
      data: {
        entity_type: type,
        entity_id: approval.entityId,
        approval_id: approval.id,
      },
      actorUserId: actor.userId,
    });
  }
  await notifyDecision(tx, {
    requestedBy: approval.requestedBy,
    type,
    vehicleId,
    decision: d.decision,
    reason: d.reason ?? null,
    actorUserId: actor.userId,
  });
}

/** Snapshot check used by "Approve all clean" (no flags, no missing evidence, AI not pending). */
function clean(approval: ApprovalRow): boolean {
  const ev = (approval.evidence ?? {}) as {
    flags?: unknown[];
    missing?: unknown[];
    awaiting_ai?: boolean;
  };
  return (
    !(ev.flags?.length ?? 0) && !(ev.missing?.length ?? 0) && !ev.awaiting_ai
  );
}

async function Row({ approval }: { approval: ApprovalRow }) {
  const item = await loadReviewItem(approval);
  return item ? <ReviewRow item={item} /> : null;
}

async function Detail({ approval }: { approval: ApprovalRow }) {
  const item = await loadReviewItem(approval);
  return item ? <ReviewDetail item={item} /> : null;
}

const kind = (entityType: VehicleLogType, label: string): ApprovalKindDef => ({
  entityTypes: [entityType],
  perm: "vehicles.log_approve",
  label,
  Row,
  Detail,
  clean,
  onDecide,
});

export const approvalKinds: ApprovalKindDef[] = [
  kind("odometer", "Odometer readings"),
  kind("fuel", "Fuel logs"),
  kind("service", "Vehicle service"),
  kind("document", "Vehicle documents"),
  kind("inspection", "Vehicle inspections"),
  kind("trip", "Mileage trips"),
];
