import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getStorage } from "@/adapters/storage";
import { db, type Tx } from "@/db";
import {
  disputes,
  invoices,
  jobs,
  media,
  payments,
  publicTokens,
  serviceTypes,
  signatures,
} from "@/db/schema";
import { getSettings, isEnabled } from "@/lib/settings";
import type { EntityRef } from "@/lib/types";
import type { MediaItem, MediaTag } from "./contracts";

// B4 media API (BUILD_PLAN §6.4, SPEC M11). Reads take no tx; writes run in the
// caller's transaction. Signed URLs are short-lived (10 min) and minted at render.

export type * from "./contracts";

const SIGNED_TTL = 600;

/** Tags that belong to the job photo gallery (governed by the `photos` flag). */
export const JOB_PHOTO_TAGS: readonly MediaTag[] = [
  "before",
  "during",
  "after",
  "problem",
  "other",
];

type MediaRow = typeof media.$inferSelect;

async function toItems(rows: MediaRow[]): Promise<MediaItem[]> {
  const storage = getStorage();
  return Promise.all(
    rows.map(async (m) => {
      const url = await storage.signedGetUrl(m.storageKey, SIGNED_TTL);
      return {
        id: m.id,
        kind: m.kind,
        tag: (m.tag as MediaTag | null) ?? null,
        caption: m.caption,
        jobId: m.jobId,
        mime: m.mime,
        width: m.width,
        height: m.height,
        createdAt: m.createdAt,
        capturedAt: m.clientCapturedAt ?? m.serverReceivedAt,
        lat: m.lat,
        lng: m.lng,
        flags: m.flags ?? [],
        includeInInvoice: m.includeInInvoice,
        evidenceLocked: m.evidenceLocked,
        thumbUrl: m.thumbKey
          ? await storage.signedGetUrl(m.thumbKey, SIGNED_TTL)
          : url,
        url,
      };
    }),
  );
}

/** Job photos (not deleted), chronological. `tags` filters; default = every photo tag. */
export async function listJobPhotos(
  jobId: string,
  opts?: { tags?: MediaTag[]; limit?: number },
): Promise<MediaItem[]> {
  const conds = [
    eq(media.jobId, jobId),
    eq(media.kind, "photo"),
    isNull(media.deletedAt),
  ];
  if (opts?.tags?.length) conds.push(inArray(media.tag, opts.tags));
  const rows = await db
    .select()
    .from(media)
    .where(and(...conds))
    .orderBy(
      asc(sql`coalesce(${media.clientCapturedAt}, ${media.serverReceivedAt})`),
      asc(media.createdAt),
    )
    .limit(opts?.limit ?? 300);
  return toItems(rows);
}

/** Count of live job photos by tag. */
export async function countJobPhotos(
  jobId: string,
): Promise<Partial<Record<MediaTag, number>>> {
  const rows = await db
    .select({ tag: media.tag, n: sql<number>`count(*)::int` })
    .from(media)
    .where(
      and(
        eq(media.jobId, jobId),
        eq(media.kind, "photo"),
        isNull(media.deletedAt),
      ),
    )
    .groupBy(media.tag);
  const out: Partial<Record<MediaTag, number>> = {};
  for (const r of rows) if (r.tag) out[r.tag as MediaTag] = Number(r.n);
  return out;
}

export interface PhotoEmbedConfig {
  enabled: boolean;
  reason:
    | "ok"
    | "flag_off"
    | "company_off"
    | "service_type_off"
    | "invoice_off"
    | "no_job";
}

/**
 * Whether photos embed on this invoice/receipt (SPEC M11 three levels): flags
 * (photos + before_after) → company default (settings.invoices.photos_on_invoice /
 * photos_on_receipt) → service type (photos_on_invoice) → invoice.show_photos.
 * Each level can switch embedding off for the more specific scope.
 */
