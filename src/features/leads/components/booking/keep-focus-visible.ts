import { type RefObject, useEffect } from "react";

// The field you're typing in never hides under the sticky chrome (booking bar,
// tab bar, nav bar): on focus, and while the on-screen keyboard resizes the
// visual viewport, scroll just enough to keep it clear. Bars hidden behind the
// keyboard (below the visual viewport) don't count.

const FIELD = "input:not([type=checkbox]):not([type=radio]), textarea, select";
const MARGIN = 12;

export function useKeepFocusVisible(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const vv = window.visualViewport;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || !root.contains(el)) return;
        if (!el.matches(FIELD)) return;
        const viewTop = vv ? vv.offsetTop : 0;
        const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        let bottom = viewBottom;
        for (const bar of document.querySelectorAll<HTMLElement>(
          ".bottom-bar, .tabbar-capsule",
        )) {
          if (bar.contains(el)) continue;
          const r = bar.getBoundingClientRect();
          if (r.height > 0 && r.top < bottom && r.bottom > viewTop + 80)
            bottom = Math.min(bottom, r.top);
        }
        let top = viewTop;
        for (const bar of document.querySelectorAll<HTMLElement>(
          ".nav-bar, .lt-bar",
        )) {
          const r = bar.getBoundingClientRect();
          if (r.height > 0 && r.bottom > top && r.top < viewBottom)
            top = Math.max(top, r.bottom);
        }
        // Keep the field's label in view too (it sits just above the box).
        const r = el.getBoundingClientRect();
        const want = { top: r.top - 28, bottom: r.bottom };
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches;
        const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
        if (want.bottom > bottom - MARGIN)
          window.scrollBy({ top: want.bottom - (bottom - MARGIN), behavior });
        else if (want.top < top + MARGIN)
          window.scrollBy({ top: want.top - (top + MARGIN), behavior });
      });
    };
    root.addEventListener("focusin", check);
    vv?.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("focusin", check);
      vv?.removeEventListener("resize", check);
    };
  }, [ref]);
}
