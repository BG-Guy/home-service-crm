import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getStorage, isSafeKey, MIME_EXT, mediaKeys } from "@/adapters/storage";
import { db } from "@/db";
import { MEDIA_KINDS, MEDIA_TAGS } from "@/db/enums";
import {
  disputes,
  estimates,
  fuelLogs,
  inspections,
  invoices,
  jobs,
  media,
  odometerReadings,
  partPurchases,
  payments,
  serviceRecords,
  toolAudits,
  tools,
  vehicleDocuments,
  vehicleIssues,
  vehicles,
} from "@/db/schema";
import { canSeeCustomer } from "@/features/customers/api";
import { assertJobAccess } from "@/features/jobs/api";
import type {
  CompleteUploadResponse,
  PresignedFile,
} from "@/features/media/contracts";
import { writeActivity } from "./activity";
import { actorOf } from "./auth/current";
import { runWithContext } from "./context";
import { sessionSecret } from "./env";
import {
  FeatureDisabledError,
  ForbiddenError,
  ValidationError,
} from "./errors";
import { emit, processEventsSoon } from "./events";
import { hmacSha256Base64url, safeEqual } from "./hash";
import { newId } from "./ids";
import type { Perm } from "./permissions";
import { getSettings, isEnabled } from "./settings";
import type { SessionUser } from "./types";

// Direct-to-storage uploads (SPEC §8.1, M11): presign → client PUT → complete.
// The presign response carries an HMAC upload token binding the user, media id, keys,
// kind/tag, declared size and hashes, the entity and the job (QA T5-12a), so /complete
// only records what this user was allowed to upload, where it was allowed to go.
// Entity and job access are checked at presign and again at complete; an entity type
// without a rule below is refused (QA2 NEW-1).
//
// Hashes (QA2 NEW-2): `sha256Stored` is the client's hash of the exact bytes it PUTs.
// S3 signs it as x-amz-checksum-sha256 (the store refuses another body); /complete
// re-reads it from storage (local: hashes the file; S3: the checksum the store kept)
// and refuses a mismatch, as it does a size that differs from the declared one. The
// row's sha256_stored is that server-side hash, or null when storage couldn't say
// (S3_CHECKSUM=off / a store without checksums) = unverified. sha256_original is
// checked against the stored bytes when they ARE the original (unprocessed file, or
// the kept original); for a compressed photo whose original never reaches the
// server, it remains the client's capture-time claim.

export const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const TOKEN_TTL_SEC = 7 * 24 * 3600; // offline queues may complete days later
const PRESIGN_TTL_SEC = 15 * 60;
const JOB_PHOTO_TAGS = new Set([
  "before",
  "during",
  "after",
  "problem",
  "goal",
  "id_check",
  "other",
]);

const zEntity = z
  .object({ type: z.string().min(1).max(40), id: z.uuid() })
  .nullable()
  .optional();

export const PresignSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(255),
        mime: z.enum(ALLOWED_MIME),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/i),
        sha256Stored: z
          .string()
          .regex(/^[0-9a-f]{64}$/i)
          .optional(),
        kind: z.enum(MEDIA_KINDS),
        tag: z.enum(MEDIA_TAGS).nullable().optional(),
        clientId: z.uuid(),
        withThumb: z.boolean().optional(),
        withOriginal: z.boolean().optional(),
        originalMime: z.enum(ALLOWED_MIME).optional(),
      }),
    )
    .min(1)
    .max(20),
  entity: zEntity,
  jobId: z.uuid().nullable().optional(),
});
export type PresignInput = z.infer<typeof PresignSchema>;

