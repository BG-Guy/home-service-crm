// Direct-to-storage media upload (SPEC §M11, §8.1):
//   POST /api/uploads/presign → PUT each part to its presigned URL (XHR for
//   progress) → POST /api/uploads/complete (idempotent on clientId).
// Request/response shapes: PresignRequest / CompleteUploadRequest in
// src/features/media/contracts.ts (validated by src/lib/uploads.ts).
// Used by the outbox (queueUpload) — call that, not this, from UI code.

import type { MEDIA_KINDS, MEDIA_TAGS } from "@/db/enums";
import type {
  CompleteUploadRequest,
  CompleteUploadResponse,
  PresignedFile,
  PresignRequest,
  PresignResponse,
} from "@/features/media/contracts";
import type { Geo } from "./geo";
import { sha256Hex } from "./hash";

export type MediaKind = (typeof MEDIA_KINDS)[number];
export type MediaTag = (typeof MEDIA_TAGS)[number];

/** Structural copy of `EntityRef` from src/lib/types.ts. */
export interface EntityRefLike {
  type: string;
  id: string;
}

/** BUILD_PLAN §6.11 contract. `clientId` becomes `media.client_id`. */
export interface UploadMeta {
  clientId: string;
  kind: MediaKind;
  tag?: MediaTag | null;
  caption?: string | null;
  entity?: EntityRefLike | null;
  jobId?: string | null;
  geo?: Geo | null;
  fileLastModified?: number | null;
  clientCapturedAt: string;
  sha256Original: string;
  keepOriginal?: boolean;
}

