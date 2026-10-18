// Base seed (QA round 2 integration): built-in templates and automations follow the
// shipped catalog while no person has edited them; edited rows are left alone, and
// `default_body` always tracks the catalog so "Reset" restores the newest text.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-base-seed-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { and, eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import { automations, messageTemplates, users } from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import "@/db/seed/register";
import {
  builtinAutomations,
  builtinTemplates,
} from "@/features/automations/builtin";

const autoA = builtinAutomations[0];
const autoB = builtinAutomations[1];
const tplA = builtinTemplates[0];
const tplB = builtinTemplates[1];
let editorId = "";

beforeAll(async () => {
  await ensureDb();
  const [u] = await db
    .insert(users)
    .values({ name: "Ed Editor", email: "ed@example.com", role: "admin" })
    .returning({ id: users.id });
  editorId = u?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

const auto = async (key: string) =>
  (await db.select().from(automations).where(eq(automations.key, key)))[0];
const tplWhere = (t: { key: string; channel: string }) =>
  and(eq(messageTemplates.key, t.key), eq(messageTemplates.channel, t.channel));
const tpl = async (t: { key: string; channel: string }) =>
  (await db.select().from(messageTemplates).where(tplWhere(t)))[0];

describe("base seed built-ins", () => {
  it("an untouched built-in automation is brought back to the catalog", async () => {
    if (!autoA) throw new Error("no built-in automations");
    await db
      .update(automations)
      .set({ steps: [], cancelOn: ["stale"], name: "Old name" })
      .where(eq(automations.key, autoA.key));
    await seedBase(db);
    const row = await auto(autoA.key);
    expect(row?.name).toBe(autoA.name);
    expect(row?.steps).toEqual(autoA.steps);
    expect(row?.cancelOn).toEqual(autoA.cancelOn ?? []);
  });

  it("an automation a person edited is left alone", async () => {
    if (!autoB) throw new Error("need two built-in automations");
    await db
      .update(automations)
      .set({ enabled: !(autoB.enabled ?? true), updatedBy: editorId })
      .where(eq(automations.key, autoB.key));
    await seedBase(db);
    expect((await auto(autoB.key))?.enabled).toBe(!(autoB.enabled ?? true));
  });

  it("untouched templates follow the catalog; edited ones keep their text but get the new default", async () => {
    if (!tplA || !tplB) throw new Error("need two built-in templates");
    await db
      .update(messageTemplates)
      .set({ body: "old", defaultBody: "old" })
      .where(tplWhere(tplA));
    await db
      .update(messageTemplates)
      .set({ body: "mine", defaultBody: "old", updatedBy: editorId })
      .where(tplWhere(tplB));
    await seedBase(db);
    const a = await tpl(tplA);
    expect(a?.body).toBe(tplA.body);
    expect(a?.defaultBody).toBe(tplA.body);
    const b = await tpl(tplB);
    expect(b?.body).toBe("mine");
    expect(b?.defaultBody).toBe(tplB.body);
  });

  it("is a no-op when nothing changed (updated_at untouched)", async () => {
    if (!autoA) throw new Error("no built-in automations");
    const before = (await auto(autoA.key))?.updatedAt?.getTime();
    await seedBase(db);
    expect((await auto(autoA.key))?.updatedAt?.getTime()).toBe(before);
  });
});
