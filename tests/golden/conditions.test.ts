// ★ Golden: automation conditions evaluator (SPEC M13). No eval; fails closed.
import { describe, expect, it } from "vitest";
import {
  conditionFields,
  evaluateConditions,
  getField,
  validateConditions,
} from "@/features/automations/conditions";

const ctx = {
  job: {
    status: "scheduled",
    service_type_id: "st-1",
    priority: "urgent",
    visit_count: 2,
    is_callback: false,
    assignees: ["u1", "u2"],
  },
  customer: {
    tags: ["vip", "commercial"],
    type: "residential",
    sms_status: "marketing",
    vip: true,
  },
  invoice: { balance_cents: 12500 },
  event: {
    via: "manual",
    rating: 2,
    after_arrival: true,
    at: "2026-10-15T10:00:00Z",
  },
  lead: { source: null as string | null, notes: "" },
};

describe("evaluateConditions", () => {
  it("empty / null / {} conditions are true", () => {
    expect(evaluateConditions(null, ctx)).toBe(true);
    expect(evaluateConditions(undefined, ctx)).toBe(true);
    expect(evaluateConditions({}, ctx)).toBe(true);
    expect(evaluateConditions({ all: [] }, ctx)).toBe(true);
    expect(evaluateConditions({ any: [] }, ctx)).toBe(true);
  });

  it("spec example: service type in list AND customer tags contain vip", () => {
    expect(
      evaluateConditions(
        {
          all: [
            { field: "job.service_type_id", op: "in", value: ["st-1", "st-2"] },
            { field: "customer.tags", op: "contains", value: "vip" },
          ],
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        {
          all: [
            { field: "job.service_type_id", op: "in", value: ["st-9"] },
            { field: "customer.tags", op: "contains", value: "vip" },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });

  it.each([
    ["eq", "job.status", "scheduled", true],
    ["eq", "job.status", "SCHEDULED", true], // case-insensitive strings
    ["eq", "event.rating", "2", true], // numeric string vs number
    ["eq", "event.after_arrival", "true", true], // boolean vs string
    ["neq", "job.status", "cancelled", true],
    ["neq", "job.status", "scheduled", false],
    ["in", "job.priority", ["urgent", "emergency"], true],
    ["in", "job.priority", "normal, urgent", true], // comma list
    ["in", "job.assignees", ["u2"], true], // array field: any item
    ["nin", "job.priority", ["normal"], true],
    ["nin", "job.assignees", ["u1"], false],
    ["gt", "invoice.balance_cents", 0, true],
    ["gte", "job.visit_count", 2, true],
    ["lt", "event.rating", 3, true],
    ["lte", "event.rating", 3, true],
    ["lte", "event.rating", 1, false],
    ["gt", "event.at", "2026-10-14", true], // ISO dates compare by time
    ["gt", "job.status", 1, false], // non-numeric never compares
    ["contains", "customer.tags", "commercial", true],
    ["contains", "job.status", "sched", true], // substring
    ["contains", "customer.tags", "warranty", false],
    ["exists", "job.status", undefined, true],
    ["exists", "lead.source", undefined, false],
    ["exists", "lead.notes", undefined, false], // blank string counts as empty
    ["not_exists", "lead.source", undefined, true],
    ["not_exists", "job.missing.deep", undefined, true],
  ] as const)("%s %s %j → %s", (op, field, value, want) => {
    expect(evaluateConditions({ field, op, value }, ctx)).toBe(want);
  });

  it("any / not / nesting", () => {
    expect(
      evaluateConditions(
        {
          any: [
            { field: "job.status", op: "eq", value: "cancelled" },
            { field: "customer.vip", op: "eq", value: true },
          ],
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { not: { field: "job.status", op: "eq", value: "scheduled" } },
        ctx,
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        {
          all: [
            {
              field: "job.status",
              op: "in",
              value: ["scheduled", "confirmed"],
            },
            {
              any: [
                { field: "event.via", op: "eq", value: "portal" },
                { not: { field: "event.via", op: "eq", value: "reply" } },
              ],
            },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });

  it("fails closed on malformed input (never mass-sends after a bad edit)", () => {
    expect(evaluateConditions("job.status == 1", ctx)).toBe(false);
    expect(evaluateConditions([], ctx)).toBe(false);
    expect(evaluateConditions({ all: "x" }, ctx)).toBe(false);
    expect(evaluateConditions({ foo: [] }, ctx)).toBe(false);
    expect(
      evaluateConditions(
        { field: "job.status", op: "regex", value: ".*" },
        ctx,
      ),
    ).toBe(false);
    let deep: unknown = { field: "job.status", op: "exists" };
    for (let i = 0; i < 12; i++) deep = { not: { not: deep } };
    expect(evaluateConditions(deep, ctx)).toBe(false);
  });

  it("never walks into prototypes", () => {
    expect(getField(ctx, "__proto__.constructor")).toBeUndefined();
    expect(getField(ctx, "job.constructor")).toBeUndefined();
    expect(
      evaluateConditions({ field: "job.__proto__", op: "exists" }, ctx),
    ).toBe(false);
  });

  it("lists referenced fields and validates shape", () => {
    expect(
      conditionFields({
        all: [
          { field: "job.status", op: "eq", value: "x" },
          { any: [{ field: "customer.tags", op: "contains", value: "vip" }] },
        ],
      }).sort(),
    ).toEqual(["customer.tags", "job.status"]);
    expect(
      validateConditions({ all: [{ field: "job.status", op: "eq" }] }),
    ).toEqual([]);
    expect(
      validateConditions({ all: [{ field: "1bad", op: "nope" }] }),
    ).toHaveLength(2);
    expect(validateConditions({ bogus: 1 })).toEqual(['Unknown key "bogus".']);
  });
});
