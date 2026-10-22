// Geometry for the SignaturePad (pure; tested in tests/ui/signature-math.test.ts):
// keeping strokes when the pad changes size (rotation, full screen) and
// trimming the exported PNG to the ink.

/** A stroke point in CSS px, with the line width there. */
export type Pt = { x: number; y: number; w: number };
export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** Uniform scale `s`, then offset (`ox`, `oy`). */
export type Fit = { s: number; ox: number; oy: number };

const IDENTITY: Fit = { s: 1, ox: 0, oy: 0 };

/** Scale + centering that fits the box `from` inside `to` (aspect kept). */
export function fitBox(from: Size, to: Size): Fit {
  if (from.w <= 0 || from.h <= 0 || to.w <= 0 || to.h <= 0) return IDENTITY;
  if (from.w === to.w && from.h === to.h) return IDENTITY;
  const s = Math.min(to.w / from.w, to.h / from.h);
  return { s, ox: (to.w - from.w * s) / 2, oy: (to.h - from.h * s) / 2 };
}

/** Strokes drawn in a `from` box, moved into a `to` box (scaled and centered, widths too). */
export function refit(
  strokes: readonly (readonly Pt[])[],
  from: Size,
  to: Size,
): Pt[][] {
  const f = fitBox(from, to);
  return strokes.map((s) =>
    s.map((p) => ({ x: f.ox + p.x * f.s, y: f.oy + p.y * f.s, w: p.w * f.s })),
  );
}

/** Bounding box of the ink (each point grown by half its line width), or null. */
export function inkBounds(strokes: readonly (readonly Pt[])[]): Rect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const s of strokes)
    for (const p of s) {
      const r = p.w / 2;
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The area to export around the ink: padded by `pad`, never smaller than
 * `min` (a dot still gets a readable image), clamped to the pad's `size`.
 */
export function trimRect(ink: Rect, pad: number, size: Size, min = 24): Rect {
  const w = Math.max(ink.w + pad * 2, min);
  const h = Math.max(ink.h + pad * 2, min);
  const cx = ink.x + ink.w / 2;
  const cy = ink.y + ink.h / 2;
  const x = Math.max(0, cx - w / 2);
  const y = Math.max(0, cy - h / 2);
  return {
    x,
    y,
    w: Math.max(1, Math.min(size.w, cx + w / 2) - x),
    h: Math.max(1, Math.min(size.h, cy + h / 2) - y),
  };
}
