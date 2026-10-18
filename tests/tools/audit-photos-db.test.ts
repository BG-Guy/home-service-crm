// Tool check photos (QA2 NEW-1) on a throwaway PGlite: an audit item only takes a
// photo the auditor uploaded, never someone else's media id.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(
    process.env.TEST_PGLITE_ROOT || os.tmpdir(),
    "crm-tool-audit-test-",
  ),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  const check = async (perm?: string | string[], any = false) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    const list = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
    const ok = any
      ? list.some((p) => auth.user?.perms.has(p as never))
      : list.every((p) => auth.user?.perms.has(p as never));
    if (list.length && !ok) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, list[0]);
    }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string | string[]) => check(perm),
    requireAnyPerm: (perms: string[]) => check(perms, true),
  };
});

import { eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import { media, toolAuditItems, toolAudits, tools } from "@/db/schema";
import "@/db/seed/register";
import { saveAuditItem } from "@/features/tools/actions";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { updateSettings } from "@/lib/settings";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
let tech1: SessionUser;
let tech2: SessionUser;

async function invite(name: string, email: string): Promise<SessionUser> {
  const inv = await db.transaction((tx) =>
    createInvite(tx, { name, email, role: "tech" }, SYSTEM_ACTOR),
  );
  const s = await acceptInvite({
    token: inv.token,
    password: PASSWORD,
    monitoringAck: true,
    esignConsent: true,
  });
  return (await loadSessionUser(s.userId, s.sessionId)) as SessionUser;
}

async function photo(uploaderId: string, auditId: string): Promise<string> {
  const [m] = await db
    .insert(media)
    .values({
      kind: "photo",
      tag: "tool",
      storageKey: `test/${crypto.randomUUID()}.webp`,
      mime: "image/webp",
      uploaderId,
      entityType: "tool_audit",
      entityId: auditId,
    })
    .returning({ id: media.id });
  return m?.id as string;
}

beforeAll(async () => {
  await ensureDb();
  await signup({
    companyName: "Tools Co",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  await db.transaction((tx) =>
    updateSettings(tx, { features: { tools: true } }, SYSTEM_ACTOR),
  );
  tech1 = await invite("Tia Tech", "tia@example.com");
  tech2 = await invite("Max Tech", "max@example.com");
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("tool check photos are the auditor's own (QA2 NEW-1)", () => {
  it("ignores another tech's photo id; keeps the auditor's", async () => {
    const [t] = await db
      .insert(tools)
      .values({ name: "Drill", currentUserId: tech1.id })
      .returning({ id: tools.id });
    const [a] = await db
      .insert(toolAudits)
      .values({ userId: tech1.id, dueOn: "2026-10-20" })
      .returning({ id: toolAudits.id });
    const [item] = await db
      .insert(toolAuditItems)
      .values({ auditId: a?.id as string, toolId: t?.id as string })
      .returning({ id: toolAuditItems.id });
    const itemId = item?.id as string;
    const foreign = await photo(tech2.id, a?.id as string);
    const own = await photo(tech1.id, a?.id as string);

    auth.user = tech1;
    const r1 = await saveAuditItem({
      itemId,
      present: true,
      condition: "good",
      mediaId: foreign,
    });
    expect(r1.ok).toBe(true);
    let [row] = await db
      .select()
      .from(toolAuditItems)
      .where(eq(toolAuditItems.id, itemId));
    expect(row?.mediaId).toBeNull();

    const r2 = await saveAuditItem({
      itemId,
      present: true,
      condition: "good",
      mediaId: own,
    });
    expect(r2.ok).toBe(true);
    [row] = await db
      .select()
      .from(toolAuditItems)
      .where(eq(toolAuditItems.id, itemId));
    expect(row?.mediaId).toBe(own);

    // And tech2 can't save into tech1's check at all.
    auth.user = tech2;
    const r3 = await saveAuditItem({ itemId, present: true, mediaId: foreign });
    expect(r3.ok).toBe(false);
  });
});
