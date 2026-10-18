// Cron hooks for `vehicles` (BUILD_PLAN §4, §8.1). Owner: B7.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import "server-only";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { activity, vehicleDocuments, vehicles } from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import type { CronHook } from "@/lib/cron";
import { emit } from "@/lib/events";
import { enqueueJob } from "@/lib/queue";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { refreshVehicleOdometer } from "./engine";
import {
  daysBetween,
  docKindLabel as docLabel,
  documentWarningDue,
  documentWindow,
} from "./rules";

const DOC_EXPIRING = "vehicle.document_expiring";

/**
 * Tightest threshold already alerted per document, from the activity log the
 * warning writes (older rows without `threshold` are derived from their date).
 */
async function alertedThresholds(
  vehicleIds: string[],
  thresholds: readonly number[],
  tz: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (vehicleIds.length === 0) return out;
  const rows = await db
    .select({ data: activity.data, createdAt: activity.createdAt })
    .from(activity)
    .where(
      and(
        eq(activity.entityType, "vehicle"),
        inArray(activity.entityId, vehicleIds),
        eq(activity.kind, DOC_EXPIRING),
      ),
    );
  for (const r of rows) {
    const d = (r.data ?? {}) as {
      vehicle_document_id?: string;
      threshold?: number;
      expires_on?: string;
    };
    if (!d.vehicle_document_id) continue;
    const t =
      typeof d.threshold === "number"
        ? d.threshold
        : d.expires_on
          ? documentWindow(
              daysBetween(dateKey(r.createdAt, tz), d.expires_on),
              thresholds,
            )
          : null;
    if (t == null) continue;
    const cur = out.get(d.vehicle_document_id);
    if (cur == null || t < cur) out.set(d.vehicle_document_id, t);
  }
  return out;
}

async function activeVehicleIds(): Promise<string[]> {
  const rows = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(isNull(vehicles.deletedAt), ne(vehicles.status, "retired")));
  return rows.map((r) => r.id);
}

export const cronHooks: CronHook[] = [
  {
    // Forecast from trailing 30-day miles; status changes emit vehicle.reminder_due.
    key: "vehicles.reminders",
    schedule: { dailyAt: "05:00" },
    async run({ now }) {
      if (!(await isEnabled("vehicles"))) return;
      for (const id of await activeVehicleIds()) {
        await db.transaction((tx) => refreshVehicleOdometer(tx, id, now));
      }
    },
  },
  {
    // Inside the 30 / 14 / 3-day windows → vehicle.document_expiring, once per
    // window per document (catches up after a missed day; QA T6-08).
    key: "vehicles.documents",
    schedule: { dailyAt: "05:10" },
    async run({ now }) {
      if (!(await isEnabled("vehicles"))) return;
      const tz = await getCompanyTimezone();
      const today = dateKey(now, tz);
      const thresholds = (await getSettings()).vehicles.document_warning_days;
      const docs = await db
        .select({
          id: vehicleDocuments.id,
          vehicleId: vehicleDocuments.vehicleId,
          kind: vehicleDocuments.kind,
          expiresOn: vehicleDocuments.expiresOn,
        })
        .from(vehicleDocuments)
        .innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
        .where(
          and(
            eq(vehicleDocuments.approvalStatus, "approved"),
            isNotNull(vehicleDocuments.expiresOn),
            isNull(vehicles.deletedAt),
            ne(vehicles.status, "retired"),
          ),
        );
      // Only the latest document of each kind per vehicle matters.
      const latest = new Map<string, (typeof docs)[number]>();
      for (const d of docs) {
        const k = `${d.vehicleId}:${d.kind}`;
        const cur = latest.get(k);
        if (!cur || (d.expiresOn ?? "") > (cur.expiresOn ?? ""))
          latest.set(k, d);
      }
      const alerted = await alertedThresholds(
        [...new Set([...latest.values()].map((d) => d.vehicleId))],
        thresholds,
        tz,
      );
      for (const d of latest.values()) {
        const due = documentWarningDue(
          d.expiresOn as string,
          today,
          thresholds,
          alerted.get(d.id) ?? null,
        );
        if (!due) continue;
        const days = due.daysLeft;
        await db.transaction(async (tx) => {
          const entity = { type: "vehicle" as const, id: d.vehicleId };
          await emit(tx, DOC_EXPIRING, entity, {
            vehicle_document_id: d.id,
            days,
          });
          await writeActivity(tx, {
            entity,
            kind: DOC_EXPIRING,
            summary:
              days === 0
                ? `${docLabel(d.kind)} expires today`
                : `${docLabel(d.kind)} expires in ${days} day${days === 1 ? "" : "s"}`,
            data: {
              vehicle_document_id: d.id,
              expires_on: d.expiresOn,
              threshold: due.threshold,
            },
            actorUserId: null,
          });
        });
      }
    },
  },
  {
    // Monthly NHTSA recalls refresh (worker kind `recalls`).
    key: "vehicles.recalls",
    schedule: { monthlyAt: { day: 2, time: "04:00" } },
    async run({ now }) {
      if (!(await isEnabled("vehicles"))) return;
      const month = now.toISOString().slice(0, 7);
      for (const id of await activeVehicleIds()) {
        await enqueueJob(
          null,
          "recalls",
          { vehicleId: id },
          { dedupeKey: `recalls:${id}:${month}` },
        );
      }
    },
  },
];
