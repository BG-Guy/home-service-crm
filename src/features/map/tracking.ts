import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobAssignments, jobs, properties, techLocations } from "@/db/schema";
import { getUserBriefs } from "@/features/team/api";
import { findCompany, isEnabled } from "@/lib/settings";
import { resolvePublicToken } from "@/lib/tokens";
import { type TrackingPhase, trackingEta, trackingPhase } from "./rules";

// Public tracking page loader (/t/[token], SPEC M19). No session: the token is the
// credential (hashed, 3 h TTL). Live only while the job is `en_route`; shows first
// name, photo and license #, ETA, the company phone and the tech's last-known
// position — never a breadcrumb trail. After arrival the link stays valid until it
// expires (or the job completes/cancels) but shows only "your technician has
// arrived", with no position.

export type TrackingView =
  | { state: "invalid" }
  | {
      state: "done";
      /** Kept for callers that only need a yes/no. */
      arrived: boolean;
      phase: Exclude<TrackingPhase, "en_route">;
      firstName: string | null;
      companyPhone: string | null;
      companyName: string;
    }
  | {
      state: "live";
      tech: {
        firstName: string;
        photoUrl: string | null;
        licenseNo: string | null;
        seed: string;
      };
      etaMinutes: number | null;
      etaAt: string | null;
      /** "2:40 PM" in the company time zone (null without an ETA). */
      etaClock: string | null;
      companyPhone: string | null;
      companyName: string;
      tech_at: { lat: number; lng: number; recordedAt: string } | null;
      dest: { lat: number; lng: number } | null;
    };

/** Fixes older than this aren't shown (no stale "he's still here" claims). */
const MAX_AGE_MS = 30 * 60_000;

export async function getTrackingView(
  token: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<TrackingView> {
  const row = await resolvePublicToken("tracking", token, {
    path: "/t/",
    action: "viewed",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  if (!row) return { state: "invalid" };
  const jobId = row.jobId ?? (row.entityType === "job" ? row.entityId : null);
  if (!jobId) return { state: "invalid" };
  const company = await findCompany();
  const companyPhone = company?.phone ?? null;
  const companyName = company?.name ?? "";
  const timeZone = company?.timezone ?? "America/New_York";
  const [job] = await db
    .select({
      status: jobs.status,
      etaAt: jobs.etaAt,
      lat: properties.lat,
      lng: properties.lng,
    })
    .from(jobs)
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { state: "invalid" };
  const phase = trackingPhase(job.status);
  const [a] = await db
    .select({ userId: jobAssignments.userId })
    .from(jobAssignments)
    .where(and(eq(jobAssignments.jobId, jobId)))
    .orderBy(asc(jobAssignments.role))
    .limit(1);
  const brief = a ? (await getUserBriefs([a.userId]))[a.userId] : undefined;
  if (phase !== "en_route")
    return {
      state: "done",
      arrived: phase === "arrived" || phase === "finished",
      phase,
      firstName: brief?.firstName ?? null,
      companyPhone,
      companyName,
    };
  const [loc] =
    a && (await isEnabled("map"))
      ? await db
          .select()
          .from(techLocations)
          .where(eq(techLocations.userId, a.userId))
          .limit(1)
      : [];
  const fresh =
    loc && Date.now() - loc.recordedAt.getTime() < MAX_AGE_MS ? loc : null;
  const dest =
    job.lat != null && job.lng != null ? { lat: job.lat, lng: job.lng } : null;
  const eta = trackingEta({
    etaAt: job.etaAt,
    now: new Date(),
    timeZone,
    fix: fresh,
    dest,
  });
  const license = brief?.licenseNumbers?.[0];
  return {
    state: "live",
    tech: {
      firstName: brief?.firstName ?? "Your technician",
      photoUrl: brief?.avatarUrl ?? null,
      licenseNo: license
        ? `${license.state} ${license.trade} #${license.number}`
        : null,
      seed: a?.userId ?? jobId,
    },
    etaMinutes: eta.minutes,
    etaAt: job.etaAt?.toISOString() ?? null,
    etaClock: eta.clock,
    companyPhone,
    companyName,
    tech_at: fresh
      ? {
          lat: fresh.lat,
          lng: fresh.lng,
          recordedAt: fresh.recordedAt.toISOString(),
        }
      : null,
    dest,
  };
}
