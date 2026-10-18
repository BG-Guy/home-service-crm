// Brand color checks for Settings → Branding (SPEC M21: "contrast-checked; auto-derives
// --accent-text"). Pure and client-safe; built on F's src/lib/branding.ts.
import { brandTokens, contrast, normalizeHex } from "@/lib/branding";

export interface ContrastLine {
  key: "label" | "text-light" | "text-dark" | "fill-light" | "fill-dark";
  label: string;
  ratio: number;
  /** Required ratio (4.5 text, 3 large text / UI shapes). */
  min: number;
  pass: boolean;
  /** The color actually used after auto-adjustment. */
  color: string;
}

export interface ContrastReport {
  accent: string;
  accentTextLight: string;
  accentTextDark: string;
  onAccent: string;
  lines: ContrastLine[];
  /** Text color was darkened/lightened to stay readable. */
  adjusted: { light: boolean; dark: boolean };
  ok: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Contrast report for an accent color: button label on the fill, derived link text on
 * light and dark surfaces (both must reach 4.5:1 after adjustment) and the fill itself
 * against the page (3:1 recommended for buttons/switches; a warning, not a blocker).
 */
export function contrastReport(
  input: string | null | undefined,
): ContrastReport | null {
  const t = brandTokens(input);
  const hex = normalizeHex(input);
  if (!t || !hex) return null;
  const lines: ContrastLine[] = [
    {
      key: "label",
      label: "Button label on brand color",
      ratio: r2(contrast(t.onAccent, t.accent)),
      min: 3,
      pass: contrast(t.onAccent, t.accent) >= 3,
      color: t.onAccent,
    },
    {
      key: "text-light",
      label: "Links on light background",
      ratio: r2(
        Math.min(
          contrast(t.accentTextLight, "#ffffff"),
          contrast(t.accentTextLight, "#f2f2f7"),
        ),
      ),
      min: 4.5,
      pass: contrast(t.accentTextLight, "#f2f2f7") >= 4.5,
      color: t.accentTextLight,
    },
    {
      key: "text-dark",
      label: "Links on dark background",
      ratio: r2(
        Math.min(
          contrast(t.accentTextDark, "#1c1c1e"),
          contrast(t.accentTextDark, "#2c2c2e"),
        ),
      ),
      min: 4.5,
      pass: contrast(t.accentTextDark, "#2c2c2e") >= 4.5,
      color: t.accentTextDark,
    },
    {
      key: "fill-light",
      label: "Brand color on light background",
      ratio: r2(contrast(hex, "#ffffff")),
      min: 3,
      pass: contrast(hex, "#ffffff") >= 3,
      color: hex,
    },
    {
      key: "fill-dark",
      label: "Brand color on dark background",
      ratio: r2(contrast(hex, "#1c1c1e")),
      min: 3,
      pass: contrast(hex, "#1c1c1e") >= 3,
      color: hex,
    },
  ];
  return {
    accent: t.accent,
    accentTextLight: t.accentTextLight,
    accentTextDark: t.accentTextDark,
    onAccent: t.onAccent,
    lines,
    adjusted: {
      light: t.accentTextLight !== hex,
      dark: t.accentTextDark !== hex,
    },
    ok: lines.slice(0, 3).every((l) => l.pass),
  };
}
