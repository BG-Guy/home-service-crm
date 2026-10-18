import { describe, expect, it } from "vitest";
import {
  contextualize,
  createItemsFor,
} from "@/app/(app)/_components/create-items";
import { homeFor } from "@/lib/auth/home";
import { brandCss, brandTokens, contrast, normalizeHex } from "@/lib/branding";
import type { Perm } from "@/lib/permissions";
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

describe("global + menu", () => {
  const perms = new Set<Perm>([
    "jobs.create",
    "customers.create",
    "estimates.create",
  ] as Perm[]);
  it("filters by permission and flag", () => {
    const keys = createItemsFor(perms, { estimates: false }).map((i) => i.key);
    expect(keys).toEqual(["job", "customer"]);
  });
  it("puts the page's item first and prefills the customer", () => {
    const items = createItemsFor(perms, {});
    const id = "0b9a6f3e-2f43-4c51-9a55-5b8f3e0a1c2d";
    const out = contextualize(items, `/customers/${id}`);
    expect(out[0]?.key).toBe("customer");
    expect(out.find((i) => i.key === "job")?.href).toBe(
      `/jobs/new?customerId=${id}`,
    );
    expect(contextualize(items, "/estimates")[0]?.key).toBe("estimate");
  });
});
