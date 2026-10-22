// Shared marker decluttering (src/lib/declutter.ts): rectangular obstacles (the
// live map's avatars and name tags) and name-tag placement. The box vs dot core is
// also covered by tests/jobs/schedule-map.test.ts.
import { describe, expect, it } from "vitest";
import {
  declutter,
  labelRect,
  placeLabels,
  rectsHit,
  square,
} from "@/lib/declutter";

describe("declutter with rect obstacles", () => {
  const base = { boxH: 26, tail: 6, dot: 16 };
  it("folds a box that would cover an avatar or a tag", () => {
    const pin = { id: "p", x: 100, y: 100, w: 40, priority: 1 };
    // Box spans x 80–120, y 68–94.
    expect(declutter([pin], base).has("p")).toBe(true);
    expect(
      declutter([pin], { ...base, rects: [square(100, 80, 20)] }).has("p"),
    ).toBe(false);
    expect(
      declutter([pin], { ...base, rects: [{ l: 118, t: 60, r: 160, b: 70 }] }),
    ).toEqual(new Set());
    // Clear of it: stays a box.
    expect(
      declutter([pin], { ...base, rects: [{ l: 121, t: 60, r: 160, b: 70 }] }),
    ).toEqual(new Set(["p"]));
  });

  it("a forced (selected) pin keeps its box anyway", () => {
    const pin = { id: "p", x: 100, y: 100, w: 40, priority: 1 };
    expect(
      declutter([pin], {
        ...base,
        rects: [square(100, 80, 20)],
        force: new Set(["p"]),
      }).has("p"),
    ).toBe(true);
  });
});

describe("placeLabels", () => {
  const tag = { w: 60, h: 20 };
  it("puts a tag below its marker, gap px off the edge", () => {
    const i = { id: "a", x: 100, y: 100, r: 20, ...tag };
    expect(placeLabels([i], { gap: 6 }).get("a")).toBe("below");
    expect(labelRect(i, "below", 6)).toEqual({ l: 70, r: 130, t: 126, b: 146 });
    expect(labelRect(i, "right", 6)).toEqual({ l: 126, r: 186, t: 90, b: 110 });
  });

  it("moves to the next free side, then hides", () => {
    const i = { id: "a", x: 100, y: 100, r: 20, ...tag };
    const pinBelow = square(100, 136, 16);
    expect(placeLabels([i], { gap: 6, avoid: [pinBelow] }).get("a")).toBe(
      "right",
    );
    const all = [pinBelow, square(156, 100, 16), square(44, 100, 16)];
    expect(placeLabels([i], { gap: 6, avoid: all }).get("a")).toBe("above");
    expect(
      placeLabels([i], { gap: 6, avoid: [...all, square(100, 64, 16)] }).get(
        "a",
      ),
    ).toBeNull();
  });

  it("keeps tags apart and inside the map", () => {
    const a = { id: "a", x: 100, y: 100, r: 20, ...tag };
    const b = { id: "b", x: 100, y: 150, r: 20, ...tag };
    const out = placeLabels([a, b], { gap: 6, bounds: { w: 400, h: 400 } });
    const ra = labelRect(a, out.get("a") ?? "below", 6);
    const rb = labelRect(b, out.get("b") ?? "below", 6);
    expect(rectsHit(ra, rb)).toBe(false);
    // At the bottom edge "below" would be cut: it goes beside the marker.
    const edge = { id: "e", x: 200, y: 390, r: 10, ...tag };
    expect(
      placeLabels([edge], { gap: 6, bounds: { w: 400, h: 400 } }).get("e"),
    ).toBe("right");
  });
});
