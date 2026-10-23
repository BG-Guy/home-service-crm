import "server-only";
import { sql } from "drizzle-orm";
import { getGeocoder } from "@/adapters/geocode";
import { execRows, type Tx } from "@/db";
import { queueGeocode } from "@/features/customers/api";
import { dateKey } from "@/lib/time";

// Lead map positions (item 10): a lead shows on the map through its property, which
// the `geocode` job places (customers/workers.ts, throttled, through the geocode
// adapter). A property that already existed when a lead matched it may never have
// been placed (created while no geocoder was set up, or its job ran out of tries):
// this queues one more job for it. Shared by intake (step 7) and the map backfill.

/**
 * Queue a geocode for a property that still has no position and no job queued or
 * running. At most one extra try per property a day (the dedupe key carries the
 * date); nothing when no geocoder is set up. Returns whether a job was queued.
 */
export async function requeueGeocode(
  tx: Tx,
  propertyId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (getGeocoder().id === "none") return false;
  const [row] = await execRows<{ waiting: boolean }>(
    sql`select (p.lat is null and p.geocode_status = 'pending'
          and p.deleted_at is null
          and not exists (select 1 from job_queue q
            where q.kind = 'geocode' and q.status in ('queued', 'running')
              and q.payload->>'propertyId' = p.id::text)) as waiting
        from properties p where p.id = ${propertyId}`,
    tx,
  );
  if (!row?.waiting) return false;
  await queueGeocode(tx, propertyId, `retry-${dateKey(now, "UTC")}`);
  return true;
}
