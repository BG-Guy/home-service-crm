import "server-only";
import { assertInvoiceAccess } from "@/features/invoices/api";
import {
  INVOICE_PHOTO_TONE,
  invoicePhotoLabel,
} from "@/features/invoices/photo-labels";
import { assertJobAccess } from "@/features/jobs/api";
import { getServiceType } from "@/features/settings/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import { Pill } from "@/ui/components/StatusPill";
import {
  listJobPhotos,
  type MediaItem,
  publicTokenCovers,
  selectInvoicePhotos,
} from "./api";
import { LazyJobPhotosGallery as JobPhotosGallery } from "./components/lazy";
import type {
  InvoicePhotoGridProps,
  JobPhotosPanelProps,
  PortalPhotoGalleryProps,
} from "./contracts";
import { TAG_LABEL } from "./labels";
import { getGalleryPhotos } from "./queries";

// Server UI slots produced by B4 (BUILD_PLAN §5.1). Each checks its own permission,
// row scope and feature flag and returns null when the viewer may not see it.

/** S23 — Photos grouped by tag, full-screen viewer (lazy), details: star, re-tag, caption, soft delete. */
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
  const tz = await getCompanyTimezone();
  const at = (p: MediaItem) => formatDateTime(p.capturedAt ?? p.createdAt, tz);

  if (variant === "receipt")
    return (
      <section aria-label="Job photos" className="break-inside-avoid">
        <PhotoGrid
          columns={4}
          photos={photos.slice(0, 4).map((p) => ({
            id: p.id,
            url: p.url,
            thumbUrl: p.thumbUrl,
            // The receipt reads like the invoice: Before / During / After.
            tag: invoicePhotoLabel(p.tag),
            caption: p.caption,
            takenAt: at(p),
            alt: `${invoicePhotoLabel(p.tag)} photo`,
          }))}
        />
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

  // The invoice (detail, print, the customer's /i page and its printout): the photos
  // the tech picked, plain (no stamps or overlays), each with a clear Before /
  // During / After chip under it (Quote to Paid I5). Staff copies add when it was
  // taken; the customer's copy doesn't.
  const staff = !tokenId;
  return (
    <section aria-labelledby="inv-doc-photos-h" className="break-inside-avoid">
      <h3
        id="inv-doc-photos-h"
        className="text-footnote font-semibold text-label-2"
      >
        Photos
      </h3>
      <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.slice(0, 8).map((p) => {
          const label = invoicePhotoLabel(p.tag);
          return (
            <li key={p.id} className="break-inside-avoid">
              <figure className="flex flex-col gap-1.5">
                {/* biome-ignore lint/performance/noImgElement: signed URLs, print */}
                <img
                  src={p.url}
                  alt={p.caption ? `${label}: ${p.caption}` : label}
                  className="aspect-[4/3] w-full rounded-[10px] bg-fill-2 object-cover"
                  loading="lazy"
                />
                <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote text-label-2">
                  <Pill tone={INVOICE_PHOTO_TONE[label]} size="sm">
                    {label}
                  </Pill>
                  {staff ? <span className="num">{at(p)}</span> : null}
                  {p.caption ? <span>{p.caption}</span> : null}
                </figcaption>
              </figure>
            </li>
          );
        })}
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
        className="px-4 text-subhead font-semibold text-label-2"
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
