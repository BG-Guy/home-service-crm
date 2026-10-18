"use client";

import { sha256Hex } from "@/client/image";
import { queueUpload } from "@/client/outbox";
import { newId } from "@/lib/ids";

// Signature/ID-photo uploads for S15. Signed-in devices use the standard outbox
// (`queueUpload`, kind 'signature'); remote signers on a magic link use B3's public
// routes (/api/uploads/public/presign → PUT → /api/uploads/public/complete).
// A signature must be stored before the consumer's action runs, so offline queuing
// is not accepted here: callers show "connect to sign" instead.

export class SignatureUploadError extends Error {}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok) {
    let msg = "Upload failed. Please try again.";
    try {
      const j = (await res.json()) as { message?: string; error?: string };
      if (res.status === 404) msg = "This link has expired.";
      else if (res.status === 429)
        msg = "Too many attempts. Wait a minute and retry.";
      else if (j.message) msg = j.message;
    } catch {
      /* not json */
    }
    throw new SignatureUploadError(msg);
  }
  return (await res.json()) as T;
}

/** Upload through a magic link (no session). Returns the media id. */
export async function uploadPublic(
  blob: Blob,
  token: string,
  kind: "signature" | "photo",
): Promise<string> {
  const clientId = newId();
  const sha256 = await sha256Hex(blob);
  const mime = (blob.type || "image/png") as
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "image/heic";
  const pre = await postJson<{
    mediaId: string;
    key: string;
    upload_url: string;
    headers: Record<string, string>;
    upload_token: string;
  }>("/api/uploads/public/presign", {
    token,
    file: { clientId, mime, bytes: blob.size, sha256, kind },
  });
  // Every signed header (Content-Type and, on S3, the body checksum).
  const put = await fetch(pre.upload_url, {
    method: "PUT",
    headers: {
      ...pre.headers,
      "Content-Type": pre.headers?.["Content-Type"] ?? mime,
    },
    body: blob,
  });
  if (!put.ok)
    throw new SignatureUploadError("Upload failed. Please try again.");
  const done = await postJson<{ mediaId: string }>(
    "/api/uploads/public/complete",
    {
      token,
      mediaId: pre.mediaId,
      clientId,
      key: pre.key,
      uploadToken: pre.upload_token,
      mime,
      bytes: blob.size,
      sha256Original: sha256,
      kind,
    },
  );
  return done.mediaId;
}

/** Upload a signature PNG for a signed-in user (standard outbox path). */
export async function uploadSignature(
  blob: Blob,
  opts: {
    publicToken?: string;
    jobId?: string | null;
    entity?: { type: string; id: string } | null;
  },
): Promise<string> {
  if (opts.publicToken)
    return uploadPublic(blob, opts.publicToken, "signature");
  const clientId = newId();
  const sha256Original = await sha256Hex(blob);
  const capturedAt = new Date().toISOString();
  // Keep the PNG byte-for-byte (no WebP re-encode): the stored file is the evidence.
  const res = await queueUpload(
    blob,
    {
      clientId,
      kind: "signature",
      tag: "signature",
      jobId: opts.jobId ?? null,
      entity: opts.entity ?? null,
      clientCapturedAt: capturedAt,
      sha256Original,
    },
    {
      prepared: {
        main: blob,
        thumb: null,
        width: null,
        height: null,
        original: blob,
        sha256Original,
        exif: null,
        capturedAt,
        fileLastModified: null,
        processed: false,
      },
    },
  );
  if (!res.mediaId)
    throw new SignatureUploadError(
      "You're offline. Connect to the internet to save the signature.",
    );
  return res.mediaId;
}
