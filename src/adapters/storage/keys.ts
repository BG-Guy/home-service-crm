// Storage key layout (SPEC §9.3): media/{yyyy}/{mm}/{uuid}.{ext}, …_thumb.webp,
// …_orig.{ext}, exports/…, backups/{date}/…, nacha/…  Isomorphic helpers.

export const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
  "text/csv": "csv",
  "text/plain": "txt",
};

export function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  for (const [mime, e] of Object.entries(MIME_EXT)) if (e === ext) return mime;
  if (ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/** Safe object key: no traversal, no leading slash, limited charset. */
export function isSafeKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 512 &&
    !key.startsWith("/") &&
    !key.split("/").some((seg) => seg === "" || seg === "." || seg === "..") &&
    /^[A-Za-z0-9._\-/]+$/.test(key)
  );
}

export function mediaKeys(
  id: string,
  mime: string,
  at = new Date(),
): { key: string; thumbKey: string; originalKey: string } {
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const ext = MIME_EXT[mime] ?? "bin";
  const base = `media/${yyyy}/${mm}/${id}`;
  return {
    key: `${base}.${ext}`,
    thumbKey: `${base}_thumb.webp`,
    originalKey: `${base}_orig.${ext}`,
  };
}
