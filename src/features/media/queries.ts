import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getStorage } from "@/adapters/storage";
import { db } from "@/db";
import { jobs, media, properties, users } from "@/db/schema";
import { formatDateTime } from "@/lib/time";
import type { GalleryPhoto } from "./components/JobPhotosGallery";
import type { MediaTag } from "./contracts";

// Read DAL for media screens. Callers (slots/pages) check access first.

const TTL = 600;
const GALLERY_TAGS = ["before", "during", "after", "problem", "other"];

/** Job gallery rows (not deleted) with uploader names and signed URLs. */
export async function getGalleryPhotos(
  jobId: string,
  tz: string,
): Promise<GalleryPhoto[]> {
  const rows = await db
    .select({ m: media, uploader: users.name })
    .from(media)
    .leftJoin(users, eq(users.id, media.uploaderId))
    .where(
      and(
        eq(media.jobId, jobId),
        eq(media.kind, "photo"),
        isNull(media.deletedAt),
        inArray(media.tag, GALLERY_TAGS),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${media.clientCapturedAt}, ${media.serverReceivedAt})`),
    )
    .limit(300);
  const storage = getStorage();
  return Promise.all(
    rows.map(async ({ m, uploader }) => {
      const url = await storage.signedGetUrl(m.storageKey, TTL);
      return {
        id: m.id,
        url,
        thumbUrl: m.thumbKey
          ? await storage.signedGetUrl(m.thumbKey, TTL)
          : url,
        tag: (m.tag as MediaTag | null) ?? null,
        caption: m.caption,
        takenAt: formatDateTime(m.clientCapturedAt ?? m.serverReceivedAt, tz),
        lat: m.lat,
        lng: m.lng,
        flags: m.flags ?? [],
        starred: m.includeInInvoice,
        locked: m.evidenceLocked,
        uploader,
      };
    }),
  );
}

/** Job number + short service address for the stamped photo overlay. */
export async function stampContext(
  jobId: string | null,
): Promise<{ jobNumber: string | null; address: string | null }> {
  if (!jobId) return { jobNumber: null, address: null };
  const [r] = await db
    .select({
      number: jobs.number,
      street: properties.street,
      city: properties.city,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return {
    jobNumber: r?.number ?? null,
    address: r?.street ? `${r.street}${r.city ? `, ${r.city}` : ""}` : null,
  };
}
