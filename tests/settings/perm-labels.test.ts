// Settings → Permissions shows human labels (QA2 T3-03/T4-07): every permission key
// has a plain-language label and description, labels are unique (the filter mixes
// sections and the switches' accessible names are "<label> for <role>"), and no
// description leaks keys, spec references or setting paths.
import { describe, expect, it } from "vitest";
import {
  PERM_DESCRIPTIONS,
  PERM_LABELS,
  permDescription,
  permLabel,
} from "@/features/settings/perm-labels";
import { ALL_PERMS } from "@/lib/permissions";

describe("permission labels", () => {
  it("labels and describes every permission key", () => {
    const missingLabel = ALL_PERMS.filter((p) => !PERM_LABELS[p]);
    const missingDescription = ALL_PERMS.filter((p) => !PERM_DESCRIPTIONS[p]);
    expect(missingLabel).toEqual([]);
    expect(missingDescription).toEqual([]);
  });

  it("has no stale entries for removed keys", () => {
    const known = new Set<string>(ALL_PERMS);
    expect(Object.keys(PERM_LABELS).filter((k) => !known.has(k))).toEqual([]);
    expect(Object.keys(PERM_DESCRIPTIONS).filter((k) => !known.has(k))).toEqual(
      [],
    );
  });

  it("uses unique labels", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const p of ALL_PERMS) {
      const l = permLabel(p).toLowerCase();
      if (seen.has(l)) dupes.push(`${seen.get(l)} / ${p}: ${l}`);
      seen.set(l, p);
    }
    expect(dupes).toEqual([]);
  });

  it("keeps jargon out of labels and descriptions", () => {
    const jargon = /[_§]|\b[a-z]+\.[a-z_]+\b|\bM\d+\b/;
    const bad = ALL_PERMS.filter(
      (p) => jargon.test(permLabel(p)) || jargon.test(permDescription(p)),
    );
    expect(bad).toEqual([]);
  });

  it("builds a readable fallback for an unknown key", () => {
    expect(permLabel("widgets.view_all")).toBe("View all widgets");
    expect(permDescription("widgets.view_all")).toBe("");
  });
});
