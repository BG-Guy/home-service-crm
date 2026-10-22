// Map marker decluttering (pure, screen pixels). Shared by the schedule map's
// window boxes (jobs/schedule-map MapCanvas) and the live map's job pins and name
// tags (map/components/TechMap). Tests: tests/jobs/schedule-map.test.ts,
// tests/lib/declutter.test.ts.

export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const rectsHit = (a: Rect, b: Rect) =>
  a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/** The square of side `d` centered on (x, y): a dot, an avatar, a home pin. */
export const square = (x: number, y: number, d: number): Rect => ({
  l: x - d / 2,
  r: x + d / 2,
  t: y - d / 2,
  b: y + d / 2,
});

export interface PlaceItem {
  id: string;
  /** Anchor point in screen pixels (the job's location). */
  x: number;
  y: number;
  /** Size of the expanded box (measured once it is drawn; `h` defaults to boxH). */
  w: number;
  h?: number;
  /** Lower first. */
  priority: number;
}

export interface PlaceOptions {
  /** Box height and the tail between the box and the point. */
  boxH: number;
  tail: number;
  /** Diameter of the collapsed dot (including its ring). */
  dot: number;
  /** Clear space kept around every box (px). */
  gap?: number;
  /** Other things a box must not cover (home pins): centers and diameter. */
  obstacles?: readonly { x: number; y: number; d: number }[];
  /** Other things a box must not cover, as rectangles (avatars, name tags). */
  rects?: readonly Rect[];
  /** The visible map (0,0 → w,h): a box that would be cut by its edge stays a dot. */
  bounds?: { w: number; h: number };
  /** Below the zoom threshold: only `force` ids expand. */
  dotsOnly?: boolean;
  /** Always expanded (selected). */
  force?: ReadonlySet<string>;
}

/**
 * Which markers show as full boxes above their point (the rest collapse to dots).
 * Greedy by priority: a box expands when it (plus `gap`) stays inside `bounds`,
 * overlaps no box already placed and covers no other marker's dot or obstacle.
 * Forced ids expand first.
 */
export function declutter(
  items: readonly PlaceItem[],
  o: PlaceOptions,
): Set<string> {
  const force = o.force ?? new Set<string>();
  const g = (o.gap ?? 0) / 2;
  const box = (i: PlaceItem): Rect => ({
    l: i.x - i.w / 2 - g,
    r: i.x + i.w / 2 + g,
    t: i.y - o.tail - (i.h ?? o.boxH) - g,
    b: i.y - o.tail + g,
  });
  const dots = items.map((i) => ({ id: i.id, r: square(i.x, i.y, o.dot) }));
  const blocks = [
    ...(o.obstacles ?? []).map((b) => square(b.x, b.y, b.d)),
    ...(o.rects ?? []),
  ];
  const order = [...items].sort(
    (a, b) =>
      Number(force.has(b.id)) - Number(force.has(a.id)) ||
      a.priority - b.priority,
  );
  const placed: Rect[] = [];
  const out = new Set<string>();
  for (const i of order) {
    const forced = force.has(i.id);
    if (o.dotsOnly && !forced) continue;
    const r = box(i);
    const cut =
      !!o.bounds &&
      (r.l < 0 || r.t < 0 || r.r > o.bounds.w || r.b > o.bounds.h);
    if (
      !forced &&
      (cut ||
        placed.some((p) => rectsHit(p, r)) ||
        dots.some((d) => d.id !== i.id && rectsHit(d.r, r)) ||
        blocks.some((b) => rectsHit(b, r)))
    )
      continue;
    placed.push(r);
    out.add(i.id);
  }
  return out;
}

export type LabelSide = "below" | "right" | "left" | "above";
const SIDES: readonly LabelSide[] = ["below", "right", "left", "above"];

export interface LabelItem {
  id: string;
  /** The marker's center and radius (px). */
  x: number;
  y: number;
  r: number;
  /** The label's size (px). */
  w: number;
  h: number;
}

/** The rectangle a label of `i` takes on `side`, `gap` px off the marker. */
export function labelRect(i: LabelItem, side: LabelSide, gap: number): Rect {
  switch (side) {
    case "below":
      return {
        l: i.x - i.w / 2,
        r: i.x + i.w / 2,
        t: i.y + i.r + gap,
        b: i.y + i.r + gap + i.h,
      };
    case "above":
      return {
        l: i.x - i.w / 2,
        r: i.x + i.w / 2,
        t: i.y - i.r - gap - i.h,
        b: i.y - i.r - gap,
      };
    case "right":
      return {
        l: i.x + i.r + gap,
        r: i.x + i.r + gap + i.w,
        t: i.y - i.h / 2,
        b: i.y + i.h / 2,
      };
    case "left":
      return {
        l: i.x - i.r - gap - i.w,
        r: i.x - i.r - gap,
        t: i.y - i.h / 2,
        b: i.y + i.h / 2,
      };
  }
}

/**
 * Where each marker's label goes (a tech's name tag): the first side — below,
 * right, left, above — that stays inside `bounds` and covers no `avoid` rect and
 * no label placed before it; `null` (hidden) when no side fits. Greedy, in input
 * order (put the selected marker first).
 */
export function placeLabels(
  items: readonly LabelItem[],
  o: {
    gap: number;
    avoid?: readonly Rect[];
    bounds?: { w: number; h: number };
  },
): Map<string, LabelSide | null> {
  const placed: Rect[] = [];
  const out = new Map<string, LabelSide | null>();
  for (const i of items) {
    let side: LabelSide | null = null;
    for (const s of SIDES) {
      const r = labelRect(i, s, o.gap);
      const cut =
        !!o.bounds &&
        (r.l < 0 || r.t < 0 || r.r > o.bounds.w || r.b > o.bounds.h);
      if (
        cut ||
        placed.some((p) => rectsHit(p, r)) ||
        (o.avoid ?? []).some((a) => rectsHit(a, r))
      )
        continue;
      side = s;
      placed.push(r);
      break;
    }
    out.set(i.id, side);
  }
  return out;
}
