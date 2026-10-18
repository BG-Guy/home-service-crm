// Event handlers for `media` (BUILD_PLAN §4, §7). Owner: B4.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'media.<what>'. Slow work → enqueueJob().
import { eq, sql } from "drizzle-orm";
import { jobs, media, properties } from "@/db/schema";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { getSettings } from "@/lib/settings";
import { isFarFromSite } from "./geo";

export const handlers: HandlerReg[] = [
  {
    // F's upload route sets possibly_from_library / no_geo; the site distance needs the
    // job's property, so `far_from_site` is added here.
    event: "photo.uploaded",
    name: "media.far_from_site",
    async run(e, { tx }) {
      const mediaId = e.payload.media_id as string;
      const [m] = await tx
        .select({
          lat: media.lat,
          lng: media.lng,
          acc: media.accuracyM,
          flags: media.flags,
          jobId: media.jobId,
        })
        .from(media)
        .where(eq(media.id, mediaId))
        .limit(1);
      if (!m || m.lat == null || m.lng == null || !m.jobId) return;
      if (m.flags?.includes("far_from_site")) return;
      const [site] = await tx
        .select({ lat: properties.lat, lng: properties.lng })
        .from(jobs)
        .innerJoin(properties, eq(properties.id, jobs.propertyId))
        .where(eq(jobs.id, m.jobId))
        .limit(1);
      if (site?.lat == null || site.lng == null) return;
      const s = await getSettings();
      if (
        !isFarFromSite(
          { lat: m.lat, lng: m.lng, accuracyM: m.acc },
          { lat: site.lat, lng: site.lng },
          s.media.far_from_site_m,
        )
      )
        return;
      await tx
        .update(media)
        .set({ flags: sql`array_append(${media.flags}, 'far_from_site')` })
        .where(eq(media.id, mediaId));
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