export interface UploadParts {
  main: Blob;
  thumb?: Blob | null;
  /** Sent only when `meta.keepOriginal` and it differs from `main`. */
  original?: Blob | null;
  width?: number | null;
  height?: number | null;
  exif?: {
    takenAt: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  /** Original file name (for content-disposition / extension). */
  name?: string;
}

export class UploadError extends Error {
  constructor(
    message: string,
    /** Network / 5xx / 401 / 408 / 429 → try again later. */
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/** Wire shapes live in the media contracts (server: src/lib/uploads.ts). */
type PresignTarget = PresignedFile;

/** Mimes the presign route accepts (src/lib/uploads.ts ALLOWED_MIME). */
const UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

const retryableStatus = (s: number) =>
  s === 0 || s === 401 || s === 408 || s === 429 || s >= 500;

async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    throw new UploadError((e as Error).message || "Network error", true);
  }
  if (!res.ok) {
    let msg = `${url} failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      // Prefer the user-facing message (e.g. 503 "server is missing settings").
      if (j.message || j.error) msg = (j.message ?? j.error) as string;
    } catch {
      /* not json */
    }
    throw new UploadError(msg, retryableStatus(res.status), res.status);
  }
  return (await res.json()) as T;
}

function put(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Exactly the headers the URL was signed for: one Content-Type and, on S3, the
    // body checksum (setRequestHeader appends, so never set one twice).
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size);
        resolve();
      } else {
        reject(
          new UploadError(
            `Upload failed (${xhr.status})`,
            retryableStatus(xhr.status),
            xhr.status,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new UploadError("Network error", true));
    xhr.ontimeout = () => reject(new UploadError("Upload timed out", true));
    xhr.onabort = () => reject(new UploadError("Upload aborted", true));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/**
 * Upload one media item (main + optional thumb/original) and create the
 * `media` row. Returns the server's media id.
 * @param onProgress fraction 0–1 across all parts.
 */
export async function uploadMedia(
  parts: UploadParts,
  meta: UploadMeta,
  {
    onProgress,
    signal,
  }: { onProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<{ mediaId: string }> {
  const mainMime = parts.main.type || "application/octet-stream";
  const original =
    meta.keepOriginal &&
    parts.original &&
    parts.original !== parts.main &&
    UPLOAD_MIME.has(parts.original.type)
      ? parts.original
      : null;
  // The server signs thumbnails as image/webp; skip a JPEG fallback thumb.
  const thumb = parts.thumb?.type === "image/webp" ? parts.thumb : null;
  // Hash of the bytes actually sent: the store (S3 checksum) or /complete (local)
  // refuses a body that doesn't match, so a cut-off upload never becomes evidence.
  const sha256Stored = await sha256Hex(parts.main);
  const presignBody: PresignRequest = {
    files: [
      {
        clientId: meta.clientId,
        name: parts.name ?? `${meta.clientId}.${extFor(mainMime)}`,
        mime: mainMime,
        bytes: parts.main.size,
        sha256: meta.sha256Original,
        sha256Stored,
        kind: meta.kind,
        tag: meta.tag ?? null,
        withThumb: !!thumb,
        withOriginal: !!original,
        ...(original ? { originalMime: original.type } : {}),
      },
    ],
    entity: (meta.entity as PresignRequest["entity"]) ?? null,
    jobId: meta.jobId ?? null,
  };
  const presigned = await postJson<PresignResponse>(
    "/api/uploads/presign",
    presignBody,
    signal,
  );
  const target: PresignTarget | undefined = presigned.files?.[0];
  if (!target?.upload_url)
    throw new UploadError("Presign returned no URL", false);

  const jobs: Array<{
    url: string;
    blob: Blob;
    headers: Record<string, string>;
  }> = [
    {
      url: target.upload_url,
      blob: parts.main,
      headers: target.headers?.["Content-Type"]
        ? target.headers
        : { ...target.headers, "Content-Type": mainMime },
    },
  ];
  if (thumb && target.thumb_upload_url)
    jobs.push({
      url: target.thumb_upload_url,
      blob: thumb,
      headers: { "Content-Type": "image/webp" },
    });
  if (original && target.original_upload_url)
    jobs.push({
      url: target.original_upload_url,
      blob: original,
      headers: target.original_headers ?? { "Content-Type": original.type },
    });

  const total = jobs.reduce((a, j) => a + j.blob.size, 0) || 1;
  const loaded = jobs.map(() => 0);
  const report = () =>
    onProgress?.(Math.min(0.98, loaded.reduce((a, b) => a + b, 0) / total));
  await Promise.all(
    jobs.map((j, i) =>
      put(
        j.url,
        j.blob,
        j.headers,
        (n) => {
          loaded[i] = n;
          report();
        },
        signal,
      ),
    ),
  );

  const completeBody: CompleteUploadRequest = {
    mediaId: target.mediaId,
    clientId: meta.clientId,
    key: target.key,
    thumbKey: thumb ? (target.thumb_key ?? null) : null,
    originalKey: original ? (target.original_key ?? null) : null,
    uploadToken: target.upload_token,
    kind: meta.kind,
    tag: meta.tag ?? null,
    caption: meta.caption ?? null,
    mime: mainMime,
    bytes: parts.main.size,
    width: parts.width ?? null,
    height: parts.height ?? null,
    sha256Original: meta.sha256Original,
    sha256Stored,
    entity: (meta.entity as CompleteUploadRequest["entity"]) ?? null,
    jobId: meta.jobId ?? null,
    geo: meta.geo
      ? {
          lat: meta.geo.lat,
          lng: meta.geo.lng,
          accuracyM: meta.geo.accuracyM ?? null,
        }
      : null,
    fileLastModified: meta.fileLastModified ?? null,
    clientCapturedAt: meta.clientCapturedAt,
  };
  const done = await postJson<CompleteUploadResponse>(
    "/api/uploads/complete",
    completeBody,
    signal,
  );
  if (!done.mediaId)
    throw new UploadError("Complete returned no media id", false);
  onProgress?.(1);
  return { mediaId: done.mediaId };
}

function extFor(mime: string): string {
  return (
    (
      {
        "image/webp": "webp",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/heic": "heic",
        "application/pdf": "pdf",
      } as Record<string, string>
    )[mime] ?? "bin"
  );
}
