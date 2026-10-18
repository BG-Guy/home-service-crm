// Client photo pipeline (SPEC §M11, §14): 1600 px long-edge derivative +
// 320 px thumbnail, WebP q0.8 (JPEG where the browser can't encode WebP),
// EXIF orientation honored by createImageBitmap, capture time/GPS from EXIF,
// SHA-256 of the ORIGINAL bytes. No browser-image-compression.

import { type ExifInfo, readExif } from "./exif";
import { sha256Hex } from "./hash";

export interface PrepareOptions {
  /** Long edge of the main derivative (default 1600). */
  maxEdge?: number;
  /** Long edge of the thumbnail (default 320). */
  thumbEdge?: number;
  /** Encoder quality 0–1 (default 0.8). */
  quality?: number;
}

export interface PreparedImage {
  /** Upload-ready derivative (or the original when it can't be decoded, e.g. HEIC on desktop Chrome). */
  main: Blob;
  /** 320 px thumbnail, or null when decoding failed. */
  thumb: Blob | null;
  width: number | null;
  height: number | null;
  /** The untouched original (upload only when keeping originals). */
  original: Blob;
  /** Hex SHA-256 of the original bytes (evidence hash). */
  sha256Original: string;
  exif: ExifInfo | null;
  /** Best capture time: EXIF DateTimeOriginal, else File.lastModified, else now (ISO). */
  capturedAt: string;
  /** File.lastModified (ms) when available. */
  fileLastModified: number | null;
  /** True when a derivative was produced. */
  processed: boolean;
}

/** Hex SHA-256 via SubtleCrypto (re-exported; lives in ./hash). */
export { sha256Hex };

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(
  c: AnyCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if ("convertToBlob" in c) {
    return c.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/** WebP if the browser can encode it, else JPEG (Safari ≤ 17 encodes WebP as PNG). */
async function encode(c: AnyCanvas, quality: number): Promise<Blob> {
  const webp = await toBlob(c, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob(c, "image/jpeg", quality);
  if (!jpeg) throw new Error("Image encoding failed");
  return jpeg;
}

function draw(
  src: CanvasImageSource,
  sw: number,
  sh: number,
  maxEdge: number,
): AnyCanvas {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/**
 * Prepare a captured photo for upload. Never rejects on decode problems: falls
 * back to the original (`processed: false`) so the upload still happens.
 */
export async function prepareImage(
  file: Blob,
  { maxEdge = 1600, thumbEdge = 320, quality = 0.8 }: PrepareOptions = {},
): Promise<PreparedImage> {
  const fileLastModified =
    typeof File !== "undefined" && file instanceof File
      ? file.lastModified
      : null;
  const [sha256Original, exif] = await Promise.all([
    sha256Hex(file),
    readExif(file),
  ]);
  const capturedAt = exif?.takenAt
    ? exif.takenAt
    : new Date(fileLastModified ?? Date.now()).toISOString();

  const base = {
    original: file,
    sha256Original,
    exif,
    capturedAt,
    fileLastModified,
  };

  if (!file.type.startsWith("image/")) {
    return {
      ...base,
      main: file,
      thumb: null,
      width: null,
      height: null,
      processed: false,
    };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const mainCanvas = draw(bitmap, bitmap.width, bitmap.height, maxEdge);
    const thumbCanvas = draw(
      mainCanvas,
      mainCanvas.width,
      mainCanvas.height,
      thumbEdge,
    );
    const [main, thumb] = await Promise.all([
      encode(mainCanvas, quality),
      encode(thumbCanvas, Math.min(quality, 0.75)),
    ]);
    return {
      ...base,
      main,
      thumb,
      width: mainCanvas.width,
      height: mainCanvas.height,
      processed: true,
    };
  } catch {
    return {
      ...base,
      main: file,
      thumb: null,
      width: null,
      height: null,
      processed: false,
    };
  } finally {
    bitmap?.close();
  }
}

/** Object URL for previews; remember to `URL.revokeObjectURL` it. */
export function previewUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
