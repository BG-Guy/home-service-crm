// A tiny analytic spring (damped harmonic oscillator) for gesture releases.
// It carries the finger's velocity into the animation, which CSS `linear()`
// curves cannot. ~0.5 KB, so sheets, swipe rows and pull-to-refresh don't need
// Motion's `domMax` bundle (SPEC §14: lightweight first).

import { type IosSpring, spring as springs } from "./springs";

export interface SpringState {
  /** Position at time t. */
  x: number;
  /** Velocity at time t (units/s). */
  v: number;
}

/**
 * Closed-form solution of `m·x'' + c·x' + k·x = 0` from `from` toward `to`
 * with initial velocity `velocity` (units/s). Returns `(tSeconds) => state`.
 */
export function solveSpring(
  from: number,
  to: number,
  velocity: number,
  s: IosSpring = springs.smooth,
): (t: number) => SpringState {
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  const A = from - to;
  const v0 = velocity;

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = zeta * w0;
    const B = (v0 + a * A) / wd;
    return (t) => {
      const e = Math.exp(-a * t);
      const cos = Math.cos(wd * t);
      const sin = Math.sin(wd * t);
      return {
        x: to + e * (A * cos + B * sin),
        v: e * ((-a * A + wd * B) * cos + (-a * B - wd * A) * sin),
      };
    };
  }
  if (zeta === 1) {
    const C = v0 + w0 * A;
    return (t) => {
      const e = Math.exp(-w0 * t);
      return { x: to + (A + C * t) * e, v: e * (C - w0 * (A + C * t)) };
    };
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - root);
  const r2 = -w0 * (zeta + root);
  const C2 = (v0 - r1 * A) / (r2 - r1);
  const C1 = A - C2;
  return (t) => {
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    return { x: to + C1 * e1 + C2 * e2, v: C1 * r1 * e1 + C2 * r2 * e2 };
  };
}

export interface SpringToOptions {
  from: number;
  to: number;
  /** Initial velocity in units/s (e.g. px/s from a pointer gesture). */
  velocity?: number;
  spring?: IosSpring;
  onUpdate: (value: number) => void;
  /** Settle thresholds. */
  restDelta?: number;
  restSpeed?: number;
}

export interface SpringAnimation {
  stop(): void;
  /** Resolves `true` when it settled, `false` when stopped early. */
  finished: Promise<boolean>;
}

/** Animate a number with a spring on requestAnimationFrame. */
export function springTo({
  from,
  to,
  velocity = 0,
  spring = springs.smooth,
  onUpdate,
  restDelta = 0.5,
  restSpeed = 10,
}: SpringToOptions): SpringAnimation {
  const solve = solveSpring(from, to, velocity, spring);
  let raf = 0;
  let done = false;
  let resolve: (v: boolean) => void = () => {};
  const finished = new Promise<boolean>((r) => {
    resolve = r;
  });
  let start = -1;
  const step = (now: number) => {
    if (done) return;
    if (start < 0) start = now;
    const t = (now - start) / 1000;
    const { x, v } = solve(t);
    if ((Math.abs(x - to) < restDelta && Math.abs(v) < restSpeed) || t > 4) {
      done = true;
      onUpdate(to);
      resolve(true);
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  if (typeof requestAnimationFrame === "undefined") {
    onUpdate(to);
    done = true;
    resolve(true);
  } else {
    raf = requestAnimationFrame(step);
  }
  return {
    stop() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      resolve(false);
    },
    finished,
  };
}

/** Tracks pointer samples and reports release velocity (units/s) over the last ~100 ms. */
export function createVelocityTracker(windowMs = 100) {
  let samples: Array<{ t: number; v: number }> = [];
  return {
    reset() {
      samples = [];
    },
    add(value: number, t = performance.now()) {
      samples.push({ t, v: value });
      while (samples.length > 2 && t - (samples[0]?.t ?? t) > windowMs) {
        samples.shift();
      }
    },
    velocity(): number {
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (!first || !last || last.t - first.t < 8) return 0;
      // Stale gesture (finger held still before release) → no fling.
      if (performance.now() - last.t > 80) return 0;
      return ((last.v - first.v) / (last.t - first.t)) * 1000;
    },
  };
}
