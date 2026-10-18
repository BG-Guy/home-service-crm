// Golden tests for the hand-rolled QR encoder (SPEC M08 pay QR). Checks the
// Reed–Solomon codewords against the ISO/Thonky "HELLO WORLD" 1-M example, the
// format/version BCH words against the standard tables, and round-trips real pay
// URLs through an independent reader (format → unmask → deinterleave → RS check →
// byte-mode parse).
import { describe, expect, it } from "vitest";
import {
  alignmentPositions,
  dataModuleOrder,
  encodeQr,
  formatBits,
  maskBit,
  numDataCodewords,
  numRawDataModules,
  type QrCode,
  type QrEcl,
  qrSvg,
  rsDivisor,
  rsRemainder,
  versionBits,
} from "@/lib/qr";

describe("Reed–Solomon", () => {
  it("matches the HELLO WORLD 1-M error correction codewords", () => {
    const data = [
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });
});

describe("tables", () => {
  it("capacities", () => {
    expect(Math.floor(numRawDataModules(1) / 8)).toBe(26);
    expect(Math.floor(numRawDataModules(5) / 8)).toBe(134);
    expect(Math.floor(numRawDataModules(10) / 8)).toBe(346);
    expect(numDataCodewords(1, "M")).toBe(16);
    expect(numDataCodewords(5, "M")).toBe(86);
    expect(numDataCodewords(10, "M")).toBe(216);
  });
  it("alignment pattern centers", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(10)).toEqual([6, 28, 50]);
  });
  it("format words (ISO table)", () => {
    const s = (e: QrEcl, m: number) =>
      formatBits(e, m).toString(2).padStart(15, "0");
    expect(s("L", 0)).toBe("111011111000100");
    expect(s("M", 0)).toBe("101010000010010");
    expect(s("M", 1)).toBe("101000100100101");
    expect(s("Q", 0)).toBe("011010101011111");
    expect(s("H", 0)).toBe("001011010001001");
  });
  it("version words (ISO table)", () => {
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe(
      "000111110010010100",
    );
    expect(versionBits(10).toString(2).padStart(18, "0")).toBe(
      "001010010011010011",
    );
  });
});

// ---------------------------------------------------------------- reader

const ECC: Record<QrEcl, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const BLOCKS: Record<QrEcl, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

type Grid = boolean[][];
const g = (m: Grid, x: number, y: number): boolean => m[y]?.[x] ?? false;

function functionMask(size: number, ver: number): Grid {
  const fn: Grid = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const mark = (x: number, y: number) => {
    const row = fn[y];
    if (row && x >= 0 && x < size) row[x] = true;
  };
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  const al = alignmentPositions(ver);
  const n = al.length;
  al.forEach((ax, i) => {
    al.forEach((ay, j) => {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === n - 1) ||
        (i === n - 1 && j === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) mark(ax + dx, ay + dy);
    });
  });
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  if (ver >= 7)
    for (let i = 0; i < 18; i++) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  return fn;
}

function read(qr: QrCode): string {
  const { size, modules } = qr;
  const ver = (size - 17) / 4;
  // Format word from the first copy.
  const bits: boolean[] = [];
  for (let i = 0; i <= 5; i++) bits.push(g(modules, 8, i));
  bits.push(g(modules, 8, 7), g(modules, 8, 8), g(modules, 7, 8));
  for (let i = 9; i < 15; i++) bits.push(g(modules, 14 - i, 8));
  const fmt = bits.reduce((acc, b, i) => (b ? acc | (1 << i) : acc), 0);
  let ecl: QrEcl | null = null;
  let mask = -1;
  for (const e of ["L", "M", "Q", "H"] as const)
    for (let m = 0; m < 8; m++)
      if (formatBits(e, m) === fmt) {
        ecl = e;
        mask = m;
      }
  if (!ecl) throw new Error("bad format word");
  const fn = functionMask(size, ver);
  const order = dataModuleOrder(size, fn);
  const raw = Math.floor(numRawDataModules(ver) / 8);
  const cw: number[] = new Array<number>(raw).fill(0);
  order.slice(0, raw * 8).forEach(([x, y], i) => {
    if (g(modules, x, y) !== maskBit(mask, x, y))
      cw[i >>> 3] = (cw[i >>> 3] ?? 0) | (1 << (7 - (i & 7)));
  });
  // De-interleave.
  const nb = BLOCKS[ecl][ver] ?? 1;
  const ecLen = ECC[ecl][ver] ?? 0;
  const numShort = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const blocks: number[][] = Array.from({ length: nb }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++)
    blocks.forEach((b, j) => {
      if (i === shortLen - ecLen && j < numShort) return;
      if (k < cw.length) b.push(cw[k++] ?? 0);
    });
  const div = rsDivisor(ecLen);
  const data: number[] = [];
  for (const b of blocks) {
    const d = b.slice(0, b.length - ecLen);
    expect(rsRemainder(d, div)).toEqual(b.slice(b.length - ecLen));
    data.push(...d);
  }
  // Byte-mode parse.
  const bitAt = (i: number) => ((data[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1;
  const take = (start: number, len: number) => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | bitAt(start + i);
    return v;
  };
  expect(take(0, 4)).toBe(4);
  const lenBits = ver < 10 ? 8 : 16;
  const n = take(4, lenBits);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = take(4 + lenBits + i * 8, 8);
  return new TextDecoder().decode(bytes);
}

describe("encodeQr round trip", () => {
  const urls = [
    "https://acme.example.com/p/3Jf9Kq0x_Zt7mW2bVfR8sLp4dE6yH1nA5cU9oQ2iT0g",
    "https://crm.acmehomeservices.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?x=1",
    "HELLO WORLD",
    "x",
  ];
  for (const u of urls)
    it(`reads back ${u.slice(0, 32)}`, () => {
      const qr = encodeQr(u);
      expect(qr.size).toBe(qr.version * 4 + 17);
      expect(read(qr)).toBe(u);
    });

  it("picks the smallest version (pay link → v5 at M)", () => {
    expect(encodeQr(urls[0] as string).version).toBe(5);
    expect(encodeQr("x").version).toBe(1);
  });

  it("finder patterns are in the three corners", () => {
    const qr = encodeQr(urls[0] as string);
    const s = qr.size;
    for (const [x, y] of [
      [0, 0],
      [s - 7, 0],
      [0, s - 7],
    ] as const) {
      expect(g(qr.modules, x, y)).toBe(true);
      expect(g(qr.modules, x + 1, y + 1)).toBe(false);
      expect(g(qr.modules, x + 3, y + 3)).toBe(true);
    }
  });

  it("rejects payloads beyond version 10", () => {
    expect(() => encodeQr("x".repeat(400))).toThrow(RangeError);
  });

  it("renders a compact SVG", () => {
    const svg = qrSvg(urls[0] as string, { title: "Pay invoice" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('aria-label="Pay invoice"');
    expect(svg.length).toBeLessThan(20_000);
  });
});
