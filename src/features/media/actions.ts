"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { media } from "@/db/schema";
import { assertJobAccess } from "@/features/jobs/api";
import { action, actionFailure } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getSettings, isEnabled } from "@/lib/settings";
import type { ActionResult } from "@/lib/types";
import { evidenceLockReason, listJobPhotos } from "./api";
import type { MediaTag } from "./contracts";

// Photo mutations (SPEC M11). Uploads never pass through here (presign → PUT →
// complete); these edit metadata of existing rows. Soft delete only, audited.

const uuid = z.string().uuid();
const PHOTO_TAGS = ["before", "during", "after", "problem", "other"] as const;

async function photoFor(tx: Tx, id: string) {
  const [m] = await tx
    .select()
    .from(media)
    .where(and(eq(media.id, id), isNull(media.deletedAt)))
    .limit(1);
  if (!m) throw new NotFoundError("Photo");
  return m;
}

function paths(jobId: string | null) {
  return jobId ? [`/jobs/${jobId}`, `/jobs/${jobId}/evidence`] : [];
}

/** Star / unstar a photo for the invoice, receipt and portal (`include_in_invoice`). */
export const setPhotoStarred = action({
  perm: "photos.upload",
  feature: "photos",
  input: z.object({ mediaId: uuid, starred: z.boolean() }),
  async run({ input, tx, user, activity }) {
    const m = await photoFor(tx, input.mediaId);
    if (m.jobId) await assertJobAccess(user, m.jobId, "write");
    else throw new ForbiddenError();
    await tx
      .update(media)
      .set({ includeInInvoice: input.starred })
      .where(eq(media.id, m.id));
    await activity({
      entity: { type: "job", id: m.jobId },
      jobId: m.jobId,
      customerId: m.customerId,
      kind: input.starred ? "photo.starred" : "photo.unstarred",
      summary: input.starred
        ? "Photo starred for the invoice"
        : "Photo removed from the invoice",
      data: { media_id: m.id },
    });
    return { jobId: m.jobId };
  },
  revalidate: ({ data }) => paths(data.jobId),
});

/** Edit a photo's tag and caption (before/after tags need the before_after flag). */
export const updatePhoto = action({
  perm: "photos.upload",
  feature: "photos",
  input: z.object({
    mediaId: uuid,
    tag: z.enum(PHOTO_TAGS).optional(),
    caption: z.string().trim().max(300).nullish(),
  }),
  audit: "photo.updated",
  async run({ input, tx, user }) {
    const m = await photoFor(tx, input.mediaId);
    if (!m.jobId) throw new ForbiddenError();
    await assertJobAccess(user, m.jobId, "write");
    if (
      (input.tag === "before" || input.tag === "after") &&
      !(await isEnabled("before_after"))
    )
      throw new ConflictError(
        "before_after_off",
        "Before/after photos are turned off.",
      );
    if (m.evidenceLocked && input.tag && input.tag !== m.tag)
      throw new ConflictError(
        "evidence_locked",
        "This photo is locked as evidence; its tag can't change.",
      );
    await tx
      .update(media)
      .set({
        ...(input.tag ? { tag: input.tag } : {}),
        ...(input.caption !== undefined
          ? { caption: input.caption || null }
          : {}),
      })
      .where(eq(media.id, m.id));
    return { jobId: m.jobId };
  },
  auditEntity: ({ input }) => ({ type: "media", id: input.mediaId }),
  revalidate: ({ data }) => paths(data.jobId),
});

/** Soft-delete (photos.delete). Blocked for evidence (issued invoice, signature, dispute). */
export const deletePhoto = action({
  perm: "photos.delete",
  input: z.object({
    mediaId: uuid,
    reason: z.string().trim().min(3, "Say why the photo is removed.").max(300),
  }),
  audit: "photo.deleted",
  async run({ input, tx, user, actor, activity }) {
    const m = await photoFor(tx, input.mediaId);
    if (m.jobId) await assertJobAccess(user, m.jobId, "read");
    const why = await evidenceLockReason(m.id);
    if (why) throw new ConflictError("evidence_locked", why);
    await tx
      .update(media)
      .set({
        deletedAt: new Date(),
        deletedBy: actor.userId,
        deleteReason: input.reason,
        includeInInvoice: false,
      })
      .where(eq(media.id, m.id));
    if (m.jobId)
      await activity({
        entity: { type: "job", id: m.jobId },
        jobId: m.jobId,
        customerId: m.customerId,
        kind: "photo.deleted",
        summary: `Photo removed: ${input.reason}`,
        data: { media_id: m.id },
      });
    return { jobId: m.jobId };
  },
  auditEntity: ({ input }) => ({ type: "media", id: input.mediaId }),
  revalidate: ({ data }) => paths(data.jobId),
});

export interface CaptureConfig {
  photos: boolean;
  beforeAfter: boolean;
  keepOriginals: boolean;
  keepOriginalTags: string[];
  canUpload: boolean;
}

/** Capture settings for the camera slot (S24): flags + keep-originals policy. */
export async function getCaptureConfig(): Promise<ActionResult<CaptureConfig>> {
  try {
    const user = await requireUser();
    const [photos, beforeAfter, protection, s] = await Promise.all([
      isEnabled("photos"),
      isEnabled("before_after"),
      isEnabled("chargeback_protection"),
      getSettings(),
    ]);
    return {
      ok: true,
      data: {
        photos,
        beforeAfter: photos && beforeAfter,
        keepOriginals: protection && s.media.keep_originals,
        keepOriginalTags: s.media.keep_originals_tags,
        canUpload: user.perms.has("photos.upload"),
      },
    };
  } catch (e) {
    return actionFailure(e);
  }
}

export interface PickablePhoto {
  id: string;
  thumbUrl: string;
  tag: MediaTag | null;
  caption: string | null;
  starred: boolean;
}

/** Job photos for the picker (S25): visible to anyone who can read the job. */
export async function listPickablePhotos(input: {
  jobId: string;
  tags?: MediaTag[];
}): Promise<ActionResult<PickablePhoto[]>> {
  try {
    const user = await requireUser();
    const jobId = uuid.parse(input.jobId);
    await assertJobAccess(user, jobId, "read");
    if (!(await isEnabled("photos"))) return { ok: true, data: [] };
    const rows = await listJobPhotos(jobId, {
      tags: input.tags?.length ? input.tags : [...PHOTO_TAGS],
    });
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        thumbUrl: r.thumbUrl,
        tag: r.tag,
        caption: r.caption,
        starred: r.includeInInvoice,
      })),
    };
  } catch (e) {
    return actionFailure(e);
  }
}
