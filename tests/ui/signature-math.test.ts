import { describe, expect, it } from "vitest";
import {
  fitBox,
  inkBounds,
  refit,
  trimRect,
} from "@/ui/components/signature-math";

describe("signature pad geometry", () => {
  it("fitBox scales uniformly and centers (portrait pad → landscape screen)", () => {
    expect(fitBox({ w: 390, h: 600 }, { w: 844, h: 300 })).toEqual({
      s: 0.5,
      ox: (844 - 195) / 2,
      oy: 0,
    });
    expect(fitBox({ w: 100, h: 50 }, { w: 100, h: 50 })).toEqual({
      s: 1,
      ox: 0,
      oy: 0,
    });
    // Degenerate boxes never divide by zero.
    expect(fitBox({ w: 0, h: 0 }, { w: 100, h: 50 })).toEqual({
      s: 1,
      ox: 0,
      oy: 0,
    });
  });

  it("refit keeps strokes when the pad changes size (line widths scale too)", () => {
    const strokes = [
      [
        { x: 0, y: 0, w: 2 },
        { x: 390, y: 600, w: 4 },
      ],
    ];
    const out = refit(strokes, { w: 390, h: 600 }, { w: 844, h: 300 });
    expect(out).toEqual([
      [
        { x: 324.5, y: 0, w: 1 },
        { x: 519.5, y: 300, w: 2 },
      ],
    ]);
    // The input is not mutated.
    expect(strokes[0]?.[1]).toEqual({ x: 390, y: 600, w: 4 });
  });

  it("inkBounds covers every point grown by half its width", () => {
    expect(inkBounds([])).toBeNull();
    expect(inkBounds([[]])).toBeNull();
    expect(
      inkBounds([
        [
          { x: 10, y: 20, w: 2 },
          { x: 50, y: 25, w: 4 },
        ],
        [{ x: 30, y: 60, w: 2 }],
      ]),
    ).toEqual({ x: 9, y: 19, w: 43, h: 42 });
  });

  it("trimRect pads the ink, keeps a minimum size and stays on the pad", () => {
    const size = { w: 800, h: 300 };
    expect(trimRect({ x: 100, y: 100, w: 200, h: 50 }, 12, size)).toEqual({
      x: 88,
      y: 88,
      w: 224,
      h: 74,
    });
    // A single dot still exports a readable image.
    const dot = trimRect({ x: 400, y: 150, w: 2, h: 2 }, 0, size, 24);
    expect(dot.w).toBe(24);
    expect(dot.h).toBe(24);
    // Ink at the edge is clamped to the pad.
    expect(trimRect({ x: 0, y: 290, w: 50, h: 10 }, 12, size)).toEqual({
      x: 0,
      y: 278,
      w: 62,
      h: 22,
    });
  });
});
