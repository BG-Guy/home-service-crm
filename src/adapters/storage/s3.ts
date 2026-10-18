import "server-only";
import { AwsClient } from "aws4fetch";
import { getSecret } from "@/lib/secrets";
import { mimeFromKey } from "./keys";
import type { StorageProvider } from "./types";

// S3-compatible storage (R2, S3, B2…) via aws4fetch presigned URLs (SPEC §9.3).
// Path-style URLs: ${S3_ENDPOINT}/${S3_BUCKET}/${key}.

let client: AwsClient | null = null;

async function aws(): Promise<AwsClient> {
  if (client) return client;
  const accessKeyId = await getSecret("S3_ACCESS_KEY_ID");
  const secretAccessKey = await getSecret("S3_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey)
    throw new Error("S3 credentials are not configured");
  client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION || "auto",
    service: "s3",
  });
  return client;
}

function objectUrl(key: string): string {
  const endpoint = (process.env.S3_ENDPOINT || "").replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET;
  if (!endpoint || !bucket)
    throw new Error("S3_ENDPOINT and S3_BUCKET must be set");
  return `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function presign(
  method: "GET" | "PUT",
  key: string,
  expiresSec: number,
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  // allHeaders: sign Content-Type too (aws4fetch skips it by default), so a PUT URL
  // can't be reused to store e.g. text/html under an image key.
  const signed = await (await aws()).sign(
    new Request(url, { method, headers }),
    { aws: { signQuery: true, allHeaders: true } },
  );
  return signed.url;
}

async function call(
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  key: string,
  init: RequestInit = {},
): Promise<Response> {
  return (await aws()).fetch(objectUrl(key), { method, ...init });
}

/**
 * Body checksums (QA2 NEW-2): a presigned PUT carries a signed `x-amz-checksum-sha256`,
 * so S3/R2 refuse a truncated or swapped body. S3_CHECKSUM=off for a store that
 * rejects the header; hashes are then recorded as unverified (media.sha256_stored null).
 */
export function s3ChecksumsEnabled(): boolean {
  return (process.env.S3_CHECKSUM ?? "").trim().toLowerCase() !== "off";
}

const HEX64 = /^[0-9a-f]{64}$/i;

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

export function base64ToHex(b64: string): string | null {
  const hex = Buffer.from(b64, "base64").toString("hex");
  return HEX64.test(hex) ? hex : null;
}

export const s3StorageProvider: StorageProvider = {
  id: "s3",
  async presignPut(key, mime, _bytes, expiresSec = 900, opts) {
    const headers: Record<string, string> = { "Content-Type": mime };
    if (opts?.sha256 && HEX64.test(opts.sha256) && s3ChecksumsEnabled())
      headers["x-amz-checksum-sha256"] = hexToBase64(opts.sha256);
    return {
      url: await presign("PUT", key, expiresSec, {}, headers),
      headers,
    };
  },
  async signedGetUrl(key, expiresSec = 600, downloadName) {
    // Serve with the type implied by the key, never whatever the uploader sent.
    const q: Record<string, string> = {
      "response-content-type": mimeFromKey(key),
    };
    if (downloadName)
      q["response-content-disposition"] =
        `attachment; filename="${downloadName.replace(/["\\\r\n]/g, "")}"`;
    return presign("GET", key, expiresSec, q);
  },
  async put(key, body, mime) {
    const bytes =
      body instanceof Uint8Array
        ? body
        : new Uint8Array(await new Response(body).arrayBuffer());
    const res = await call("PUT", key, {
      body: bytes as unknown as BodyInit,
      headers: { "Content-Type": mime },
    });
    if (!res.ok) throw new Error(`S3 PUT ${key} failed: HTTP ${res.status}`);
  },
  async get(key) {
    const res = await call("GET", key);
    if (!res.ok) throw new Error(`S3 GET ${key} failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  async delete(key) {
    const res = await call("DELETE", key);
    if (!res.ok && res.status !== 404)
      throw new Error(`S3 DELETE ${key} failed: HTTP ${res.status}`);
  },
  async head(key) {
    const res = await call("HEAD", key);
    if (!res.ok) return null;
    return {
      bytes: Number(res.headers.get("content-length") ?? 0),
      mime: res.headers.get("content-type") ?? mimeFromKey(key),
    };
  },
  /** The checksum the store verified on PUT (never downloads the object). */
  async sha256(key) {
    if (!s3ChecksumsEnabled()) return null;
    const res = await call("HEAD", key, {
      headers: { "x-amz-checksum-mode": "ENABLED" },
    });
    const b64 = res.ok ? res.headers.get("x-amz-checksum-sha256") : null;
    // Multipart objects report "<b64>-<parts>": a checksum of checksums, not the body.
    return b64 && !b64.includes("-") ? base64ToHex(b64) : null;
  },
};
