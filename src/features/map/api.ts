import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { timeEntries, users } from "@/db/schema";
import { isEnabled } from "@/lib/settings";
import type { Geo } from "@/lib/types";
import { writeLocation } from "./engine";
import { isPlausibleFix } from "./rules";

// B7 map API (BUILD_PLAN §6.7). No permission checks (callers already did).

export type * from "./contracts";

/**
 * Status-change stamp → upsert tech_locations (source 'status') only if the map
 * flag is on, the user is clocked in AND acknowledged the monitoring notice (⚖️).
 * Runs inside the caller's transaction (B2 status transitions).
 */
export async function recordStatusLocation(
  tx: Tx,
  input: { userId: string; jobId: string; geo: Geo },
): Promise<void> {
  if (!(await isEnabled("map"))) return;
  if (!isPlausibleFix(input.geo.lat, input.geo.lng)) return;
  const [u] = await tx
    .select({ ack: users.monitoringNoticeAckAt })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!u?.ack) return;
  const open = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(eq(timeEntries.userId, input.userId), isNull(timeEntries.clockOutAt)),
    )
    .limit(1);
  if (open.length === 0) return;
  const at = input.geo.at ? new Date(input.geo.at) : new Date();
  const now = new Date();
  await writeLocation(tx, {
    userId: input.userId,
    lat: input.geo.lat,
    lng: input.geo.lng,
    accuracyM: input.geo.accuracyM ?? null,
    source: "status",
    jobId: input.jobId,
    recordedAt: Number.isNaN(at.getTime()) || at > now ? now : at,
  });
}
