"use client";

import { useState } from "react";
import {
  dataThemeFor,
  THEME_COOKIE,
  type ThemePref,
  themeColorsFor,
} from "@/lib/theme";
import { SegmentedControl } from "@/ui/components/SegmentedControl";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Auto / Light / Dark ("Auto" follows the OS). Stored in a plain cookie so the root
 * layout renders the right `data-theme` and theme-color on the next request;
 * applied to <html> and the theme-color metas immediately.
 */
export function AppearanceControl({ initial }: { initial: ThemePref }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  function change(v: ThemePref) {
    setPref(v);
    // biome-ignore lint/suspicious/noDocumentCookie: a tiny UI preference; no Cookie Store API needed
    document.cookie = `${THEME_COOKIE}=${v}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    const t = dataThemeFor(v);
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    for (const { media, color } of themeColorsFor(v)) {
      const meta = document.querySelector<HTMLMetaElement>(
        `meta[name="theme-color"][media="${media}"]`,
      );
      if (meta) meta.content = color;
    }
  }
  return (
    <SegmentedControl
      label="Appearance"
      value={pref}
      onChange={change}
      segments={[
        { value: "system", label: "Auto" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}
