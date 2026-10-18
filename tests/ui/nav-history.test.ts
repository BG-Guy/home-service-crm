import { describe, expect, it } from "vitest";
import {
  type Crumb,
  crumbsBefore,
  isTransient,
  pathOf,
  visit,
} from "@/client/nav-history";

const walk = (...hrefs: string[]) =>
  hrefs.reduce<Crumb[]>((t, h) => visit(t, h), []);
const paths = (t: readonly Crumb[]) => t.map((c) => c.path);

describe("navigation trail", () => {
  it("keeps the pages visited, in order", () => {
    const t = walk("/schedule", "/jobs/j1", "/customers/c1");
    expect(paths(t)).toEqual(["/schedule", "/jobs/j1", "/customers/c1"]);
  });

  it("cuts back to a page you return to", () => {
    const t = walk("/schedule", "/jobs/j1", "/customers/c1", "/jobs/j1");
    expect(paths(t)).toEqual(["/schedule", "/jobs/j1"]);
    expect(paths(visit(t, "/schedule"))).toEqual(["/schedule"]);
  });

  it("treats query changes as the same page and remembers the latest URL", () => {
    const t = walk("/schedule", "/schedule?date=2026-10-20", "/jobs/j1");
    expect(paths(t)).toEqual(["/schedule", "/jobs/j1"]);
    expect(t[0]?.href).toBe("/schedule?date=2026-10-20");
    const tabbed = visit(t, "/jobs/j1?tab=invoice");
    expect(tabbed).toHaveLength(2);
    expect(tabbed[1]?.href).toBe("/jobs/j1?tab=invoice");
  });

  it("drops pass-through pages (create forms, print) once you leave them", () => {
    const t = walk("/jobs", "/jobs/new", "/jobs/j9");
    expect(paths(t)).toEqual(["/jobs", "/jobs/j9"]);
    expect(paths(walk("/jobs/j1", "/jobs/j1/print", "/jobs/j1"))).toEqual([
      "/jobs/j1",
    ]);
    expect(isTransient("/customers/c1/merge")).toBe(true);
    // "/" only redirects to the role's home.
    expect(paths(walk("/", "/insights"))).toEqual(["/insights"]);
    expect(isTransient("/jobs/j1")).toBe(false);
    expect(isTransient("/newsletter")).toBe(false);
  });

  it("caps the length, dropping the oldest", () => {
    const t = walk(...Array.from({ length: 20 }, (_, i) => `/jobs/j${i}`));
    expect(t).toHaveLength(15);
    expect(t[0]?.path).toBe("/jobs/j5");
  });

  it("keeps a page's title across revisits", () => {
    const t = visit(walk("/customers/c1"), "/customers/c1?x=1", "Jane Smith");
    expect(t[0]?.title).toBe("Jane Smith");
    expect(visit(t, "/customers/c1")[0]?.title).toBe("Jane Smith");
  });

  it("finds the pages before the current one, recorded or not yet", () => {
    const t = walk("/schedule", "/customers/c1");
    // The new page renders before its visit is recorded.
    expect(paths(crumbsBefore(t, "/jobs/j1"))).toEqual([
      "/schedule",
      "/customers/c1",
    ]);
    const after = visit(t, "/jobs/j1");
    expect(paths(crumbsBefore(after, "/jobs/j1"))).toEqual([
      "/schedule",
      "/customers/c1",
    ]);
    // Going back to an earlier page: only what came before it.
    expect(paths(crumbsBefore(after, "/customers/c1"))).toEqual(["/schedule"]);
    // Leaving a create form: the form isn't a place to go back to.
    expect(paths(crumbsBefore(walk("/jobs", "/jobs/new"), "/jobs/j9"))).toEqual(
      ["/jobs"],
    );
  });

  it("normalizes paths", () => {
    expect(pathOf("/jobs/?mine=1#top")).toBe("/jobs");
    expect(pathOf("/")).toBe("/");
    expect(pathOf("")).toBe("/");
  });
});
