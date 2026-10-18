import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { sessionSecret } from "@/lib/env";
import { hmacSha256Base64url, safeEqual } from "@/lib/hash";
import { isSafeKey, mimeFromKey } from "./keys";
import type { StorageProvider } from "./types";

// Local filesystem storage for development (SPEC §9.3): files under ./.data/uploads
// (UPLOADS_DIR overrides). Presigned PUT/GET are HMAC-signed, expiring URLs served by
// /api/uploads/local/[...key].

export const LOCAL_ROUTE = "/api/uploads/local";

function root(): string {
  const dir = process.env.UPLOADS_DIR || "./.data/uploads";
  return path.isAbsolute(dir)
    ? dir
    : path.join(/* turbopackIgnore: true */ process.cwd(), dir);
}

function fileFor(key: string): string {
  if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
  return path.join(root(), key);
}

function sign(
  method: "GET" | "PUT",
  key: string,
  exp: number,
  extra = "",
): string {
  return hmacSha256Base64url(
    sessionSecret(),
    `${method}\n${key}\n${exp}\n${extra}`,
  );
}

/** Verify a signed local-storage URL (used by the route handler). */
export function verifyLocalUrl(
  method: "GET" | "PUT",
  key: string,
  params: URLSearchParams,
  nowSec = Math.floor(Date.now() / 1000),
):
  | { ok: true; mime?: string; bytes?: number; download?: string }
  | { ok: false; reason: string } {
  const exp = Number(params.get("exp"));
  const sig = params.get("sig") ?? "";
  if (!isSafeKey(key)) return { ok: false, reason: "bad key" };
  if (!exp || exp < nowSec) return { ok: false, reason: "expired" };
  const mime = params.get("m") ?? undefined;
  const bytes = params.get("b") ? Number(params.get("b")) : undefined;
  const download = params.get("dl") ?? undefined;
  const extra =
    method === "PUT" ? `${mime ?? ""}\n${bytes ?? ""}` : (download ?? "");
  if (!safeEqual(sign(method, key, exp, extra), sig))
    return { ok: false, reason: "bad signature" };
  return { ok: true, mime, bytes, download };
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function streamToBytes(
  body: Uint8Array | ReadableStream,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const buf = await new Response(body).arrayBuffer();
  return new Uint8Array(buf);
}

export const localStorageProvider: StorageProvider = {
  id: "local",
  async presignPut(key, mime, bytes, expiresSec = 900) {
    const exp = Math.floor(Date.now() / 1000) + expiresSec;
    const sig = sign("PUT", key, exp, `${mime}\n${bytes}`);
    const qs = new URLSearchParams({
      exp: String(exp),
      sig,
      m: mime,
      b: String(bytes),
    });
    return {
      url: `${LOCAL_ROUTE}/${encodeKey(key)}?${qs}`,
      headers: { "Content-Type": mime },
    };
  },
  async signedGetUrl(key, expiresSec = 600, downloadName) {
    const exp = Math.floor(Date.now() / 1000) + expiresSec;
    const sig = sign("GET", key, exp, downloadName ?? "");
    const qs = new URLSearchParams({ exp: String(exp), sig });
    if (downloadName) qs.set("dl", downloadName);
    return `${LOCAL_ROUTE}/${encodeKey(key)}?${qs}`;
  },
  async put(key, body, _mime) {
    const file = fileFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await streamToBytes(body));
  },
  async get(key) {
    return new Uint8Array(await readFile(fileFor(key)));
  },
  async delete(key) {
    await rm(fileFor(key), { force: true });
  },
  async head(key) {
    try {
      const s = await stat(fileFor(key));
      return s.isFile() ? { bytes: s.size, mime: mimeFromKey(key) } : null;
    } catch {
      return null;
    }
  },
  /** Hash of the bytes on disk (uploads are ≤ 15 MB). */
  async sha256(key) {
    try {
      return createHash("sha256")
        .update(await readFile(fileFor(key)))
        .digest("hex");
    } catch {
      return null;
    }
  },
};
