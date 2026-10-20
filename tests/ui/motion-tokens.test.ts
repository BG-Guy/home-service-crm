import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { springLinear } from "@/ui/motion/easing";
import { solveSpring } from "@/ui/motion/spring-driver";
import { DUR, EASE, forDuration, SETTLE, spring } from "@/ui/motion/springs";

// The CSS motion tokens (globals.css), the WAAPI mirrors (springs.ts) and the JS
// spring driver must describe the same springs (docs/DESIGN.md §3).

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n"));

function token(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(root);
  if (!m?.[1]) throw new Error(`${name} missing from :root`);
  return m[1];
}

/** `linear(0, 0.45 20%, 1)` and `linear(0,.45 20%,1)` compare equal. */
const norm = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/(^|[(, ])0\./g, "$1.")
    .replace(/\(\s+/, "(")
    .replace(/\s+\)/, ")");

describe("motion tokens", () => {
  const curves = [
    ["--ease-spring", 0, EASE.spring],
    ["--ease-spring-snappy", 0.15, EASE.snappy],
    ["--ease-spring-bouncy", 0.3, EASE.bouncy],
  ] as const;
  for (const [name, bounce, mirror] of curves) {
    it(`${name} is the generated spring (bounce ${bounce}) and matches EASE`, () => {
      const generated = norm(springLinear(bounce));
      expect(norm(token(name))).toBe(generated);
      expect(norm(mirror)).toBe(generated);
    });
  }

  it("--dur-* tokens mirror DUR", () => {
    for (const [k, ms] of Object.entries(DUR)) {
      expect(token(`--dur-${k}`)).toBe(`${ms}ms`);
    }
  });

  it("--ease-out mirrors EASE.out", () => {
    expect(norm(token("--ease-out")).replace(/ /g, "")).toBe(EASE.out);
  });

  it("a spring for a CSS duration is settled when the animation ends", () => {
    for (const ms of Object.values(DUR)) {
      const f = solveSpring(0, 1, 0, forDuration(ms));
      expect(f(ms / 1000).x).toBeGreaterThan(0.995);
      expect(f((ms / 1000) * 0.5).x).toBeLessThan(0.97);
    }
    expect(SETTLE).toBeGreaterThan(1);
  });

  it("named springs keep their character", () => {
    const peak = (s: (typeof spring)[keyof typeof spring]) => {
      const f = solveSpring(0, 1, 0, s);
      let max = 0;
      for (let t = 0; t < 1.5; t += 0.002) max = Math.max(max, f(t).x);
      return max;
    };
    expect(peak(spring.smooth)).toBeLessThanOrEqual(1.000001);
    expect(peak(spring.sheet)).toBeLessThan(1.01);
    expect(peak(spring.bouncy)).toBeGreaterThan(1.03);
  });
});