export async function photoEmbedConfig(
  inv: {
    jobId: string | null;
    showPhotos: boolean;
    serviceTypeOn: boolean | null;
  },
  variant: "invoice" | "receipt" | "portal",
): Promise<PhotoEmbedConfig> {
  if (!inv.jobId) return { enabled: false, reason: "no_job" };
  if (!(await isEnabled("photos")))
    return { enabled: false, reason: "flag_off" };
  if (variant === "portal") return { enabled: true, reason: "ok" };
  if (!(await isEnabled("before_after")))
    return { enabled: false, reason: "flag_off" };
  const s = await getSettings();
  const company =
    variant === "invoice"
      ? s.invoices.photos_on_invoice
      : s.invoices.photos_on_receipt;
  if (!company) return { enabled: false, reason: "company_off" };
  if (inv.serviceTypeOn === false)
    return { enabled: false, reason: "service_type_off" };
  if (!inv.showPhotos) return { enabled: false, reason: "invoice_off" };
  return { enabled: true, reason: "ok" };
}

/** Pure part of the cascade (tested): explicit order → starred → latest 2 before + 2 after. */
export function pickEmbedPhotos<
  T extends { id: string; tag: string | null; includeInInvoice: boolean },
>(
  all: readonly T[],
  variant: "invoice" | "receipt" | "portal",
  explicitIds: readonly string[] | null,
): T[] {
  const starred = all.filter((m) => m.includeInInvoice);
  if (variant === "portal") return starred;
  const max = variant === "invoice" ? 8 : 4;
  if (explicitIds?.length) {
    const byId = new Map(all.map((m) => [m.id, m]));
    const picked = explicitIds
      .map((id) => byId.get(id))
      .filter((m): m is T => !!m);
    if (picked.length) return picked.slice(0, max);
  }
  if (starred.length) return starred.slice(0, max);
  const before = all.filter((m) => m.tag === "before").slice(-2);
  const after = all.filter((m) => m.tag === "after").slice(-2);
  return [...before, ...after].slice(0, max);
}

/**
 * Embedding cascade §M11: flags → company default → service type →
 * invoice.show_photos/photo_media_ids → starred → latest 2 before + 2 after.
 * invoice ≤ 8, receipt ≤ 4, portal = all starred.
 */
export async function selectInvoicePhotos(
  invoiceId: string,
  variant: "invoice" | "receipt" | "portal",
): Promise<MediaItem[]> {
  const [inv] = await db
    .select({
      jobId: invoices.jobId,
      showPhotos: invoices.showPhotos,
      photoMediaIds: invoices.photoMediaIds,
      serviceTypeOn: serviceTypes.photosOnInvoice,
    })
    .from(invoices)
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) return [];
  const cfg = await photoEmbedConfig(inv, variant);
  if (!cfg.enabled || !inv.jobId) return [];
  const all = await listJobPhotos(inv.jobId, {
    tags: ["before", "during", "after", "problem", "other"],
  });
  return pickEmbedPhotos(all, variant, inv.photoMediaIds ?? null);
}

/** Signed URLs (10 min) by media id. */
export async function getMediaUrls(
  mediaIds: string[],
  variant: "full" | "thumb" | "original" = "full",
): Promise<Record<string, string>> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      id: media.id,
      key: media.storageKey,
      thumb: media.thumbKey,
      orig: media.originalKey,
    })
    .from(media)
    .where(inArray(media.id, ids));
  const storage = getStorage();
  const out: Record<string, string> = {};
  await Promise.all(
    rows.map(async (r) => {
      const key =
        variant === "thumb"
          ? (r.thumb ?? r.key)
          : variant === "original"
            ? (r.orig ?? r.key)
            : r.key;
      out[r.id] = await storage.signedGetUrl(key, SIGNED_TTL);
    }),
  );
  return out;
}

/** Mark media as evidence (no delete afterwards): issued invoice, signature, dispute. */
export async function lockEvidenceMedia(
  tx: Tx,
  mediaIds: string[],
): Promise<void> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (ids.length === 0) return;
  await tx
    .update(media)
    .set({ evidenceLocked: true })
    .where(and(inArray(media.id, ids), eq(media.evidenceLocked, false)));
}

