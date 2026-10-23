// Header create buttons (leads flow item 5): which buttons a viewer gets, their
// order on each page (the page's own first) and which one is the accent pill.
import { describe, expect, it } from "vitest";
import {
  type CreateItem,
  canCreate,
  contextualize,
  createItemsFor,
  isPrimaryCreate,
} from "@/app/(app)/_components/create-items";
import type { Perm } from "@/lib/permissions";

const ALL = new Set<Perm>([
  "leads.create",
  "jobs.create",
  "customers.create",
  "estimates.create",
  "parts.submit_receipt",
  "tools.view_own",
  "vehicles.manage",
] as Perm[]);
const CUSTOMER = "0b9a6f3e-2f43-4c51-9a55-5b8f3e0a1c2d";

const keys = (items: readonly CreateItem[]) => items.map((i) => i.key);
const order = (path: string, items = createItemsFor(ALL, {})) =>
  keys(contextualize(items, path));
const primary = (path: string, items = createItemsFor(ALL, {})) =>
  contextualize(items, path)
    .filter((i) => isPrimaryCreate(i, path))
    .map((i) => i.key);

describe("create buttons: who gets which", () => {
  it("shows New lead, New job and New customer, named, in that order", () => {
    const items = createItemsFor(ALL, {});
    expect(keys(items)).toEqual(["lead", "job", "customer"]);
    expect(items.map((i) => i.label)).toEqual([
      "New lead",
      "New job",
      "New customer",
    ]);
    expect(items.map((i) => i.href)).toEqual([
      "/leads/new",
      "/jobs/new",
      "/customers/new",
    ]);
  });

  it("keeps estimates, receipts, tools and vehicles off the header", () => {
    for (const k of ["estimate", "receipt", "tool", "vehicle"])
      expect(keys(createItemsFor(ALL, {}))).not.toContain(k);
  });

  it("filters by permission and feature flag", () => {
    const office = new Set<Perm>(["jobs.create", "customers.create"] as Perm[]);
    expect(keys(createItemsFor(office, {}))).toEqual(["job", "customer"]);
    expect(keys(createItemsFor(ALL, { leads: false }))).toEqual([
      "job",
      "customer",
    ]);
    expect(createItemsFor(new Set<Perm>(), {})).toEqual([]);
  });

  it("puts a page's own action first, only when allowed", () => {
    expect(keys(createItemsFor(ALL, {}, "estimate"))).toEqual([
      "estimate",
      "lead",
      "job",
      "customer",
    ]);
    expect(createItemsFor(ALL, {}, "receipt")[0]).toMatchObject({
      label: "Upload receipt",
      href: "/parts?new=receipt",
      own: true,
    });
    expect(createItemsFor(ALL, {}, "tool")[0]?.href).toBe("/tools?new=tool");
    expect(createItemsFor(ALL, {}, "vehicle")[0]?.label).toBe("New vehicle");
    // Off by flag or permission: the header just has the three.
    expect(keys(createItemsFor(ALL, { estimates: false }, "estimate"))).toEqual(
      ["lead", "job", "customer"],
    );
    const noFleet = new Set([...ALL].filter((p) => p !== "vehicles.manage"));
    expect(keys(createItemsFor(noFleet, {}, "vehicle"))[0]).toBe("lead");
    expect(canCreate("vehicle", noFleet, {})).toBe(false);
    expect(canCreate("tool", ALL, {})).toBe(true);
    expect(canCreate("tool", ALL, { tools: false })).toBe(false);
  });
});

describe("create buttons: order and accent per page", () => {
  it("puts the page's own item first", () => {
    expect(order("/leads")).toEqual(["lead", "job", "customer"]);
    expect(order("/leads/0b9a")).toEqual(["lead", "job", "customer"]);
    expect(order("/jobs")).toEqual(["job", "lead", "customer"]);
    expect(order("/schedule")).toEqual(["job", "lead", "customer"]);
    expect(order("/today")).toEqual(["job", "lead", "customer"]);
    expect(order("/customers")).toEqual(["customer", "lead", "job"]);
    expect(order(`/customers/${CUSTOMER}`)).toEqual([
      "customer",
      "lead",
      "job",
    ]);
    // No own item: the default order.
    expect(order("/dispatch")).toEqual(["lead", "job", "customer"]);
    expect(order("/invoices")).toEqual(["lead", "job", "customer"]);
    // A prefix only matches whole segments.
    expect(order("/jobsite")).toEqual(["lead", "job", "customer"]);
  });

  it("keeps a page's own action ahead of the section match", () => {
    const items = createItemsFor(ALL, {}, "estimate");
    expect(order("/estimates", items)).toEqual([
      "estimate",
      "lead",
      "job",
      "customer",
    ]);
  });

  it("prefills the customer on New job from a customer page", () => {
    const out = contextualize(
      createItemsFor(ALL, {}),
      `/customers/${CUSTOMER}`,
    );
    expect(out.find((i) => i.key === "job")?.href).toBe(
      `/jobs/new?customerId=${CUSTOMER}`,
    );
    expect(out.find((i) => i.key === "lead")?.href).toBe("/leads/new");
    expect(
      contextualize(createItemsFor(ALL, {}), "/customers").find(
        (i) => i.key === "job",
      )?.href,
    ).toBe("/jobs/new");
  });

  it("makes only the list page's own item the accent pill", () => {
    expect(primary("/leads")).toEqual(["lead"]);
    expect(primary("/jobs")).toEqual(["job"]);
    expect(primary("/schedule")).toEqual(["job"]);
    expect(primary("/customers")).toEqual(["customer"]);
    expect(primary("/estimates", createItemsFor(ALL, {}, "estimate"))).toEqual([
      "estimate",
    ]);
    // Detail screens and Today keep their own primary action.
    expect(primary("/leads/0b9a")).toEqual([]);
    expect(primary(`/customers/${CUSTOMER}`)).toEqual([]);
    expect(primary("/today")).toEqual([]);
    expect(primary("/dispatch")).toEqual([]);
  });
});
