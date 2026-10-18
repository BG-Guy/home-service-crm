import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getStorage, isSafeKey, mediaKeys } from "@/adapters/storage";
import { db } from "@/db";
import { media } from "@/db/schema";
import { peekPublicToken } from "@/features/portal/token";
import { sessionSecret } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { hmacSha256Base64url, safeEqual } from "@/lib/hash";
import { newId } from "@/lib/ids";
import { assertRateLimit } from "@/lib/ratelimit";
import type { PublicTokenRow } from "@/lib/tokens";
import { verifyStoredUpload } from "@/lib/uploads";

// Public (no-session) uploads for remote signing on /e/[token] (BUILD_PLAN §3.3:
// `api/uploads/public/presign`): the drawn signature PNG and an optional ID photo.
// Same presign → PUT → complete shape as F's session routes, but authorized by a live
// estimate/job magic link and bound to it with an HMAC upload token.
// Creates `media` rows like F's upload routes do — an approved BUILD_PLAN §11.2
// exception (public signing uploads), recorded at integration.

export const PUBLIC_UPLOAD_KINDS = ["estimate", "job"] as const;
const MIME = ["image/png", "image/jpeg", "image/webp", "image/heic"] as const;
const MAX_BYTES = 8 * 1024 * 1024;
const TTL_SEC = 30 * 60;
/** Files one document can receive through its magic links (signature retries + ID photo). */
export const MAX_PUBLIC_FILES_PER_DOC = 12;
/** Presigns per link per day: each one lets the client PUT a file to storage. */
export const MAX_PUBLIC_PRESIGNS_PER_LINK = 20;

export const PublicPresignSchema = z.object({
  token: z.string().min(32).max(128),
  file: z.object({
    clientId: z.uuid(),
    mime: z.enum(MIME),
    bytes: z.number().int().positive().max(MAX_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i),
    kind: z.enum(["signature", "photo"]),
  }),
});

export const PublicCompleteSchema = z.object({
  token: z.string().min(32).max(128),
  mediaId: z.uuid(),
  clientId: z.uuid(),
  key: z.string().max(512),
  uploadToken: z.string().max(200),
  mime: z.enum(MIME),
  bytes: z.number().int().positive().max(MAX_BYTES),
  sha256Original: z.string().regex(/^[0-9a-f]{64}$/i),
  kind: z.enum(["signature", "photo"]),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

const sign = (parts: string[], exp: number) =>
  `${exp}.${hmacSha256Base64url(sessionSecret(), `pub|${parts.join("|")}|${exp}`)}`;

async function tokenRow(token: string): Promise<PublicTokenRow> {
  const row = await peekPublicToken(PUBLIC_UPLOAD_KINDS, token);
  if (!row) throw new NotFoundError("Link");
  return row;
}

/** Public (uploader-less) files already stored for the link's document. */
async function publicFileCount(row: PublicTokenRow): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(media)
    .where(
      and(
        eq(media.entityType, row.entityType),
        eq(media.entityId, row.entityId),
        isNull(media.uploaderId),
      ),
    );
  return Number(r?.n ?? 0);
}

const LIMIT_MESSAGE =
  "This link can't take more uploads. Contact us and we'll send a fresh one.";

/**
 * Per-link caps (QA T5-19): a daily presign budget per token (every presign lets
 * the client PUT a file) and a hard cap on stored files per document.
 */
async function assertLinkQuota(row: PublicTokenRow): Promise<void> {
  await assertRateLimit(
    {
      key: `pubupload:tok:${row.id}`,
      limit: MAX_PUBLIC_PRESIGNS_PER_LINK,
      windowSec: 86_400,
    },
    LIMIT_MESSAGE,
  );
  if ((await publicFileCount(row)) >= MAX_PUBLIC_FILES_PER_DOC)
    throw new ConflictError("upload_limit", LIMIT_MESSAGE);
}

export async function publicPresign(
  input: z.infer<typeof PublicPresignSchema>,
  ip: string | null,
): Promise<{
  mediaId: string;
  key: string;
  upload_url: string;
  headers: Record<string, string>;
  upload_token: string;
}> {
  await assertRateLimit({
    key: `pubupload:${ip ?? "unknown"}`,
    limit: 20,
    windowSec: 600,
  });
  const row = await tokenRow(input.token);
  if (input.file.kind === "signature" && input.file.mime !== "image/png")
    throw new ValidationError({ file: ["Signatures upload as PNG."] });
  await assertLinkQuota(row);
  const mediaId = newId();
  const { key } = mediaKeys(mediaId, input.file.mime);
  // The PNG is stored byte-for-byte: S3 refuses any other body (checksum header).
  const put = await getStorage().presignPut(
    key,
    input.file.mime,
    input.file.bytes,
    TTL_SEC,
    { sha256: input.file.sha256 },
  );
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  return {
    mediaId,
    key,
    upload_url: put.url,
    headers: put.headers,
    upload_token: sign(
      [
        row.id,
        mediaId,
        input.file.clientId,
        key,
        input.file.mime,
        input.file.kind,
      ],
      exp,
    ),
  };
}

export async function publicComplete(
  input: z.infer<typeof PublicCompleteSchema>,
): Promise<{ mediaId: string; created: boolean }> {
  const row = await tokenRow(input.token);
  const [existing] = await db
    .select({ id: media.id, entityId: media.entityId })
    .from(media)
    .where(eq(media.clientId, input.clientId))
    .limit(1);
  if (existing) {
    if (existing.entityId !== row.entityId) throw new ForbiddenError();
    return { mediaId: existing.id, created: false };
  }
  const [expStr] = input.uploadToken.split(".");
  const exp = Number(expStr);
  const expected = sign(
    [row.id, input.mediaId, input.clientId, input.key, input.mime, input.kind],
    exp,
  );
  if (
    !exp ||
    exp < Date.now() / 1000 ||
    !safeEqual(expected, input.uploadToken)
  )
    throw new ForbiddenError("This upload link is invalid or expired.");
  if (!isSafeKey(input.key))
    throw new ValidationError({ key: ["Invalid key."] });
  if ((await publicFileCount(row)) >= MAX_PUBLIC_FILES_PER_DOC) {
    await getStorage()
      .delete(input.key)
      .catch(() => undefined);
    throw new ConflictError("upload_limit", LIMIT_MESSAGE);
  }
  // Size and hash of what landed (QA2 NEW-2): the stored file is the evidence, so
  // its hash must be the one claimed; a mismatch deletes it and fails the upload.
  const stored = await verifyStoredUpload({
    key: input.key,
    bytes: input.bytes,
    sha256: input.sha256Original.toLowerCase(),
    maxBytes: MAX_BYTES,
  });
  const rows = await db
    .insert(media)
    .values({
      id: input.mediaId,
      kind: input.kind,
      tag: input.kind === "signature" ? "signature" : "id_check",
      storageKey: input.key,
      mime: input.mime,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: stored.bytes ?? input.bytes,
      sha256Original: input.sha256Original.toLowerCase(),
      sha256Stored: stored.sha256,
      jobId: row.jobId,
      customerId: row.customerId,
      entityType: row.entityType,
      entityId: row.entityId,
      uploaderId: null,
      clientCapturedAt: new Date(),
      flags: [],
      clientId: input.clientId,
    })
    .onConflictDoNothing()
    .returning({ id: media.id });
  return { mediaId: input.mediaId, created: rows.length > 0 };
}