/** Link already-uploaded media to an entity created afterwards (e.g. receipt → part_purchase). */
export async function attachMedia(
  tx: Tx,
  mediaIds: string[],
  entity: EntityRef,
  opts?: { jobId?: string | null; customerId?: string | null },
): Promise<void> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (ids.length === 0) return;
  await tx
    .update(media)
    .set({
      entityType: entity.type,
      entityId: entity.id,
      ...(opts?.jobId !== undefined ? { jobId: opts.jobId } : {}),
      ...(opts?.customerId !== undefined
        ? { customerId: opts.customerId }
        : {}),
    })
    .where(inArray(media.id, ids));
}

/** Resolve media ids from offline client ids (uploads queued before the entity existed). */
export async function mediaIdsForClientIds(
  clientIds: string[],
): Promise<Record<string, string>> {
  const ids = clientIds.filter(Boolean);
  if (ids.length === 0) return {};
  const rows = await db
    .select({ id: media.id, clientId: media.clientId })
    .from(media)
    .where(inArray(media.clientId, ids));
  return Object.fromEntries(
    rows.filter((r) => r.clientId).map((r) => [r.clientId as string, r.id]),
  );
}

/**
 * Why a photo can't be deleted (SPEC M11): linked to an issued invoice, a signature or
 * a dispute, or already evidence-locked. null = deletable.
 */
export async function evidenceLockReason(
  mediaId: string,
): Promise<string | null> {
  const [m] = await db
    .select({
      locked: media.evidenceLocked,
      jobId: media.jobId,
    })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  if (!m) return null;
  if (m.locked) return "This photo is locked as evidence.";
  const [sig] = await db
    .select({ id: signatures.id })
    .from(signatures)
    .where(eq(signatures.signatureMediaId, mediaId))
    .limit(1);
  if (sig) return "This image is part of a signature.";
  const [inv] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        sql`${mediaId}::uuid = any(${invoices.photoMediaIds})`,
        inArray(invoices.status, [
          "issued",
          "partially_paid",
          "paid",
          "uncollectible",
        ]),
      ),
    )
    .limit(1);
  if (inv) return "This photo is on an issued invoice.";
  const [dsp] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(sql`${disputes.evidenceFiles}::text like ${`%${mediaId}%`}`)
    .limit(1);
  if (dsp) return "This photo is attached to a dispute.";
  if (m.jobId) {
    const [open] = await db
      .select({ id: disputes.id })
      .from(disputes)
      .innerJoin(payments, eq(payments.id, disputes.paymentId))
      .where(
        and(
          eq(payments.jobId, m.jobId),
          inArray(disputes.status, [
            "inquiry",
            "needs_response",
            "under_review",
          ]),
        ),
      )
      .limit(1);
    if (open) return "This job has an open dispute.";
  }
  return null;
}

/**
 * Public-page access check for the S26/S27 slots: a live token whose scope covers the
 * invoice (invoice/pay token for it, or a job token for its job) or the job.
 */
export async function publicTokenCovers(
  tokenId: string,
  scope: { invoiceId?: string; jobId?: string | null },
): Promise<boolean> {
  const [t] = await db
    .select()
    .from(publicTokens)
    .where(
      and(
        eq(publicTokens.id, tokenId),
        isNull(publicTokens.revokedAt),
        sql`${publicTokens.expiresAt} > now()`,
      ),
    )
    .limit(1);
  if (!t) return false;
  if (scope.invoiceId && t.entityId === scope.invoiceId) return true;
  if (scope.jobId && (t.jobId === scope.jobId || t.entityId === scope.jobId))
    return true;
  if (scope.invoiceId && t.entityType === "deposit_request") return false;
  if (scope.invoiceId && t.jobId) {
    const [inv] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, scope.invoiceId), eq(invoices.jobId, t.jobId)))
      .limit(1);
    return !!inv;
  }
  return false;
}

/** Job photo rows for evidence (includes deleted=false only), with storage keys resolved. */
export async function listJobMediaForEvidence(
  jobId: string,
): Promise<MediaItem[]> {
  const rows = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.jobId, jobId),
        isNull(media.deletedAt),
        or(eq(media.kind, "photo"), eq(media.kind, "document")),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${media.clientCapturedAt}, ${media.serverReceivedAt})`),
    )
    .limit(200);
  return toItems(rows);
}
