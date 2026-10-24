// The price-book picker's reads (Quote to Paid E3), on a throwaway PGlite
// (TEST_PGLITE_ROOT): "Recent" = items this user put on their own estimates and
// invoices lately (newest first, no table of its own), the category chips, and
// search within one category.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-picker-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  estimateOptions,
  estimates,
  invoices,
  lineItems,
  pricebookItems,
} from "@/db/schema";
import "@/db/seed/register";
import {
  pricebookCategories,
  recentPricebookItems,
  searchPricebook,
} from "@/features/pricebook/api";
import { signup } from "@/lib/auth/flows";

let me = "";
const ids: Record<string, string> = {};

async function item(name: string, category: string | null, kind = "part") {
  const [r] = await db
    .insert(pricebookItems)
    .values({ kind, name, category, unitPriceCents: 1000 } as never)
    .returning({ id: pricebookItems.id });
  ids[name] = r?.id as string;
}

async function line(
  parentType: "estimate_option" | "invoice",
  parentId: string,
  name: string,
  createdAt: Date,
) {
  await db.insert(lineItems).values({
    parentType,
    parentId,
    type: "part",
    pricebookItemId: ids[name],
    name,
    qty: 1,
    unitPriceCents: 1000,
    totalCents: 1000,
    createdAt,
  });
}

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Picker Locks",
    name: "Pat Tech",
    email: "pat@picker.test",
    password: "tangerine-kayak-41",
    timezone: "America/Denver",
    state: "co",
  });
  me = s.userId;
  for (const [n, c] of [
    ["Grade 1 deadbolt", "Deadbolts"],
    ["Smart lock", "Smart locks"],
    ["Key cut", " keys "],
    ["Rekey", "Keys"],
    ["Retired cylinder", "Deadbolts"],
    ["Someone else's item", null],
  ] as const)
    await item(n, c);
  await db
    .update(pricebookItems)
    .set({ active: false })
    .where(eq(pricebookItems.id, ids["Retired cylinder"] as string));
  const [c] = await db
    .insert(customers)
    .values({ displayName: "Sophia Taylor" } as never)
    .returning({ id: customers.id });
  const customerId = c?.id as string;
  const mkEstimate = async (n: string, createdBy: string | null) => {
    const [e] = await db
      .insert(estimates)
      .values({ number: n, customerId, createdBy })
      .returning({ id: estimates.id });
    const [o] = await db
      .insert(estimateOptions)
      .values({ estimateId: e?.id as string, label: "Good" })
      .returning({ id: estimateOptions.id });
    return o?.id as string;
  };
  const mine = await mkEstimate("EST-P1", me);
  const theirs = await mkEstimate("EST-P2", null);
  const [inv] = await db
    .insert(invoices)
    .values({ number: "INV-P1", customerId, createdBy: me })
    .returning({ id: invoices.id });
  const t = (min: number) => new Date(Date.now() - min * 60_000);
  await line("estimate_option", mine, "Grade 1 deadbolt", t(30));
  await line("estimate_option", mine, "Key cut", t(20));
  await line("estimate_option", mine, "Grade 1 deadbolt", t(5));
  await line("estimate_option", mine, "Retired cylinder", t(4));
  await line("invoice", inv?.id as string, "Smart lock", t(10));
  await line("estimate_option", theirs, "Someone else's item", t(1));
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("price-book picker reads", () => {
  it("Recent: my estimates' and invoices' items, newest first, once each", async () => {
    const recent = await recentPricebookItems(me);
    expect(recent.map((r) => r.name)).toEqual([
      "Grade 1 deadbolt",
      "Smart lock",
      "Key cut",
    ]);
  });

  it("Recent honors the kinds filter", async () => {
    expect(await recentPricebookItems(me, { kinds: ["labor"] })).toEqual([]);
  });

  it("categories: distinct (any case or spacing), active items only, A–Z", async () => {
    expect(await pricebookCategories()).toEqual([
      "Deadbolts",
      "Keys",
      "Smart locks",
    ]);
  });

  it("search within one category", async () => {
    const keys = await searchPricebook("", { category: "keys" });
    expect(keys.map((k) => k.name).sort()).toEqual(["Key cut", "Rekey"]);
    expect(
      (await searchPricebook("re", { category: "Keys" })).map((k) => k.name),
    ).toEqual(["Rekey"]);
  });
});
