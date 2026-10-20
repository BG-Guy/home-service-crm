// Shared helpers for <dialog>-based overlays (Sheet, Alert, Lightbox).

let locks = 0;
let saved = "";

/** Ref-counted page scroll lock while modal overlays are open. Returns the unlock fn. */
export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const html = document.documentElement;
  if (locks++ === 0) {
    saved = html.style.overflow;
    html.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) html.style.overflow = saved;
  };
}

/**
 * Mirrors the visual viewport onto CSS variables on `el` so bottom-anchored
 * panels sit above the iOS keyboard: `--vvh` (visible height) and `--kb`
 * (keyboard overlap). Calls `onChange(keyboardOpen)` after each update.
 */
export function trackVisualViewport(
  el: HTMLElement,
  onChange?: (keyboardOpen: boolean) => void,
): () => void {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return () => {};
  let raf = 0;
  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty("--vvh", `${vv.height}px`);
      el.style.setProperty("--kb", `${kb}px`);
      onChange?.(kb > 120);
    });
  };
  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  return () => {
    cancelAnimationFrame(raf);
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
  };
}

/**
 * Where overlays use their desktop presentation (docs/DESIGN.md §4 M4d): a window
 * ≥ 768 px wide, or any fine pointer. Sheets become modals or drawers and menus
 * pop up from their trigger. The CSS twin is the same media query in globals.css.
 */
export const DESKTOP_OVERLAY_QUERY = "(min-width: 768px), (pointer: fine)";

export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_OVERLAY_QUERY).matches
  );
}

/* ---------- M4 card stack: the page behind a large phone sheet ---------- */

const stacked = new Set<string>();
let unstackTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Turns the iOS card stack on or off for one sheet (ref-counted across stacked
 * sheets). `<html data-sheet-stack="on">` scales `.shell-stage` to .94 with
 * rounded top corners (CSS transition, transform only); `"off"` animates it back,
 * then the attribute goes away so the stage has no transform or clip at rest.
 */
export function setSheetStack(id: string, on: boolean): void {
  if (typeof document === "undefined") return;
  const had = stacked.size > 0;
  if (on) stacked.add(id);
  else stacked.delete(id);
  const now = stacked.size > 0;
  if (now === had) return;
  const html = document.documentElement;
  clearTimeout(unstackTimer);
  if (now) {
    const stage = document.querySelector<HTMLElement>(".shell-stage");
    if (!stage) return;
    // Scale around the top of the visible part of the page.
    stage.style.setProperty("--stack-y", `${window.scrollY}px`);
    if (html.dataset.sheetStack !== "off") {
      html.dataset.sheetStack = "off";
      // Commit the start state, so the radius and scale transition from it.
      getComputedStyle(stage).clipPath;
    }
    html.dataset.sheetStack = "on";
  } else if (html.dataset.sheetStack) {
    html.dataset.sheetStack = "off";
    unstackTimer = setTimeout(() => {
      if (stacked.size === 0) delete html.dataset.sheetStack;
    }, 360);
  }
}
