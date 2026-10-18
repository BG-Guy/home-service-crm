import "server-only";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { getStorage } from "@/adapters/storage";
import { mediaKeys } from "@/adapters/storage/keys";
import { type DB, execRows } from "@/db";
import * as schema from "@/db/schema";
import { media } from "@/db/schema";
import type { EntityRef, Geo } from "@/lib/types";

// Seed helpers (BUILD_PLAN §10.1): placeholder media + the demo-reset table wipe.

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? Number.parseInt(m[1] as string, 16) : 0x8e8e93;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** A small RGB PNG: solid color with diagonal stripes; the label is stored in a tEXt chunk. */
export function placeholderPng(
  width: number,
  height: number,
  color: string,
  label: string,
): Uint8Array {
  const [r, g, b] = hexToRgb(color);
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  const band = Math.max(8, Math.floor(width / 20));
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const k = Math.floor((x + y) / band) % 2 === 0 ? 1 : 0.86;
      const o = y * row + 1 + x * 3;
      raw[o] = Math.round(r * k);
      raw[o + 1] = Math.round(g * k);
      raw[o + 2] = Math.round(b * k);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk(
        "tEXt",
        Buffer.from(`Description\0${label.slice(0, 200)}`, "latin1"),
      ),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export interface PlaceholderMediaInput {
  id: string;
  kind: "photo" | "document" | "signature" | "receipt" | "avatar" | "logo";
  tag?: string | null;
  entity?: EntityRef | null;
  jobId?: string | null;
  customerId?: string | null;
  uploaderId?: string | null;
  label: string;
  color: string;
  capturedAt: Date;
  geo?: Geo | null;
  includeInInvoice?: boolean;
  evidenceLocked?: boolean;
  caption?: string | null;
}

/** The only way demo fragments create media: writes a PNG (full + thumb) and the media row. */
export async function seedPlaceholderMedia(
  db: DB,
  i: PlaceholderMediaInput,
): Promise<string> {
  const keys = mediaKeys(i.id, "image/png", i.capturedAt);
  const full = placeholderPng(480, 360, i.color, i.label);
  const thumb = placeholderPng(160, 120, i.color, i.label);
  const storage = getStorage();
  await storage.put(keys.key, full, "image/png");
  await storage.put(keys.thumbKey, thumb, "image/png");
  const sha = createHash("sha256").update(full).digest("hex");
  await db
    .insert(media)
    .values({
      id: i.id,
      kind: i.kind,
      tag: i.tag ?? null,
      storageKey: keys.key,
      thumbKey: keys.thumbKey,
      mime: "image/png",
      width: 480,
      height: 360,
      bytes: full.byteLength,
      sha256Original: sha,
      sha256Stored: sha,
      caption: i.caption ?? null,
      jobId: i.jobId ?? null,
      customerId: i.customerId ?? null,
      entityType: i.entity?.type ?? null,
      entityId: i.entity?.id ?? null,
      uploaderId: i.uploaderId ?? null,
      clientCapturedAt: i.capturedAt,
      fileLastModified: i.capturedAt,
      serverReceivedAt: new Date(i.capturedAt.getTime() + 60_000),
      lat: i.geo?.lat ?? null,
      lng: i.geo?.lng ?? null,
      accuracyM: i.geo?.accuracyM ?? null,
      flags: i.geo ? [] : ["no_geo"],
      includeInInvoice: i.includeInInvoice ?? false,
      evidenceLocked: i.evidenceLocked ?? false,
      createdAt: i.capturedAt,
    })
    .onConflictDoNothing();
  return i.id;
}

// ------------------------------------------------------------------ reset

/** Every app table name from the Drizzle schema (the migrations bookkeeping table is not included). */
export function domainTableNames(): string[] {
  return Object.values(schema as Record<string, unknown>)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => getTableName(t));
}

/**
 * Empty every domain table (BUILD_PLAN §10.1 `--reset`, §11.2 B1 "reset demo data").
 * Append-only row triggers don't fire on TRUNCATE. Run the base seed again afterwards.
 */
export async function truncateDomainTables(db: DB): Promise<number> {
  const names = domainTableNames();
  if (names.length === 0) return 0;
  const statement = [
    "truncate",
    "table",
    names.map((n) => `"${n}"`).join(", "),
    "restart identity cascade",
  ].join(" ");
  await execRows(sql.raw(statement), db);
  return names.length;
}
