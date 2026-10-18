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

export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px)").matches
  );
}
