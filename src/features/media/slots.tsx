import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { assertInvoiceAccess } from "@/features/invoices/api";
import { assertJobAccess } from "@/features/jobs/api";
import { getServiceType } from "@/features/settings/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import {
  listJobPhotos,
  type MediaItem,
  publicTokenCovers,
  selectInvoicePhotos,
} from "./api";
import { JobPhotosGallery } from "./components/JobPhotosGallery";
import type {
  InvoicePhotoGridProps,
  JobPhotosPanelProps,
  PortalPhotoGalleryProps,
} from "./contracts";
import { TAG_LABEL } from "./labels";
import { getGalleryPhotos, stampContext } from "./queries";

// Server UI slots produced by B4 (BUILD_PLAN §5.1). Each checks its own permission,
// row scope and feature flag and returns null when the viewer may not see it.

/** S23 — Photo grid by tag, viewer, captions, star, compare (lazy), soft delete. */
export async function JobPhotosPanel({
  jobId,
  canCapture,
}: JobPhotosPanelProps) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await isEnabled("photos"))) return null;
  let job: Awaited<ReturnType<typeof assertJobAccess>>;
  try {
    job = await assertJobAccess(user, jobId, "read");
  } catch {
    return null;
  }
  let canWrite = false;
  try {
    await assertJobAccess(user, jobId, "write");
    canWrite = true;
  } catch {
    canWrite = false;
  }
  const [tz, beforeAfter, st] = await Promise.all([
    getCompanyTimezone(),
    isEnabled("before_after"),
    job.serviceTypeId ? getServiceType(job.serviceTypeId) : null,
  ]);
  const photos = await getGalleryPhotos(jobId, tz);
  const canEdit = canWrite && user.perms.has("photos.upload");
  return (
    <JobPhotosGallery
      jobId={jobId}
      photos={photos}
      canEdit={canEdit}
      canDelete={user.perms.has("photos.delete")}
      canCapture={(canCapture ?? true) && canEdit}
      beforeAfter={beforeAfter}
      required={{
        before: beforeAfter ? (st?.photosRequiredBefore ?? 0) : 0,
        after: beforeAfter ? (st?.photosRequiredAfter ?? 0) : 0,
      }}
    />
  );
}

function Stamp({
  at,
  jobNumber,
  address,
}: {
  at: string;
  jobNumber: string | null;
  address: string | null;
}) {
  // Stamped derivative via CSS overlay at print time (SPEC M11): no image re-encode.
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5 text-[10px] leading-tight text-white print:text-[9pt]">
      <span className="num font-semibold">{at}</span>
      {(jobNumber || address) && (
        <span className="truncate opacity-90">
          {[jobNumber && `Job ${jobNumber}`, address]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
    </span>
  );
}

async function canSeeInvoice(invoiceId: string, tokenId?: string) {
  if (tokenId) return publicTokenCovers(tokenId, { invoiceId });
  const user = await getCurrentUser();
  if (!user) return false;
  try {
    await assertInvoiceAccess(user, invoiceId, "read");
    return true;
  } catch {
    return false;
  }
}

/**
 * S26 — Invoice / receipt / portal photo grid (embedding cascade §M11 via
 * selectInvoicePhotos). Works on public pages with `tokenId` (no session).
 */
export async function InvoicePhotoGrid({
  invoiceId,
  variant,
  tokenId,
}: InvoicePhotoGridProps) {
  if (!(await canSeeInvoice(invoiceId, tokenId))) return null;
  const photos = await selectInvoicePhotos(invoiceId, variant);
  if (photos.length === 0) return null;
  const [inv] = await db
    .select({ jobId: invoices.jobId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  const [tz, ctx] = await Promise.all([
    getCompanyTimezone(),
    stampContext(inv?.jobId ?? null),
  ]);
  const at = (p: MediaItem) => formatDateTime(p.capturedAt ?? p.createdAt, tz);

  if (variant === "receipt")
    return (
      <section aria-label="Job photos" className="break-inside-avoid">
        <ul className="grid grid-cols-4 gap-1.5">
          {photos.slice(0, 4).map((p) => (
            <li
              key={p.id}
              className="relative aspect-square overflow-hidden rounded-[8px] bg-fill-2"
            >
              {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
              <img
                src={p.thumbUrl}
                alt={p.tag ? `${TAG_LABEL[p.tag]} photo` : "Job photo"}
                className="size-full object-cover"
                loading="lazy"
              />
              {p.tag && (
                <span className="absolute top-1 left-1 rounded-pill bg-black/55 px-1.5 text-[10px] font-semibold text-white">
                  {TAG_LABEL[p.tag]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    );

  if (variant === "portal")
    return (
      <PhotoGrid
        columns={2}
        photos={photos.map((p) => ({
          id: p.id,
          url: p.url,
          thumbUrl: p.thumbUrl,
          tag: p.tag,
          caption: p.caption,
          takenAt: at(p),
          alt: p.caption ?? (p.tag ? `${TAG_LABEL[p.tag]} photo` : "Job photo"),
        }))}
      />
    );

  return (
    <section aria-label="Job photos" className="break-inside-avoid">
      <ul className="grid grid-cols-2 gap-2">
        {photos.slice(0, 8).map((p) => (
          <li key={p.id} className="break-inside-avoid">
            <figure className="flex flex-col gap-1">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-fill-2">
                {/* biome-ignore lint/performance/noImgElement: signed URLs, print */}
                <img
                  src={p.url}
                  alt={
                    p.caption ??
                    (p.tag ? `${TAG_LABEL[p.tag]} photo` : "Job photo")
                  }
                  className="size-full object-cover"
                  loading="lazy"
                />
                <Stamp
                  at={at(p)}
                  jobNumber={ctx.jobNumber}
                  address={ctx.address}
                />
              </div>
              <figcaption className="text-footnote text-label-2">
                <strong className="text-label">
                  {p.tag === "before"
                    ? "Before"
                    : p.tag === "after"
                      ? "After"
                      : p.tag
                        ? TAG_LABEL[p.tag]
                        : "Photo"}
                </strong>
                {p.caption ? ` · ${p.caption}` : ""}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** S27 — Starred photos full-size on the public job page (validated by tokenId). */
export async function PortalPhotoGallery({
  jobId,
  tokenId,
}: PortalPhotoGalleryProps) {
  if (!(await publicTokenCovers(tokenId, { jobId }))) return null;
  if (!(await isEnabled("photos"))) return null;
  const photos = (await listJobPhotos(jobId)).filter((p) => p.includeInInvoice);
  if (photos.length === 0) return null;
  const tz = await getCompanyTimezone();
  return (
    <section aria-labelledby="portal-photos-h" className="flex flex-col gap-2">
      <h2
        id="portal-photos-h"
        className="px-4 text-footnote uppercase text-label-2"
      >
        Photos from your service
      </h2>
      <PhotoGrid
        columns={2}
        photos={photos.map((p) => ({
          id: p.id,
          url: p.url,
          thumbUrl: p.thumbUrl,
          tag: p.tag,
          caption: p.caption,
          takenAt: formatDateTime(p.capturedAt ?? p.createdAt, tz),
          alt: p.caption ?? (p.tag ? `${TAG_LABEL[p.tag]} photo` : "Job photo"),
        }))}
      />
    </section>
  );
}
