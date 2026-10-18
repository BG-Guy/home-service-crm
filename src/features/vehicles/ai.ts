// AI result handlers for `vehicles` (BUILD_PLAN §4, §8.3). Owner: B7.
// Called by the F AI worker with the validated output (or null when skipped/failed).
// Results are suggestions: they fill ai_* fields and, when an `auto_if_evidence`
// entry was only waiting for the cross-check and it matches, approve it as SYSTEM.
// The handler receives the task (not the entity ref), so entities are found by media id.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { AiHandler } from "@/adapters/ai/handlers";
import type { AiTaskKind } from "@/adapters/ai/types";
import { db, type Tx } from "@/db";
import {
  approvals,
  fuelLogs,
  odometerReadings,
  serviceRecords,
} from "@/db/schema";
import { decideApproval } from "@/features/approvals/api";
import { SYSTEM_ACTOR } from "@/lib/types";
import { odometerMatches, receiptTotalMatches } from "./rules";

async function autoApproveIfWaiting(
  tx: Tx,
  entityType: "odometer" | "fuel" | "service",
  entityId: string,
  matches: boolean,
  hasFlags: boolean,
): Promise<void> {
  const [a] = await tx
    .select({ id: approvals.id, evidence: approvals.evidence })
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, entityType),
        eq(approvals.entityId, entityId),
        eq(approvals.status, "pending"),
      ),
    )
    .limit(1);
  if (!a) return;
  const ev = (a.evidence ?? {}) as {
    awaiting_ai?: boolean;
    missing?: string[];
  };
  if (!ev.awaiting_ai || (ev.missing?.length ?? 0) > 0) return;
  if (!matches || hasFlags) return; // stays in review with the AI values shown
  await decideApproval(
    tx,
    a.id,
    {
      decision: "approved",
      reason: "Auto-approved: photo matches the typed value",
    },
    SYSTEM_ACTOR,
  );
}

const odometer: AiHandler = async (task, output) => {
  if (task.mediaIds.length === 0) return;
  const o = output as {
    reading?: number | null;
    unit?: string | null;
    confidence?: number;
  } | null;
  const value =
    o?.reading != null && Number.isFinite(o.reading)
      ? Math.round(o.unit === "km" ? o.reading * 0.621371 : o.reading)
      : null;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(odometerReadings)
      .where(inArray(odometerReadings.photoMediaId, task.mediaIds));
    for (const r of rows) {
      if (value != null)
        await tx
          .update(odometerReadings)
          .set({ aiValue: value, aiConfidence: o?.confidence ?? null })
          .where(eq(odometerReadings.id, r.id));
      if (r.approvalStatus !== "pending" || value == null) continue;
      await autoApproveIfWaiting(
        tx,
        "odometer",
        r.id,
        odometerMatches(r.value, value),
        r.flags.length > 0,
      );
    }
  });
};

const receipt: AiHandler = async (task, output) => {
  if (task.mediaIds.length === 0) return;
  const o = output as { total_cents?: number | null } | null;
  const total = typeof o?.total_cents === "number" ? o.total_cents : null;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(fuelLogs)
      .where(inArray(fuelLogs.receiptMediaId, task.mediaIds));
    for (const f of rows) {
      if (f.approvalStatus !== "pending" || total == null) continue;
      await autoApproveIfWaiting(
        tx,
        "fuel",
        f.id,
        receiptTotalMatches(f.totalCents, total),
        f.flags.length > 0,
      );
    }
  });
};

const shopInvoice: AiHandler = async (task, output) => {
  if (task.mediaIds.length === 0) return;
  const o = output as {
    tasks?: string[];
    total_cents?: number | null;
    odometer?: number | null;
    vendor?: string | null;
    date?: string | null;
    confidence?: number;
  } | null;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(serviceRecords)
      .where(inArray(serviceRecords.receiptMediaId, task.mediaIds));
    for (const s of rows) {
      if (o) {
        // Suggested reminder tasks are mapped to our task keys; an admin confirms them.
        const tasks = (o.tasks ?? [])
          .map((t) =>
            t
              .trim()
              .toLowerCase()
              .replace(/[\s-]+/g, "_"),
          )
          .filter(Boolean)
          .slice(0, 12);
        await tx
          .update(serviceRecords)
          .set({ aiExtract: { ...o, tasks } })
          .where(eq(serviceRecords.id, s.id));
      }
      if (
        s.approvalStatus !== "pending" ||
        o?.total_cents == null ||
        s.costCents == null
      )
        continue;
      await autoApproveIfWaiting(
        tx,
        "service",
        s.id,
        receiptTotalMatches(s.costCents, o.total_cents),
        false,
      );
    }
  });
};

/** Text results stay in ai_tasks.output; the UI polls them by task id. */
const textResult: AiHandler = async () => {};

export const aiHandlers: Partial<Record<AiTaskKind, AiHandler>> = {
  odometer,
  receipt,
  shop_invoice: shopInvoice,
  maintenance_suggest: textResult,
  explain_flags: textResult,
};