export const CompleteSchema = z.object({
  mediaId: z.uuid(),
  clientId: z.uuid(),
  key: z.string().max(512),
  thumbKey: z.string().max(512).nullable().optional(),
  originalKey: z.string().max(512).nullable().optional(),
  uploadToken: z.string().max(200),
  kind: z.enum(MEDIA_KINDS),
  tag: z.enum(MEDIA_TAGS).nullable().optional(),
  caption: z.string().max(500).nullable().optional(),
  mime: z.enum(ALLOWED_MIME),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  sha256Original: z.string().regex(/^[0-9a-f]{64}$/i),
  sha256Stored: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .nullable()
    .optional(),
  entity: zEntity,
  jobId: z.uuid().nullable().optional(),
  geo: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  fileLastModified: z.number().int().nullable().optional(),
  clientCapturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type CompleteInput = z.infer<typeof CompleteSchema>;

/** Permission(s) — any of — needed to upload a file of this kind/tag (SPEC §8.1 "or a context perm"). */
export function uploadPermsFor(
  kind: string,
  tag: string | null | undefined,
  jobId: string | null | undefined,
): Perm[] | "any" {
  if (kind === "photo" && jobId && (!tag || JOB_PHOTO_TAGS.has(tag)))
    return ["photos.upload"];
  if (kind === "receipt" || tag === "receipt")
    return ["parts.submit_receipt", "vehicles.log", "payments.record_manual"];
  if (tag === "odometer") return ["vehicles.log"];
  if (tag === "tool")
    return [
      "tools.audit_submit",
      "tools.maintenance_log",
      "tools.manage",
      "tools.report_incident",
    ];
  if (kind === "logo") return ["settings.manage"];
  if (kind === "document" || tag === "document") {
    return [
      "vehicles.log",
      "vehicles.manage",
      "customers.edit",
      "settings.manage",
      "disputes.manage",
      "payments.record_manual",
    ];
  }
  if (kind === "export" || kind === "backup") return ["data.export"];
  return "any"; // signature, avatar, generic photos without a job
}

type TokenFields = {
  mediaId: string;
  clientId: string;
  key: string;
  thumbKey?: string | null;
  originalKey?: string | null;
  mime: string;
  kind: string;
  tag?: string | null;
  bytes: number;
  sha256Original: string;
  sha256Stored?: string | null;
  entity?: { type: string; id: string } | null;
  jobId?: string | null;
};

/** v3 token: `v3.<exp>.<hmac>` over every field /complete trusts (v2 + stored hash). */
function sign(userId: string, f: TokenFields, exp: number): string {
  const parts = [
    "upload/v3",
    ...v2Parts(userId, f, exp),
    (f.sha256Stored ?? "").toLowerCase(),
  ];
  return `v3.${exp}.${hmacSha256Base64url(sessionSecret(), parts.join("|"))}`;
}

function v2Parts(userId: string, f: TokenFields, exp: number): string[] {
  return [
    userId,
    f.mediaId,
    f.clientId,
    f.key,
    f.thumbKey ?? "",
    f.originalKey ?? "",
    f.mime,
    f.kind,
    f.tag ?? "",
    String(f.bytes),
    f.sha256Original.toLowerCase(),
    f.entity ? `${f.entity.type}:${f.entity.id}` : "",
    f.jobId ?? "",
    String(exp),
  ];
}

/** v2 tokens (no stored hash) still complete for their 7 days. */
function signV2(userId: string, f: TokenFields, exp: number): string {
  const parts = ["upload/v2", ...v2Parts(userId, f, exp)];
  return `v2.${exp}.${hmacSha256Base64url(sessionSecret(), parts.join("|"))}`;
}

/** Pre-v2 tokens (keys only) still complete for their 7 days; access is re-checked. */
function signLegacy(userId: string, f: TokenFields, exp: number): string {
  const parts = [
    userId,
    f.mediaId,
    f.clientId,
    f.key,
    f.thumbKey ?? "",
    f.originalKey ?? "",
    f.mime,
  ];
  return `${exp}.${hmacSha256Base64url(sessionSecret(), `${parts.join("|")}|${exp}`)}`;
}

export function verifyUploadToken(
  userId: string,
  i: CompleteInput,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const seg = i.uploadToken.split(".");
  const version = seg[0] === "v3" ? 3 : seg[0] === "v2" ? 2 : 1;
  const exp = Number(version > 1 ? seg[1] : seg[0]);
  if (!exp || exp < nowSec) return false;
  const expected =
    version === 3
      ? sign(userId, i, exp)
      : version === 2
        ? signV2(userId, i, exp)
        : signLegacy(userId, i, exp);
  return safeEqual(expected, i.uploadToken);
}

/** Vehicle log rows a file is captured for before the row exists (vehicles sheets). */
const VEHICLE_LOG_TYPES = [
  "odometer",
  "fuel",
  "service",
  "inspection",
  "vehicle_issue",
  "document",
] as const;
type VehicleLogType = (typeof VEHICLE_LOG_TYPES)[number];

/** Who logged a vehicle row; undefined = no such row yet (a planned id). */
async function vehicleLogOwner(
  type: VehicleLogType,
  id: string,
): Promise<string | null | undefined> {
  const one = async (q: Promise<{ owner: string | null }[]>) => {
    const [r] = await q;
    return r ? r.owner : undefined;
  };
  switch (type) {
    case "odometer":
      return one(
        db
          .select({ owner: odometerReadings.recordedBy })
          .from(odometerReadings)
          .where(eq(odometerReadings.id, id))
          .limit(1),
      );
    case "fuel":
      return one(
        db
          .select({ owner: fuelLogs.userId })
          .from(fuelLogs)
          .where(eq(fuelLogs.id, id))
          .limit(1),
      );
    case "service":
      return one(
        db
          .select({ owner: serviceRecords.createdBy })
          .from(serviceRecords)
          .where(eq(serviceRecords.id, id))
          .limit(1),
      );
    case "inspection":
      return one(
        db
          .select({ owner: inspections.userId })
          .from(inspections)
          .where(eq(inspections.id, id))
          .limit(1),
      );
    case "vehicle_issue":
      return one(
        db
          .select({ owner: vehicleIssues.reportedBy })
          .from(vehicleIssues)
          .where(eq(vehicleIssues.id, id))
          .limit(1),
      );
    case "document":
      return one(
        db
          .select({ owner: vehicleDocuments.createdBy })
          .from(vehicleDocuments)
          .where(eq(vehicleDocuments.id, id))
          .limit(1),
      );
  }
}

/**
 * Row access for the entity a file attaches to (QA T5-12a, QA2 NEW-1): a tech can't
 * add files to another tech's vehicle, tool, tool check, vehicle log, customer or
 * document. Some sheets upload before their row exists, against the id they will
 * create (a new tool or vehicle, a fuel log, a handoff anchor): a planned id needs
 * the permission that creates that row, and the creating action only picks up the
 * uploader's own files. Every other type is refused.
 */
export async function assertEntityAccess(
  user: SessionUser,
  entity: { type: string; id: string } | null | undefined,
): Promise<void> {
  if (!entity) return;
  const deny = (): never => {
    throw new ForbiddenError("You can't add files to that record.");
  };
  const has = (p: Perm) => user.perms.has(p);
  switch (entity.type) {
    case "job":
      await assertJobAccess(user, entity.id, "read");
      return;
    case "customer":
      if (!(await canSeeCustomer(user, entity.id))) deny();
      return;
    case "invoice":
    case "estimate": {
      const table = entity.type === "invoice" ? invoices : estimates;
      const [d] = await db
        .select({ jobId: table.jobId, customerId: table.customerId })
        .from(table)
        .where(eq(table.id, entity.id))
        .limit(1);
      if (!d) return deny();
      if (d.jobId) await assertJobAccess(user, d.jobId, "read");
      else if (!(await canSeeCustomer(user, d.customerId))) deny();
      return;
    }
    case "vehicle": {
      const [v] = await db
        .select({ assignedUserId: vehicles.assignedUserId })
        .from(vehicles)
        .where(eq(vehicles.id, entity.id))
        .limit(1);
      // New vehicle form: photos go up before the vehicle is saved.
      if (!v) {
        if (!has("vehicles.manage")) deny();
        return;
      }
      const ok =
        has("vehicles.view_all") ||
        (has("vehicles.view_own") && v.assignedUserId === user.id);
      if (!ok) deny();
      return;
    }
    case "tool": {
      const [t] = await db
        .select({
          currentUserId: tools.currentUserId,
          ownerUserId: tools.ownerUserId,
        })
        .from(tools)
        .where(eq(tools.id, entity.id))
        .limit(1);
      // A new tool (own or company) or a handoff/kit photo anchor.
      if (!t) {
        if (!has("tools.manage") && !has("tools.view_own")) deny();
        return;
      }
      const ok =
        has("tools.view_all") ||
        (has("tools.view_own") &&
          (t.currentUserId === user.id || t.ownerUserId === user.id));
      if (!ok) deny();
      return;
    }
    case "tool_audit": {
      // Audits are created by the scheduler: the row must exist.
      const [a] = await db
        .select({ userId: toolAudits.userId })
        .from(toolAudits)
        .where(eq(toolAudits.id, entity.id))
        .limit(1);
      const ok =
        !!a &&
        ((a.userId === user.id && has("tools.audit_submit")) ||
          has("tools.audit_review") ||
          has("tools.manage"));
      if (!ok) deny();
      return;
    }
    case "odometer":
    case "fuel":
    case "service":
    case "inspection":
    case "vehicle_issue":
    case "document": {
      const owner = await vehicleLogOwner(entity.type, entity.id);
      if (owner === undefined) {
        const perm: Perm =
          entity.type === "vehicle_issue"
            ? "vehicles.report_issue"
            : "vehicles.log";
        if (!has(perm) && !has("vehicles.manage")) deny();
        return;
      }
      if (owner !== user.id && !has("vehicles.view_all")) deny();
      return;
    }
    case "part_purchase": {
      const [p] = await db
        .select({ purchaser: partPurchases.purchaserUserId })
        .from(partPurchases)
        .where(eq(partPurchases.id, entity.id))
        .limit(1);
      const ok =
        !!p &&
        ((p.purchaser === user.id && has("parts.submit_receipt")) ||
          has("parts.approve_reimbursement"));
      if (!ok) deny();
      return;
    }
    case "dispute": {
      if (!has("disputes.manage")) return deny();
      const [d] = await db
        .select({ id: disputes.id })
        .from(disputes)
        .where(eq(disputes.id, entity.id))
        .limit(1);
      if (!d) deny();
      return;
    }
    case "payment": {
      // Proof photos: staff who see every payment, or whoever records manual
      // payments on a job they can open (the job's tech).
      const [p] = await db
        .select({ jobId: payments.jobId })
        .from(payments)
        .where(eq(payments.id, entity.id))
        .limit(1);
      if (!p) return deny();
      if (has("payments.view_all")) return;
      if (!has("payments.record_manual") || !p.jobId) return deny();
      await assertJobAccess(user, p.jobId, "read");
      return;
    }
    case "lead":
      if (!has("leads.view")) deny();
      return;
    case "user":
      if (entity.id !== user.id && !has("users.manage")) deny();
      return;
    default:
      deny();
  }
}

async function assertUploadAllowed(
  user: SessionUser,
  kind: string,
  tag: string | null | undefined,
  jobId: string | null | undefined,
): Promise<void> {
  const perms = uploadPermsFor(kind, tag, jobId);
  if (perms !== "any" && !perms.some((p) => user.perms.has(p)))
    throw new ForbiddenError(undefined, perms.join("|"));
  if (kind === "photo" && jobId && (!tag || JOB_PHOTO_TAGS.has(tag))) {
    if (!(await isEnabled("photos"))) throw new FeatureDisabledError("photos");
    if (
      (tag === "before" || tag === "after") &&
      !(await isEnabled("before_after"))
    )
      throw new FeatureDisabledError("before_after");
  }
  if (jobId) await assertJobAccess(user, jobId, "read");
}

/** Validate and presign every file (PUT URLs for full, thumb, original). */
export async function presignUploads(
  user: SessionUser,
  input: PresignInput,
): Promise<PresignedFile[]> {
  const maxBytes = Math.min(
    MAX_UPLOAD_BYTES,
    (await getSettings()).media.max_upload_mb * 1024 * 1024,
  );
  const storage = getStorage();
  const out: PresignedFile[] = [];
  const now = new Date();
  await assertEntityAccess(user, input.entity);
  for (const f of input.files) {
    if (f.bytes > maxBytes)
      throw new ValidationError({
        files: [
          `${f.name} is larger than ${Math.round(maxBytes / 1048576)} MB.`,
        ],
      });
    await assertUploadAllowed(user, f.kind, f.tag, input.jobId);
    const mediaId = newId();
    const keys = mediaKeys(mediaId, f.mime, now);
    const put = await storage.presignPut(
      keys.key,
      f.mime,
      f.bytes,
      PRESIGN_TTL_SEC,
      { sha256: f.sha256Stored ?? null },
    );
    const thumb =
      f.withThumb && f.mime.startsWith("image/")
        ? await storage.presignPut(
            keys.thumbKey,
            "image/webp",
            2 * 1024 * 1024,
            PRESIGN_TTL_SEC,
          )
        : null;
    // The untouched original may have another type than the compressed main file.
    const originalMime = f.originalMime ?? f.mime;
    if (f.withOriginal)
      keys.originalKey = keys.originalKey.replace(
        /\.[a-z0-9]+$/,
        `.${MIME_EXT[originalMime] ?? "bin"}`,
      );
    // The kept original IS the file sha256 names: the store can check it.
    const original = f.withOriginal
      ? await storage.presignPut(
          keys.originalKey,
          originalMime,
          maxBytes,
          PRESIGN_TTL_SEC,
          { sha256: f.sha256 },
        )
      : null;
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
    const bound: TokenFields = {
      mediaId,
      clientId: f.clientId,
      key: keys.key,
      thumbKey: thumb ? keys.thumbKey : null,
      originalKey: original ? keys.originalKey : null,
      mime: f.mime,
      kind: f.kind,
      tag: f.tag ?? null,
      bytes: f.bytes,
      sha256Original: f.sha256,
      sha256Stored: f.sha256Stored ?? null,
      entity: input.entity ?? null,
      jobId: input.jobId ?? null,
    };
    out.push({
      clientId: f.clientId,
      mediaId,
      key: keys.key,
      upload_url: put.url,
      headers: put.headers,
      ...(thumb
        ? { thumb_key: keys.thumbKey, thumb_upload_url: thumb.url }
        : {}),
      ...(original
        ? {
            original_key: keys.originalKey,
            original_upload_url: original.url,
            original_headers: original.headers,
          }
        : {}),
      upload_token: sign(user.id, bound, exp),
    });
  }
  return out;
}

/**
 * Check what landed in storage against what was presigned (QA2 NEW-2): the size must
 * be the declared one, the stored hash the declared one (when declared), and a kept
 * original or an unprocessed file must hash to sha256Original. On a mismatch the
 * objects are deleted and the upload refused; the client retries from scratch.
 * Returns the stored size and the server-side hash (null = storage can't say).
 */
export async function verifyStoredUpload(i: {
  key: string;
  bytes: number;
  sha256: string | null;
  sha256Original?: string | null;
  originalKey?: string | null;
  cleanup?: (string | null | undefined)[];
  maxBytes?: number;
}): Promise<{ bytes: number | null; sha256: string | null }> {
  const storage = getStorage();
  const refuse = async (message: string): Promise<never> => {
    for (const k of i.cleanup ?? [i.key])
      if (k) await storage.delete(k).catch(() => undefined);
    throw new ValidationError({ key: [message] }, message);
  };
  const incomplete = "The file didn't upload completely. Try again.";
  let bytes: number | null = null;
  if (storage.head) {
    const head = await storage.head(i.key);
    if (!head)
      throw new ValidationError({
        key: ["The file hasn't finished uploading."],
      });
    // S3 presigned PUTs can't cap the size; check what actually landed.
    if (head.bytes > (i.maxBytes ?? MAX_UPLOAD_BYTES) || head.bytes === 0)
      return refuse("That file is too large.");
    if (head.bytes !== i.bytes) return refuse(incomplete);
    bytes = head.bytes;
  }
  const actual = storage.sha256 ? await storage.sha256(i.key) : null;
  if (actual && i.sha256 && actual !== i.sha256) return refuse(incomplete);
  // The kept original must be the file sha256_original names.
  if (i.sha256Original && i.originalKey && storage.sha256) {
    const o = await storage.sha256(i.originalKey);
    if (o && o !== i.sha256Original) return refuse(incomplete);
  }
  return { bytes, sha256: actual };
}

/** Record an uploaded file as a media row (idempotent on clientId); emits photo.uploaded for job photos. */
export async function completeUpload(
  user: SessionUser,
  i: CompleteInput,
): Promise<CompleteUploadResponse> {
  const storage = getStorage();
  const [existing] = await db
    .select()
    .from(media)
    .where(eq(media.clientId, i.clientId))
    .limit(1);
  if (existing) {
    if (existing.uploaderId !== user.id) throw new ForbiddenError();
    return {
      mediaId: existing.id,
      created: false,
      flags: existing.flags,
      url: await storage.signedGetUrl(existing.storageKey, 600),
      thumbUrl: existing.thumbKey
        ? await storage.signedGetUrl(existing.thumbKey, 600)
        : null,
    };
  }
  if (!verifyUploadToken(user.id, i))
    throw new ForbiddenError("This upload link is invalid or expired.");
  for (const k of [i.key, i.thumbKey, i.originalKey])
    if (k && !isSafeKey(k))
      throw new ValidationError({ key: ["Invalid key."] });
  await assertUploadAllowed(user, i.kind, i.tag, i.jobId);
  await assertEntityAccess(user, i.entity);
  // Only a v3 token covers the declared stored hash.
  const declaredStored = i.uploadToken.startsWith("v3.")
    ? (i.sha256Stored?.toLowerCase() ?? null)
    : null;
  const stored = await verifyStoredUpload({
    key: i.key,
    bytes: i.bytes,
    sha256: declaredStored,
    sha256Original: i.sha256Original.toLowerCase(),
    originalKey: i.originalKey ?? null,
    cleanup: [i.key, i.thumbKey, i.originalKey],
  });

  let customerId: string | null = null;
  if (i.jobId) {
    const [j] = await db
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, i.jobId))
      .limit(1);
    customerId = j?.customerId ?? null;
  }
  const serverReceivedAt = new Date();
  const flags: string[] = [];
  if (
    i.fileLastModified &&
    serverReceivedAt.getTime() - i.fileLastModified > 24 * 3600_000
  )
    flags.push("possibly_from_library");
  if (!i.geo) flags.push("no_geo");

  const actor = actorOf(user);
  const created = await runWithContext({ actor, user }, () =>
    db.transaction(async (tx) => {
      const rows = await tx
        .insert(media)
        .values({
          id: i.mediaId,
          kind: i.kind,
          tag: i.tag ?? null,
          storageKey: i.key,
          thumbKey: i.thumbKey ?? null,
          originalKey: i.originalKey ?? null,
          mime: i.mime,
          width: i.width ?? null,
          height: i.height ?? null,
          // What actually landed in storage, not the client's claim.
          bytes: stored.bytes ?? i.bytes,
          sha256Original: i.sha256Original.toLowerCase(),
          // Server-side hash of the stored file; null = storage couldn't verify it.
          sha256Stored: stored.sha256,
          caption: i.caption ?? null,
          jobId: i.jobId ?? null,
          customerId,
          entityType: i.entity?.type ?? null,
          entityId: i.entity?.id ?? null,
          uploaderId: user.id,
          fileLastModified: i.fileLastModified
            ? new Date(i.fileLastModified)
            : null,
          clientCapturedAt: i.clientCapturedAt
            ? new Date(i.clientCapturedAt)
            : null,
          serverReceivedAt,
          lat: i.geo?.lat ?? null,
          lng: i.geo?.lng ?? null,
          accuracyM: i.geo?.accuracyM ?? null,
          flags,
          clientId: i.clientId,
        })
        .onConflictDoNothing()
        .returning({ id: media.id });
      if (rows.length === 0) return false;
      if (i.kind === "photo" && i.jobId) {
        const entity = { type: "job", id: i.jobId } as const;
        await emit(
          tx,
          "photo.uploaded",
          entity,
          { media_id: i.mediaId, job_id: i.jobId, tag: i.tag ?? null },
          { actor },
        );
        await writeActivity(tx, {
          entity,
          customerId,
          jobId: i.jobId,
          kind: "photo.uploaded",
          summary: `Photo added${i.tag ? ` (${i.tag})` : ""}`,
          data: { media_id: i.mediaId },
          actorUserId: user.id,
        });
      }
      return true;
    }),
  );
  if (created) await processEventsSoon();
  return {
    mediaId: i.mediaId,
    created,
    flags,
    url: await storage.signedGetUrl(i.key, 600),
    thumbUrl: i.thumbKey ? await storage.signedGetUrl(i.thumbKey, 600) : null,
  };
}
