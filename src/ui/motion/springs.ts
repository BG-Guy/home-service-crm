// Motion tokens — SPEC §12.2. Apple WWDC23 spring conversion (mass 1):
//   duration d (s) + bounce b  →  stiffness (2π/d)², damping (1−b)·4π/d.
// Isomorphic (no DOM access at import time).

export interface IosSpring {
  type: "spring";
  mass: number;
  stiffness: number;
  damping: number;
}

export const ios = (d: number, b = 0): IosSpring => ({
  type: "spring" as const,
  mass: 1,
  stiffness: ((2 * Math.PI) / d) ** 2,
  damping: ((1 - b) * 4 * Math.PI) / d,
});

/** Named springs. Pass to Motion (`transition={spring.snappy}`) or to `springTo()`. */
export const spring = {
  press: ios(0.25), // buttons, rows
  snappy: ios(0.4, 0.15), // toggles, segmented thumb, tab indicator
  smooth: ios(0.5), // page push, list reorder
  sheet: ios(0.45, 0.05), // sheet detents
  bouncy: ios(0.5, 0.3), // success check, FAB appear (max bounce 0.3)
} as const;

/**
 * The same curves as CSS `linear()` easings (mirrors `--ease-spring*` in globals.css),
 * for WAAPI (`el.animate(..., { easing })`), which can't read CSS variables.
 */
export const EASE = {
  spring:
    "linear(0,.003 1%,.019 2.5%,.08 5.5%,.163 8.5%,.45 18%,.543 21.5%,.625 25%,.695 28.5%,.753 32%,.802 35.5%,.847 39.5%,.886 44%,.919 49%,.944 54.5%,.965 61%,.988 75.5%,1)",
  snappy:
    "linear(0,.007 1.5%,.026 3%,.054 4.5%,.102 6.5%,.19 9.5%,.511 19.5%,.609 23%,.683 26%,.747 29%,.809 32.5%,.86 36%,.901 39.5%,.936 43.5%,.963 48%,.984 53%,.997 58.5%,1.006 72%,1)",
  bouncy:
    "linear(0,.009 1.5%,.033 3%,.07 4.5%,.116 6%,.227 9%,.476 15%,.594 18%,.699 21%,.776 23.5%,.841 26%,.905 29%,.955 32%,.992 35%,1.031 40.5%,1.046 47.5%,1.004 77%,1)",
} as const;

/** Durations in ms (mirror `--dur-*`). */
export const DUR = { press: 340, snappy: 515, push: 675, bouncy: 730 } as const;

/** UIScrollView "normal" deceleration rate, used for release projection. */
export const DECELERATION_RATE = 0.998;

/**
 * Where a flick would come to rest: `offset + (v/1000)·r/(1−r)` (SPEC §12.2).
 * @param velocity px/s
 */
export function project(
  offset: number,
  velocity: number,
  rate = DECELERATION_RATE,
): number {
  return offset + ((velocity / 1000) * rate) / (1 - rate);
}

/** iOS rubber-band: distance past an edge → displayed offset. */
export function rubberBand(overshoot: number, dimension: number, c = 0.55) {
  if (dimension <= 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const x = Math.abs(overshoot);
  return sign * (1 - 1 / ((x * c) / dimension + 1)) * dimension;
}

/** True when the user asked for reduced motion (false on the server). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
