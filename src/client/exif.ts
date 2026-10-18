// Tiny JPEG EXIF reader (~1 KB, no deps): capture time, orientation and GPS.
// Only what the evidence trail needs (SPEC §M11). Returns null for non-JPEG
// input or when no EXIF block exists. Never throws.

export interface ExifInfo {
  /** "2026-10-14T15:32:01" (+ "−05:00" when OffsetTimeOriginal exists). */
  takenAt: string | null;
  /** 1–8 (1 = upright). Browsers already apply it in createImageBitmap. */
  orientation: number | null;
  lat: number | null;
  lng: number | null;
}

const TAG_ORIENTATION = 0x0112;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DT_ORIGINAL = 0x9003;
const TAG_OFFSET_ORIGINAL = 0x9011;

type Entry = { type: number; count: number; at: number };

export function parseExif(buf: ArrayBuffer): ExifInfo | null {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      const size = v.getUint16(off + 2);
      if (
        marker === 0xffe1 &&
        off + 10 <= v.byteLength &&
        v.getUint32(off + 4) === 0x45786966 && // "Exif"
        v.getUint16(off + 8) === 0
      ) {
        return parseTiff(v, off + 10);
      }
      off += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiff(v: DataView, tiff: number): ExifInfo | null {
  const order = v.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  if (u16(tiff + 2) !== 42) return null;

  const readIfd = (start: number): Map<number, Entry> => {
    const map = new Map<number, Entry>();
    const n = u16(start);
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size =
        (
          { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<
            number,
            number
          >
        )[type] ?? 1;
      const at = size * count <= 4 ? e + 8 : tiff + u32(e + 8);
      map.set(u16(e), { type, count, at });
    }
    return map;
  };
  const ascii = (e?: Entry) => {
    if (!e || e.type !== 2) return null;
    let s = "";
    for (let i = 0; i < e.count; i++) {
      const c = v.getUint8(e.at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim() || null;
  };
  const num = (e?: Entry) =>
    !e ? null : e.type === 3 ? u16(e.at) : e.type === 4 ? u32(e.at) : null;
  const rationals = (e?: Entry) => {
    if (!e || e.type !== 5) return null;
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      const d = u32(e.at + i * 8 + 4);
      out.push(d ? u32(e.at + i * 8) / d : 0);
    }
    return out;
  };

  const ifd0 = readIfd(tiff + u32(tiff + 4));
  const exifPtr = num(ifd0.get(TAG_EXIF_IFD));
  const gpsPtr = num(ifd0.get(TAG_GPS_IFD));
  const exif = exifPtr ? readIfd(tiff + exifPtr) : null;
  const gps = gpsPtr ? readIfd(tiff + gpsPtr) : null;

  let takenAt: string | null = null;
  const raw =
    ascii(exif?.get(TAG_DT_ORIGINAL)) ?? ascii(ifd0.get(TAG_DATETIME));
  const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    const tz = ascii(exif?.get(TAG_OFFSET_ORIGINAL));
    if (tz && /^[+-]\d{2}:\d{2}$/.test(tz)) takenAt += tz;
  }

  let lat: number | null = null;
  let lng: number | null = null;
  if (gps) {
    const la = rationals(gps.get(2));
    const lo = rationals(gps.get(4));
    const dms = (a: number[]) =>
      (a[0] ?? 0) + (a[1] ?? 0) / 60 + (a[2] ?? 0) / 3600;
    if (la && lo && la.length >= 1 && lo.length >= 1) {
      lat = dms(la) * (ascii(gps.get(1)) === "S" ? -1 : 1);
      lng = dms(lo) * (ascii(gps.get(3)) === "W" ? -1 : 1);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        (lat === 0 && lng === 0)
      ) {
        lat = null;
        lng = null;
      }
    }
  }

  return { takenAt, orientation: num(ifd0.get(TAG_ORIENTATION)), lat, lng };
}

/** Read EXIF from the first 256 KB of a file. */
export async function readExif(blob: Blob): Promise<ExifInfo | null> {
  try {
    return parseExif(await blob.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}
