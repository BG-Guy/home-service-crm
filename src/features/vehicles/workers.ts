// job_queue workers for `vehicles` (BUILD_PLAN §4, §8.2). Owner: B7.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
// Provider calls happen OUTSIDE any transaction (PGlite has one connection).
import "server-only";
import { eq } from "drizzle-orm";
import { getVinDecoder } from "@/adapters/vin";
import { db } from "@/db";
import { vehicleReminderRules, vehicles } from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import type { JobQueueKind, Worker } from "@/lib/queue";
import { SYSTEM_ACTOR } from "@/lib/types";
import { recomputeReminders } from "./engine";

/** Decode the VIN (NHTSA vPIC) and fill empty fields; never overwrites typed values. */
const vin: Worker = async (payload) => {
  const vehicleId = String(payload.vehicleId ?? "");
  const [v] = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  if (!v?.vin) return;
  const d = await getVinDecoder().decode(v.vin, v.year ?? undefined);
  if (!d) return;
  const prev = (v.decoded as Record<string, unknown> | null) ?? {};
  await db.transaction(async (tx) => {
    await tx
      .update(vehicles)
      .set({
        year: v.year ?? d.year,
        make: v.make ?? d.make,
        model: v.model ?? d.model,
        trim: v.trim ?? d.trim,
        engine: v.engine ?? d.engine,
        fuelType: v.fuelType ?? d.fuel,
        gvwrLbs: v.gvwrLbs ?? d.gvwrLb,
        decoded: {
          ...prev,
          vin: d.vin,
          year: d.year,
          make: d.make,
          model: d.model,
          trim: d.trim,
          engine: d.engine,
          fuel: d.fuel,
          gvwr: d.gvwr,
          gvwr_lb: d.gvwrLb,
          body_class: d.bodyClass,
          drive_type: d.driveType,
          decoded_at: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(vehicles.id, v.id));
  });
  if (!v.year || !v.make || !v.model) {
    const { enqueueJob } = await import("@/lib/queue");
    await enqueueJob(
      null,
      "recalls",
      { vehicleId: v.id },
      { dedupeKey: `recalls:${v.id}:vin` },
    );
  }
};

/** NHTSA recalls → open_recalls + the `recall` reminder (overdue while any is open). */
const recalls: Worker = async (payload) => {
  const vehicleId = String(payload.vehicleId ?? "");
  const [v] = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  if (!v?.make || !v.model || !v.year) return;
  const list = await getVinDecoder().recalls(v.make, v.model, v.year);
  const known = new Set(
    (Array.isArray(v.openRecalls) ? v.openRecalls : []).map(
      (r) => (r as { campaign?: string }).campaign,
    ),
  );
  const fresh = list.filter((r) => r.campaign && !known.has(r.campaign));
  await db.transaction(async (tx) => {
    await tx
      .update(vehicles)
      .set({ openRecalls: list, updatedAt: new Date() })
      .where(eq(vehicles.id, v.id));
    if (list.length > 0) {
      await tx
        .insert(vehicleReminderRules)
        .values({ vehicleId: v.id, task: "recall", dueSoonDays: 0 })
        .onConflictDoNothing();
    }
    await recomputeReminders(tx, v.id);
    if (fresh.length > 0)
      await writeActivity(tx, {
        entity: { type: "vehicle", id: v.id },
        kind: "vehicle.recalls_found",
        summary: `${fresh.length} open recall${fresh.length === 1 ? "" : "s"} found (NHTSA)`,
        data: { campaigns: fresh.map((r) => r.campaign) },
        actorUserId: SYSTEM_ACTOR.userId,
      });
  });
};

export const workers: Partial<Record<JobQueueKind, Worker>> = { vin, recalls };
