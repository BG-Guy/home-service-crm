// Appearance preference (SPEC §12.1, §13.1 More → Appearance). Isomorphic.
// The choice lives in a plain cookie so the root layout can server-render
// `<html data-theme>` with no flash; "system" (or no cookie) follows the OS,
// falling back to `settings.ui.default_theme`.

export const THEME_COOKIE = "theme";
export const THEMES = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEMES)[number];

export function parseTheme(v: string | null | undefined): ThemePref | null {
  return v === "system" || v === "light" || v === "dark" ? v : null;
}

/** `data-theme` attribute value for a preference (undefined = follow the OS). */
export function dataThemeFor(pref: ThemePref): "light" | "dark" | undefined {
  return pref === "system" ? undefined : pref;
}

/** Browser chrome color per theme (`<meta name="theme-color">`), = the page --bg. */
export const THEME_COLORS = { light: "#F5F5F7", dark: "#000000" } as const;

/**
 * theme-color entries for a preference: a forced theme paints the bar its own
 * color whatever the OS says; "system" follows prefers-color-scheme (QA T4-17).
 */
export function themeColorsFor(
  pref: ThemePref,
): { media: string; color: string }[] {
  const forced = dataThemeFor(pref);
  return (["light", "dark"] as const).map((scheme) => ({
    media: `(prefers-color-scheme: ${scheme})`,
    color: THEME_COLORS[forced ?? scheme],
  }));
}
