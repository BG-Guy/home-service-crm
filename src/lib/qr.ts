// Tiny QR Code encoder (ISO/IEC 18004) for the invoice "Pay" QR (SPEC M08: a ~2 KB
// hand-rolled encoder, no dependency). Byte mode, versions 1–10 (≤ 213 bytes at
// level M — plenty for a pay link), automatic version and mask selection.
// Rendered server-side as an SVG string, so no QR code ships to the browser.
// Algorithm after Project Nayuki's reference implementation (MIT).
// Golden-tested in tests/golden/qr.test.ts. Shared: invoice pay QR (B3), tool labels (B7), collect sheet (B4).

export type QrEcl = "L" | "M" | "Q" | "H";

const MAX_VERSION = 10;
// Index = version (0 unused). ECC codewords per block / number of blocks.
const ECC_PER_BLOCK: Record<QrEcl, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const NUM_BLOCKS: Record<QrEcl, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};
const ECL_BITS: Record<QrEcl, number> = { L: 1, M: 0, Q: 3, H: 2 };

export interface QrCode {
  version: number;
  ecl: QrEcl;
  mask: number;
  size: number;
  /** modules[y][x] — true = dark. */
  modules: boolean[][];
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** Raw data modules available in a version (data + ECC bits). */
export function numRawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** Data codewords (bytes) a version/level can hold, ECC excluded. */
export function numDataCodewords(ver: number, ecl: QrEcl): number {
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    (ECC_PER_BLOCK[ecl][ver] as number) * (NUM_BLOCKS[ecl][ver] as number)
  );
}

// ------------------------------------------------------------------ Reed–Solomon (GF(256), 0x11D)

export function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const r: number[] = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j] as number, root);
      if (j + 1 < r.length) r[j] = (r[j] as number) ^ (r[j + 1] as number);
    }
    root = gfMul(root, 2);
  }
  return r;
}

export function rsRemainder(data: readonly number[], div: number[]): number[] {
  const r: number[] = div.map(() => 0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    for (let i = 0; i < div.length; i++)
      r[i] = (r[i] as number) ^ gfMul(div[i] as number, f);
  }
  return r;
}

// ------------------------------------------------------------------ data → codewords

function encodeData(bytes: Uint8Array, ver: number, ecl: QrEcl): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(4, 4); // byte mode
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = numDataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] as number);
    out.push(v);
  }
  return out;
}

/** Split into blocks, append ECC, interleave (§7.6). */
export function addEccAndInterleave(
  data: readonly number[],
  ver: number,
  ecl: QrEcl,
): number[] {
  const numBlocks = NUM_BLOCKS[ecl][ver] as number;
  const eccLen = ECC_PER_BLOCK[ecl][ver] as number;
  const raw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < (blocks[0] as number[]).length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(b[i] as number);
    });
  return out;
}

// ------------------------------------------------------------------ matrix

class Matrix {
  readonly m: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly size: number) {
    this.m = Array.from({ length: size }, () => new Array(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array(size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    (this.m[y] as boolean[])[x] = dark;
    (this.fn[y] as boolean[])[x] = true;
  }
}

export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = ver * 4 + 17 - 7; r.length < n; pos -= step)
    r.splice(1, 0, pos);
  return r;
}

/** 15-bit format word (ECC level + mask, BCH, XOR 0x5412). */
export function formatBits(ecl: QrEcl, mask: number): number {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version word (versions ≥ 7). */
export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

function drawFormat(mx: Matrix, ecl: QrEcl, mask: number) {
  const b = formatBits(ecl, mask);
  const s = mx.size;
  for (let i = 0; i <= 5; i++) mx.set(8, i, bit(b, i));
  mx.set(8, 7, bit(b, 6));
  mx.set(8, 8, bit(b, 7));
  mx.set(7, 8, bit(b, 8));
  for (let i = 9; i < 15; i++) mx.set(14 - i, 8, bit(b, i));
  for (let i = 0; i < 8; i++) mx.set(s - 1 - i, 8, bit(b, i));
  for (let i = 8; i < 15; i++) mx.set(8, s - 15 + i, bit(b, i));
  mx.set(8, s - 8, true); // dark module
}

function drawFunctionPatterns(mx: Matrix, ver: number) {
  const s = mx.size;
  for (let i = 0; i < s; i++) {
    mx.set(6, i, i % 2 === 0);
    mx.set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < s && y >= 0 && y < s)
          mx.set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(s - 4, 3);
  finder(3, s - 4);
  const al = alignmentPositions(ver);
  const n = al.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === n - 1) ||
        (i === n - 1 && j === 0)
      )
        continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          mx.set(
            (al[i] as number) + dx,
            (al[j] as number) + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }
  drawFormat(mx, "M", 0); // placeholder, overwritten after masking
  if (ver >= 7) {
    const b = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const a = s - 11 + (i % 3);
      const c = Math.floor(i / 3);
      mx.set(a, c, bit(b, i));
      mx.set(c, a, bit(b, i));
    }
  }
}

