// Activity rows deep-link to where their entity lives (the same routes as the
// automations' entityUrl), and never to a teammate's profile the viewer can't open.
import { describe, expect, it } from "vitest";
import { activityHref } from "@/features/notify/timeline";

describe("activityHref", () => {
  it("links entities with their own page", () => {
    expect(activityHref("job", "j1")).toBe("/jobs/j1");
    expect(activityHref("customer", "c1")).toBe("/customers/c1");
    expect(activityHref("lead", "l1")).toBe("/leads/l1");
    expect(activityHref("estimate", "e1")).toBe("/estimates/e1");
    expect(activityHref("change_order", "co1")).toBe("/estimates/co/co1");
    expect(activityHref("invoice", "i1")).toBe("/invoices/i1");
    expect(activityHref("vehicle", "v1")).toBe("/vehicles/v1");
    expect(activityHref("tool", "t1")).toBe("/tools/t1");
    expect(activityHref("tool_audit", "a1")).toBe("/tools/audits/a1");
    expect(activityHref("dispute", "d1")).toBe("/disputes/d1");
    expect(activityHref("settlement", "s1")).toBe("/pay/statements/s1");
    expect(activityHref("task", "k1")).toBe("/tasks");
  });

  it("sends money and parts rows to the job's tab", () => {
    for (const t of ["payment", "refund", "deposit_request"])
      expect(activityHref(t, "p1", { jobId: "j1" })).toBe(
        "/jobs/j1?tab=invoice",
      );
    expect(activityHref("payment", "p1")).toBeUndefined();
    expect(activityHref("part_purchase", "pp1", { jobId: "j1" })).toBe(
      "/jobs/j1?tab=parts",
    );
    expect(activityHref("part_purchase", "pp1")).toBeUndefined();
  });

  it("opens a vehicle record on its vehicle's page", () => {
    for (const t of [
      "vehicle_issue",
      "document",
      "odometer",
      "fuel",
      "service",
      "inspection",
      "trip",
    ])
      expect(activityHref(t, "x1", { vehicleId: "v1" })).toBe("/vehicles/v1");
    expect(activityHref("fuel", "x1")).toBeUndefined();
    expect(activityHref("fuel", "x1", { jobId: "j1" })).toBe("/jobs/j1");
  });

  it("opens a teammate's profile only when the viewer may", () => {
    expect(activityHref("user", "u1", { canOpenTeam: true })).toBe("/team/u1");
    expect(activityHref("user", "u1", { viewerId: "u1" })).toBe("/team/u1");
    expect(activityHref("user", "u1", { viewerId: "u2" })).toBeUndefined();
    expect(activityHref("user", "u1")).toBeUndefined();
  });

  it("falls back to the row's job or conversation", () => {
    expect(activityHref("message", "m1", { customerId: "c1" })).toBe(
      "/messages/c1",
    );
    expect(activityHref("message", "m1")).toBeUndefined();
    expect(activityHref("review_request", "r1", { jobId: "j1" })).toBe(
      "/jobs/j1",
    );
    expect(activityHref("photo", "ph1", { jobId: "j1" })).toBe("/jobs/j1");
    expect(activityHref("photo", "ph1")).toBeUndefined();
  });
});
