import { describe, expect, it } from "vitest";
import { homeFor } from "@/lib/auth/home";
import { brandCss, brandTokens, contrast, normalizeHex } from "@/lib/branding";
import { dataThemeFor, parseTheme } from "@/lib/theme";

describe("branding", () => {
  it("normalizes and rejects hex input", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("0088ff")).toBe("#0088ff");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345g")).toBeNull();
    expect(normalizeHex("#000;}body{")).toBeNull();
  });

  it("derives accent-text with AA contrast on light and dark surfaces", () => {
    for (const accent of [
      "#ffcc00",
      "#34c759",
      "#0088ff",
      "#ff2d55",
      "#1c1c1e",
    ]) {
      const t = brandTokens(accent);
      expect(t).not.toBeNull();
      if (!t) continue;
      for (const bg of ["#ffffff", "#f2f2f7"])
        expect(contrast(t.accentTextLight, bg)).toBeGreaterThanOrEqual(4.5);
      for (const bg of ["#000000", "#1c1c1e", "#2c2c2e"])
        expect(contrast(t.accentTextDark, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("picks a readable label color on the accent fill", () => {
    expect(brandTokens("#0088ff")?.onAccent).toBe("#ffffff");
    expect(brandTokens("#ffcc00")?.onAccent).toBe("#111111");
  });

  it("keeps white labels at 4.5:1 on the fill (readable outdoors)", () => {
    // Too light for white text: darkened just enough.
    for (const accent of ["#0088ff", "#e8590c", "#ff383c"]) {
      const t = brandTokens(accent);
      if (!t) throw new Error(accent);
      expect(t.onAccent).toBe("#ffffff");
      expect(contrast(t.accentFill, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(t.accentFill).not.toBe(accent);
    }
    // Already passing, or taking dark text: unchanged.
    expect(brandTokens("#3b4cca")?.accentFill).toBe("#3b4cca");
    expect(brandTokens("#b03a2e")?.accentFill).toBe("#b03a2e");
    expect(brandTokens("#ffcc00")?.accentFill).toBe("#ffcc00");
    expect(brandCss("#e8590c")).toContain("--accent-fill:#");
  });

  it("emits CSS only for valid colors", () => {
    expect(brandCss(null)).toBe("");
    expect(brandCss("not-a-color")).toBe("");
    const css = brandCss("#ff8d28");
    expect(css).toContain("--accent:#ff8d28");
    expect(css).toContain('[data-theme="dark"]');
  });
});

describe("theme + role home", () => {
  it("parses the appearance cookie", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("blue")).toBeNull();
    expect(dataThemeFor("system")).toBeUndefined();
    expect(dataThemeFor("light")).toBe("light");
  });
  it("sends admins to insights and everyone else to today", () => {
    expect(homeFor("admin")).toBe("/insights");
    expect(homeFor("office")).toBe("/today");
    expect(homeFor("tech")).toBe("/today");
  });
});

// The header's create buttons (formerly the "+" menu) moved to
// tests/lib/create-items.test.ts.
