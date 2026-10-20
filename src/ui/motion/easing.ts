// Generator for the CSS `linear()` spring easings (`--ease-spring*` in globals.css and
// `EASE` in springs.ts). It samples the same closed-form spring the JS driver runs
// (`solveSpring`), so CSS transitions and gesture releases share one curve.
//
// A curve is duration-free: the CSS animation lasts `SETTLE` × the spring's Apple
// duration, by which time the spring is ≥ 99.5 % settled. Regenerate after changing
// SETTLE or a bounce (tests/ui/motion-tokens.test.ts fails while they disagree):
//   springLinear(0)    → --ease-spring         (critically damped: pages, sheets)
//   springLinear(0.15) → --ease-spring-snappy  (popovers, chips, indicators)
//   springLinear(0.3)  → --ease-spring-bouncy  (pops, toasts, badges)
// Pure; not imported by components (only tests, docs and the token check).

import { solveSpring } from "./spring-driver";
import { ios, SETTLE } from "./springs";

type Point = [t: number, x: number];

/** Ramer–Douglas–Peucker: drop samples a straight segment already covers. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [t0, x0] = points[0] as Point;
  const [t1, x1] = points[points.length - 1] as Point;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [t, x] = points[i] as Point;
    const lerp = x0 + ((x1 - x0) * (t - t0)) / (t1 - t0);
    const d = Math.abs(x - lerp);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [points[0] as Point, points.at(-1) as Point];
  const left = simplify(points.slice(0, at + 1), tolerance);
  const right = simplify(points.slice(at), tolerance);
  return [...left.slice(0, -1), ...right];
}

const fmt = (n: number, digits: number) => Number(n.toFixed(digits)).toString();

/**
 * The CSS `linear()` easing of a spring with `bounce` (Apple semantics, 0 = no
 * overshoot), over `SETTLE` × its duration. `tolerance` is the max deviation from
 * the true curve (in progress units).
 */
export function springLinear(bounce: number, tolerance = 0.002): string {
  const s = ios(1, bounce);
  const solve = solveSpring(0, 1, 0, s);
  const N = 480;
  const dense: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const tau = i / N;
    dense.push([tau, i === N ? 1 : solve(tau * SETTLE).x]);
  }
  const stops = simplify(dense, tolerance);
  return `linear(${stops
    .map(([t, x], i) =>
      i === 0 || i === stops.length - 1
        ? fmt(x, 3)
        : `${fmt(x, 3)} ${fmt(t * 100, 1)}%`,
    )
    .join(", ")})`;
}