/** Zigzag module order for codeword bits (shared with tests' decoder). */
export function dataModuleOrder(
  size: number,
  isFunction: boolean[][],
): [number, number][] {
  const out: [number, number][] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!(isFunction[y] as boolean[])[x]) out.push([x, y]);
      }
  }
  return out;
}

export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function penalty(m: boolean[][]): number {
  const s = m.length;
  let score = 0;
  const at = (x: number, y: number) => (m[y] as boolean[])[x] as boolean;
  // N1 runs ≥ 5 and N3 finder-like 1:1:3:1:1 with 4 light modules, rows and columns.
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= s; i++) {
      const p = [1, 0, 1, 1, 1, 0, 1].map((v, k) => get(i + k) === (v === 1));
      if (!p.every(Boolean)) continue;
      const lightAfter = [7, 8, 9, 10].every((k) => !get(i + k));
      const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
      if (lightAfter || lightBefore) score += 40;
    }
  };
  for (let y = 0; y < s; y++) line((x) => at(x, y));
  for (let x = 0; x < s; x++) line((y) => at(x, y));
  // N2 2×2 blocks.
  for (let y = 0; y < s - 1; y++)
    for (let x = 0; x < s - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1))
        score += 3;
    }
  // N4 dark balance.
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = s * s;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * 10;
}

/** Encode text (UTF-8, byte mode). Throws when it doesn't fit version 10. */
export function encodeQr(text: string, ecl: QrEcl = "M"): QrCode {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (need <= numDataCodewords(ver, ecl) * 8) break;
  }
  if (ver > MAX_VERSION) throw new RangeError("QR payload too long");
  const codewords = addEccAndInterleave(encodeData(bytes, ver, ecl), ver, ecl);
  const size = ver * 4 + 17;
  const base = new Matrix(size);
  drawFunctionPatterns(base, ver);
  const order = dataModuleOrder(size, base.fn);
  order.forEach(([x, y], i) => {
    (base.m[y] as boolean[])[x] =
      i < codewords.length * 8 &&
      bit(codewords[i >>> 3] as number, 7 - (i & 7));
  });
  let best: { mask: number; m: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const mx = new Matrix(size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fn = (base.fn[y] as boolean[])[x] as boolean;
        const v = (base.m[y] as boolean[])[x] as boolean;
        (mx.m[y] as boolean[])[x] = fn ? v : v !== maskBit(mask, x, y);
        (mx.fn[y] as boolean[])[x] = fn;
      }
    drawFormat(mx, ecl, mask);
    const score = penalty(mx.m);
    if (!best || score < best.score) best = { mask, m: mx.m, score };
  }
  const chosen = best as { mask: number; m: boolean[][] };
  return { version: ver, ecl, mask: chosen.mask, size, modules: chosen.m };
}

/** SVG markup for a QR code (4-module quiet zone, `currentColor` on white). */
export function qrSvg(
  text: string,
  opts: { ecl?: QrEcl; title?: string; className?: string } = {},
): string {
  const qr = encodeQr(text, opts.ecl ?? "M");
  const n = qr.size + 8;
  let d = "";
  qr.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    });
  });
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"${
    opts.className ? ` class="${esc(opts.className)}"` : ""
  } aria-label="${esc(opts.title ?? "QR code")}"><rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
