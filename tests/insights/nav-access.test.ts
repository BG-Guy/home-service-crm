// Dashboard tiles only link to pages the viewer can open (QA2 T4-09/T3-05): office
// has no approval permissions, so the Approvals tile and row must not show for it.
import { describe, expect, it } from "vitest";
import { navAccess } from "@/features/insights/nav-access";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@/lib/flags";
import { resolvePerms } from "@/lib/permissions";

const allOn = Object.fromEntries(
  Object.keys(DEFAULT_FEATURE_FLAGS).map((k) => [k, true]),
) as FeatureFlags;
const viewer = (role: "admin" | "office" | "tech") => ({
  baseRole: role,
  perms: resolvePerms({ role, baseRole: role }),
});

describe("navAccess", () => {
  it("office can't open Approvals; admin can", () => {
    expect(navAccess(viewer("office"), allOn)("approvals")).toBe(false);
    expect(navAccess(viewer("admin"), allOn)("approvals")).toBe(true);
  });

  it("office can open the pages behind the other ops rows", () => {
    const can = navAccess(viewer("office"), allOn);
    for (const key of [
      "leads",
      "schedule",
      "jobs",
      "invoices",
      "estimates",
      "tasks",
      "messages",
    ])
      expect([key, can(key)]).toEqual([key, true]);
  });

  it("follows feature flags and rejects unknown keys", () => {
    const can = navAccess(viewer("office"), { ...allOn, leads: false });
    expect(can("leads")).toBe(false);
    expect(can("no-such-page")).toBe(false);
  });
});
