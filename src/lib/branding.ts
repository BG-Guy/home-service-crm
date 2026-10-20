// Brand accent → CSS custom properties (SPEC §M21 Branding, §12.1). Pure and
// isomorphic: the root layout server-renders the result in a <style> tag, so the
// brand color is applied before first paint (no flash, no client JS).
//
// - `--accent` is the brand fill (buttons, switches, tab tint).
// - `--accent-text` is derived per theme so links/labels keep WCAG AA (4.5:1) on the
//   page and card backgrounds: darkened in light mode, lightened in dark mode.
// - `--on-accent` is white or near-black, whichever reads better on the fill.
// - `--accent-fill` is the fill under text (primary buttons, selected chips, badges): the
//   accent darkened just enough for white text to reach 4.5:1, readable outdoors. Accents
//   that already pass (or that take dark text) are used as they are.

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

type Rgb = [number, number, number];

/** Normalize `#abc` / `abc` / `#aabbcc` to `#aabbcc`; null when invalid. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = HEX.exec(input.trim());
  if (!m) return null;
  let h = (m[1] as string).toLowerCase();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return `#${h}`;
}

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Move `hex` toward `target` (black or white) in small steps until it reaches
 * `ratio` against every background. Returns the first passing shade.
 */
function adjustFor(
  hex: string,
  backgrounds: readonly string[],
  target: "#000000" | "#ffffff",
  ratio = 4.5,
): string {
  const from = toRgb(hex);
  const to = toRgb(target);
  for (let i = 0; i <= 40; i++) {
    const c = toHex(mix(from, to, i / 40));
    if (backgrounds.every((bg) => contrast(c, bg) >= ratio)) return c;
  }
  return target;
}

// Page/card backgrounds from globals.css (--bg / --card / grouped cells).
const LIGHT_BGS = ["#ffffff", "#f2f2f7"] as const;
const DARK_BGS = ["#000000", "#1c1c1e", "#2c2c2e"] as const;

export interface BrandTokens {
  accent: string;
  accentTextLight: string;
  accentTextDark: string;
  onAccent: string;
  /** Fill under `onAccent` text: ≥ 4.5:1 with white when the label is white. */
  accentFill: string;
}

/** Derive the accent token set for a brand color (null when the input is invalid). */
export function brandTokens(
  accent: string | null | undefined,
): BrandTokens | null {
  const hex = normalizeHex(accent);
  if (!hex) return null;
  const white = contrast(hex, "#ffffff");
  const dark = contrast(hex, "#111111");
  // Button labels are 17 px semibold: prefer white unless it's clearly worse.
  const onAccent = white >= 3 || white >= dark ? "#ffffff" : "#111111";
  return {
    accent: hex,
    accentTextLight: adjustFor(hex, LIGHT_BGS, "#000000"),
    accentTextDark: adjustFor(hex, DARK_BGS, "#ffffff"),
    onAccent,
    accentFill:
      onAccent === "#ffffff" && white < 4.5
        ? adjustFor(hex, ["#ffffff"], "#000000")
        : hex,
  };
}

/**
 * The CSS for the root layout's brand `<style>` tag ('' when no valid accent).
 * Selectors are doubled (`:root:root`) to outrank the defaults in globals.css
 * regardless of stylesheet order. Input is validated as hex, so it is safe to inline.
 */
export function brandCss(accent: string | null | undefined): string {
  const t = brandTokens(accent);
  if (!t) return "";
  return [
    `:root:root{--accent:${t.accent};--accent-text:${t.accentTextLight};--on-accent:${t.onAccent};--accent-fill:${t.accentFill}}`,
    `@media (prefers-color-scheme: dark){:root:root:not([data-theme="light"]){--accent-text:${t.accentTextDark}}}`,
    `:root:root[data-theme="dark"]{--accent-text:${t.accentTextDark}}`,
  ].join("\n");
}
