"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

const loadFeatures = () => import("./features").then((m) => m.default);

/**
 * Motion setup (SPEC §12.2) for the subtree that needs JS-driven animation:
 * - `LazyMotion` (strict) with `domAnimation` loaded asynchronously, so only `m.*`
 *   components from `motion/react-m` may be used (full `motion.*` throws in dev).
 * - `MotionConfig reducedMotion="user"`.
 *
 * NOT mounted globally (budget, docs/budget.md): CSS springs cover most UI. A
 * component that renders `m.*` wraps its own subtree, ideally inside a lazily loaded
 * chunk (e.g. a sheet body), so Motion never lands in the shell's initial JS:
 *   <MotionProvider><m.div drag="y" … /></MotionProvider>
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
