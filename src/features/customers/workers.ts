// job_queue workers for `customers` (BUILD_PLAN §4, §8.2). Owner: B1.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import { eq } from "drizzle-orm";
import { getGeocoder } from "@/adapters/geocode";
import { createThrottle } from "@/adapters/geocode/throttle";
import { db } from "@/db";
import { properties } from "@/db/schema";
import type { JobQueueKind, Worker } from "@/lib/queue";
import { timezoneForZip } from "@/lib/zip-tz";

// Free geocoders allow ~1 request/second; serialize calls from this process.
const throttle = createThrottle(1_000);

/**
 * `geocode`: fill lat/lng for a property (Census by default; GEOCODER env). Never
 * overwrites a manual pin. A miss marks `failed` (the map shows it as unplaced).
 */
export const geocodeWorker: Worker = async (payload) => {
  const propertyId = String(payload.propertyId ?? "");
  if (!propertyId) return;
  const [p] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (!p || p.deletedAt) return;
  if (p.geocodeStatus === "manual" || p.geocodeStatus === "ok") return;
  const geocoder = getGeocoder();
  if (geocoder.id === "none") return;
  const hit = await throttle(() =>
    geocoder.geocode({
      street: p.street,
      city: p.city,
      state: p.state,
      zip: p.zip,
    }),
  );
  await db
    .update(properties)
    .set(
      hit
        ? {
            lat: hit.lat,
            lng: hit.lng,
            geocodeStatus: "ok",
            timezone: p.timezone ?? timezoneForZip(p.zip),
            updatedAt: new Date(),
          }
        : { geocodeStatus: "failed", updatedAt: new Date() },
    )
    .where(eq(properties.id, propertyId));
};

export const workers: Partial<Record<JobQueueKind, Worker>> = {
  geocode: geocodeWorker,
};
