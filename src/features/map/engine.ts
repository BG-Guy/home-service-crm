import "server-only";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  jobAssignments,
  jobs,
  locationBreadcrumbs,
  techLocations,
} from "@/db/schema";
import { getClockStatuses } from "@/features/time/api";
import { getSettings, isEnabled } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { isPlausibleFix } from "./rules";

// Location engine (SPEC M19, §6.13). Pings and status stamps upsert the tech's
// last-known position; breadcrumbs only when `settings.map.keep_breadcrumbs_days > 0`.
// ⚖️ Accepted only while clocked in and after the monitoring notice was acknowledged.

export const ACTIVE_JOB_STATUSES = [
  "en_route",
  "arrived",
  "in_progress",
] as const;

export interface PingInput {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  heading?: number | null;
  speed?: number | null;
  /** Device fix time (ms or ISO); clamped to now. */
  at?: string | number | null;
}

export type ShareState =
  | { share: true; intervalSec: number }
  | {
      share: false;
      reason:
        | "flag_off"
        | "no_permission"
        | "notice_not_acked"
        | "not_clocked_in";
      intervalSec: number;
    };

/** May this user share location right now? (flag, perm, notice, clocked in) */
export async function shareState(user: SessionUser): Promise<ShareState> {
  const intervalSec = Math.max(60, (await getSettings()).map.ping_interval_sec);
  if (!(await isEnabled("map")))
    return { share: false, reason: "flag_off", intervalSec };
  if (!user.perms.has("location.share"))
    return { share: false, reason: "no_permission", intervalSec };
  if (!user.monitoringNoticeAckAt)
    return { share: false, reason: "notice_not_acked", intervalSec };
  const clock = (await getClockStatuses([user.id]))[user.id];
  if (!clock?.clockedIn)
    return { share: false, reason: "not_clocked_in", intervalSec };
  return { share: true, intervalSec };
}

/** The tech's active job (en route / arrived / in progress), if any. */
export async function activeJobFor(
  exec: Tx,
  userId: string,
): Promise<string | null> {
  const [r] = await exec
    .select({ id: jobs.id })
    .from(jobAssignments)
    .innerJoin(jobs, eq(jobs.id, jobAssignments.jobId))
    .where(
      and(
        eq(jobAssignments.userId, userId),
        inArray(jobs.status, [...ACTIVE_JOB_STATUSES]),
      ),
    )
    .orderBy(desc(jobs.updatedAt))
    .limit(1);
  return r?.id ?? null;
}

/** Upsert the last-known position (+ optional breadcrumb). */
export async function writeLocation(
  exec: Tx,
  i: {
    userId: string;
    lat: number;
    lng: number;
    accuracyM: number | null;
    heading?: number | null;
    speed?: number | null;
    source: "ping" | "status";
    jobId: string | null;
    recordedAt: Date;
  },
): Promise<void> {
  const values = {
    userId: i.userId,
    lat: i.lat,
    lng: i.lng,
    accuracyM: i.accuracyM,
    heading: i.heading ?? null,
    speed: i.speed ?? null,
    source: i.source,
    jobId: i.jobId,
    recordedAt: i.recordedAt,
  };
  // Never move the marker backwards in time (late status stamps, replays).
  await exec
    .insert(techLocations)
    .values(values)
    .onConflictDoUpdate({
      target: techLocations.userId,
      set: values,
      setWhere: lt(techLocations.recordedAt, i.recordedAt),
    });
  const keep = (await getSettings()).map.keep_breadcrumbs_days;
  if (keep > 0)
    await exec.insert(locationBreadcrumbs).values({
      userId: i.userId,
      lat: i.lat,
      lng: i.lng,
      accuracyM: i.accuracyM,
      recordedAt: i.recordedAt,
    });
}

const finite = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/** Validate and store one ping (caller already checked shareState + rate limit). */
export async function recordPing(
  user: SessionUser,
  input: PingInput,
  now = new Date(),
): Promise<{ stored: boolean }> {
  if (!isPlausibleFix(input.lat, input.lng)) return { stored: false };
  const t = input.at != null ? new Date(input.at) : now;
  // Device clocks drift: accept fixes up to 10 min old, never in the future.
  const recordedAt =
    Number.isNaN(t.getTime()) ||
    t > now ||
    now.getTime() - t.getTime() > 600_000
      ? now
      : t;
  await db.transaction(async (tx) => {
    await writeLocation(tx, {
      userId: user.id,
      lat: input.lat,
      lng: input.lng,
      accuracyM: finite(input.accuracyM),
      heading: finite(input.heading),
      speed: finite(input.speed),
      source: "ping",
      jobId: await activeJobFor(tx, user.id),
      recordedAt,
    });
  });
  return { stored: true };
}
