// Pure live-map rules (SPEC M19). Isomorphic; unit-tested in tests/map/rules.test.ts.

import { formatTime } from "@/lib/time";

export type Staleness = "live" | "stale" | "hidden";

/** > staleMin grey, > hideMin hidden unless toggled (SPEC M19). */
export function classifyStaleness(
  recordedAt: Date | string,
  now: Date,
  staleMin = 15,
  hideMin = 60,
): Staleness {
  const ageMin = (now.getTime() - new Date(recordedAt).getTime()) / 60_000;
  if (ageMin > hideMin) return "hidden";
  if (ageMin > staleMin) return "stale";
  return "live";
}

export type TechMapStatus = "off" | "idle" | "en_route" | "on_job";

/** Status ring of a tech marker: clocked out / idle / en route / on job. */
export function techMapStatus(i: {
  clockedIn: boolean;
  currentJobStatus?: string | null;
}): TechMapStatus {
  if (!i.clockedIn) return "off";
  const s = i.currentJobStatus;
  if (s === "en_route") return "en_route";
  if (s === "arrived" || s === "in_progress") return "on_job";
  return "idle";
}

export const TECH_STATUS_LABEL: Record<TechMapStatus, string> = {
  off: "Clocked out",
  idle: "Idle",
  en_route: "En route",
  on_job: "On job",
};

/** Accuracy halo threshold in meters (SPEC M19). */
export const HALO_MIN_ACCURACY_M = 100;

/** Haversine distance in meters. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371e3;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Straight-line ETA in minutes (city driving ≈ 25 mph with a 1.3 detour factor).
 * Used only as a rough chip when the job has no stored `eta_at`.
 */
export function roughEtaMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mph = 25,
): number {
  const miles = (distanceM(from, to) / 1609.344) * 1.3;
  return Math.max(1, Math.round((miles / mph) * 60));
}

/** Validates a ping coordinate (rejects 0,0 "null island" and out-of-range values). */
export function isPlausibleFix(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

export type TrackingPhase = "en_route" | "arrived" | "finished" | "inactive";

/** What the public tracking page (/t) shows for a job status. */
export function trackingPhase(status: string): TrackingPhase {
  if (status === "en_route") return "en_route";
  if (status === "arrived" || status === "in_progress" || status === "on_hold")
    return "arrived";
  if (status === "completed" || status === "closed") return "finished";
  return "inactive";
}

/**
 * ETA for the tracking page. A stored `eta_at` in the future wins; otherwise a rough
 * straight-line estimate from a fresh fix. The clock time is formatted in the
 * company's time zone (never the server's) so "Expected around 2:40 PM" matches the
 * customer's wall clock.
 */
export function trackingEta(i: {
  etaAt: Date | null;
  now: Date;
  timeZone: string;
  fix?: { lat: number; lng: number } | null;
  dest?: { lat: number; lng: number } | null;
}): { minutes: number | null; clock: string | null } {
  const nowMs = i.now.getTime();
  let minutes: number | null = null;
  if (i.etaAt && i.etaAt.getTime() > nowMs)
    minutes = Math.max(1, Math.round((i.etaAt.getTime() - nowMs) / 60_000));
  else if (i.fix && i.dest) minutes = roughEtaMinutes(i.fix, i.dest);
  if (minutes == null) return { minutes: null, clock: null };
  const at =
    i.etaAt && i.etaAt.getTime() > nowMs
      ? i.etaAt
      : new Date(nowMs + minutes * 60_000);
  return { minutes, clock: formatTime(at, i.timeZone) };
}
