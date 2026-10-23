import { describe, expect, it } from "vitest";
import { JOB_KINDS as DB_JOB_KINDS, zJobKind } from "@/db/enums";
import {
  durationLabel,
  isJobKind,
  JOB_KINDS,
  KIND_DEFAULTS,
  KIND_HINT,
  KIND_ICON,
  KIND_LABEL,
  kindOf,
  primaryTypeId,
  splitByKind,
} from "@/features/jobs/kinds";
import { icons } from "@/ui/icons";

// The three job types (leads-flow redesign, item 6): labels, defaults and grouping.

describe("job kinds", () => {
  it("matches the stored enum", () => {
    expect([...JOB_KINDS]).toEqual([...DB_JOB_KINDS]);
    for (const k of JOB_KINDS) expect(zJobKind.parse(k)).toBe(k);
    expect(zJobKind.safeParse("repair").success).toBe(false);
  });

  it("has the approved copy and defaults", () => {
    expect(KIND_LABEL).toEqual({
      estimate: "Free estimate",
      service: "Service call",
      project: "Project",
    });
    expect(KIND_HINT).toEqual({
      estimate: "We look and quote",
      service: "Fix it on the visit",
      project: "Bigger work, half a day or more",
    });
    expect(KIND_DEFAULTS.estimate).toMatchObject({
      durationMin: 45,
      deposit: "none",
      endsWithEstimate: true,
    });
    expect(KIND_DEFAULTS.service).toMatchObject({
      durationMin: 90,
      contractKind: "repair",
      deposit: "none",
    });
    expect(KIND_DEFAULTS.project).toMatchObject({
      durationMin: 240,
      contractKind: "improvement",
      deposit: "rules",
    });
  });

  it("uses icon names from the icon map", () => {
    for (const k of JOB_KINDS) expect(icons).toHaveProperty(KIND_ICON[k]);
  });

  it("coerces unknown kinds to service", () => {
    expect(isJobKind("project")).toBe(true);
    expect(isJobKind("maintenance")).toBe(false);
    expect(isJobKind(undefined)).toBe(false);
    expect(kindOf("estimate")).toBe("estimate");
    expect(kindOf("installation")).toBe("service");
    expect(kindOf(null)).toBe("service");
  });

  it("labels durations", () => {
    expect(durationLabel(45)).toBe("45 min");
    expect(durationLabel(90)).toBe("1 h 30 min");
    expect(durationLabel(240)).toBe("4 h");
  });
});

describe("splitByKind", () => {
  const rows = [
    { id: "sc", name: "Service call", kind: "service" },
    { id: "lock", name: "Lockout", kind: "service" },
    { id: "pr", name: "Project", kind: "project" },
    { id: "rekey", name: "Rekey", kind: "service" },
    { id: "master", name: "Master key system", kind: "project" },
    { id: "odd", name: "Legacy", kind: "whatever" },
  ];

  it("groups rows under the three kinds in order, primary first", () => {
    const g = splitByKind(rows);
    expect(g.map((x) => x.kind)).toEqual(["estimate", "service", "project"]);
    expect(g[0]).toEqual({ kind: "estimate", primary: null, jobs: [] });
    expect(g[1]?.primary?.id).toBe("sc");
    // Unknown kinds count as service calls; input order is kept.
    expect(g[1]?.jobs.map((r) => r.id)).toEqual(["lock", "rekey", "odd"]);
    expect(g[2]?.primary?.id).toBe("pr");
    expect(g[2]?.jobs.map((r) => r.id)).toEqual(["master"]);
  });

  it("picks the row named like the kind, else the first of the kind", () => {
    const renamed = [
      { id: "lock", name: "Lockout", kind: "service" },
      { id: "sc", name: " service CALL ", kind: "service" },
      { id: "deck", name: "Deck build", kind: "project" },
    ];
    expect(primaryTypeId(renamed, "service")).toBe("sc");
    expect(primaryTypeId(renamed, "project")).toBe("deck");
    expect(primaryTypeId(renamed, "estimate")).toBeNull();
  });
});
