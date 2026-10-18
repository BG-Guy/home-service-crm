// Receipt media binding (QA2 NEW-4) on a throwaway PGlite: a receipt must be the
// submitter's own upload, a receipt or document, and not already on another claim;
// the same file uploaded twice goes to review instead of auto-approving.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-receipts-test-"),
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

import { eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  approvals,
  ledgerEntries,
  media,
  partPurchases,
  users,
} from "@/db/schema";
import "@/db/seed/register";
import { addReceiptPhoto, submitReceipt } from "@/features/parts/actions";
import { createPartPurchase } from "@/features/parts/api";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { dateKey } from "@/lib/time";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let tech1: SessionUser;
let tech2: SessionUser;
const today = () => dateKey(new Date(), TZ);

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

let n = 0;
async function upload(
  uploaderId: string,
  o: {
    kind?: string;
    tag?: string | null;
    sha?: string;
    entity?: { type: string; id: string };
  } = {},
): Promise<string> {
  n++;
  const [m] = await db
    .insert(media)
    .values({
      kind: o.kind ?? "receipt",
      tag: o.tag === undefined ? "receipt" : o.tag,
      storageKey: `test/receipt-${n}.webp`,
      mime: "image/webp",
      uploaderId,
      sha256Original: o.sha ?? n.toString(16).padStart(64, "0"),
      entityType: o.entity?.type ?? null,
      entityId: o.entity?.id ?? null,
    })
    .returning({ id: media.id });
  return m?.id as string;
}

const receipt = (receiptMediaId: string, totalCents = 4321) => ({
  category: "supplies" as const,
  purchasedOn: today(),
  totalCents,
  receiptMediaId,
});

const expenseLines = async (userId: string) =>
  db
    .select()
    .from(ledgerEntries)
    .where(
      sql`${ledgerEntries.userId} = ${userId} and ${ledgerEntries.type} = 'reimbursement_expense'`,
    );

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Receipts Co",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: TZ,
    state: "tx",
  });
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  admin = (await loadSessionUser(u?.id as string, "s")) as SessionUser;
  tech1 = await invite("Tia Tech", "tia@example.com");
  tech2 = await invite("Max Tech", "max@example.com");
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("receipt media is bound to its uploader (QA2 NEW-4)", () => {
  it("refuses another tech's receipt and creates nothing", async () => {
    const theirs = await upload(tech2.id);
    auth.user = tech1;
    const r = await submitReceipt(receipt(theirs));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("accepted");
    expect(r.error).toBe("Use a receipt photo you took yourself.");
    expect(r.fieldErrors?.receiptMediaId).toBeTruthy();
    const rows = await db
      .select()
      .from(partPurchases)
      .where(eq(partPurchases.receiptMediaId, theirs));
    expect(rows).toHaveLength(0);
    const [m] = await db.select().from(media).where(eq(media.id, theirs));
    expect(m?.entityType).toBeNull();
    expect(await expenseLines(tech1.id)).toHaveLength(0);
  });

  it("the owner's own receipt still auto-approves under the limit", async () => {
    const mine = await upload(tech1.id);
    auth.user = tech1;
    const r = await submitReceipt(receipt(mine));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data?.status).toBe("approved");
    const [m] = await db.select().from(media).where(eq(media.id, mine));
    expect(m).toMatchObject({
      entityType: "part_purchase",
      entityId: r.data?.partPurchaseId,
    });
    expect(await expenseLines(tech1.id)).toHaveLength(1);

    // The same media id a second time: refused, still one reimbursement.
    const again = await submitReceipt(receipt(mine));
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("accepted twice");
    expect(again.error).toBe("That receipt is already on another claim.");
    expect(await expenseLines(tech1.id)).toHaveLength(1);
  });

  it("a re-upload of the same file goes to review, not auto-approve", async () => {
    const sha = "ab".repeat(32);
    const first = await upload(tech1.id, { sha });
    const copy = await upload(tech1.id, { sha });
    auth.user = tech1;
    const a = await submitReceipt(receipt(first, 1200));
    expect(a.ok && a.data?.status).toBe("approved");
    const b = await submitReceipt(receipt(copy, 1200));
    expect(b.ok).toBe(true);
    if (!b.ok) throw new Error(b.error);
    expect(b.data?.status).toBe("pending");
    const [ap] = await db
      .select()
      .from(approvals)
      .where(eq(approvals.entityId, b.data?.partPurchaseId as string));
    expect((ap?.evidence as { flags?: string[] } | undefined)?.flags).toContain(
      "duplicate_receipt",
    );
  });

  it("refuses a job photo that isn't a receipt, and someone else's claim", async () => {
    auth.user = tech1;
    const before = await upload(tech1.id, { kind: "photo", tag: "before" });
    const r = await submitReceipt(receipt(before));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("accepted");
    expect(r.error).toBe(
      "That photo isn't a receipt. Take a photo of the receipt.",
    );

    // tech2's receipt already on tech2's own claim: an admin can't re-file it either.
    const theirs = await upload(tech2.id);
    auth.user = tech2;
    const own = await submitReceipt(receipt(theirs));
    expect(own.ok).toBe(true);
    auth.user = admin;
    const reuse = await submitReceipt(receipt(theirs));
    expect(reuse.ok).toBe(false);
  });

  it("staff who approve reimbursements may attach a tech's upload", async () => {
    auth.user = tech2;
    const p = await submitReceipt({
      category: "supplies",
      purchasedOn: today(),
      totalCents: 900,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error(p.error);
    const techPhoto = await upload(tech2.id);
    const otherTech = await upload(tech1.id);
    // tech1 can't attach their own upload to tech2's purchase (not theirs).
    auth.user = tech1;
    const denied = await addReceiptPhoto({
      partPurchaseId: p.data?.partPurchaseId as string,
      mediaId: otherTech,
    });
    expect(denied.ok).toBe(false);
    auth.user = admin;
    expect(admin.perms.has("parts.approve_reimbursement")).toBe(true);
    const ok = await addReceiptPhoto({
      partPurchaseId: p.data?.partPurchaseId as string,
      mediaId: techPhoto,
    });
    expect(ok.ok).toBe(true);
  });

  it("api callers (fuel, tools) keep a planned record's file in place", async () => {
    const fuelId = crypto.randomUUID();
    const m = await upload(tech1.id, {
      kind: "photo",
      tag: "receipt",
      entity: { type: "fuel", id: fuelId },
    });
    const actor = { kind: "user" as const, userId: tech1.id };
    const r = await db.transaction((tx) =>
      createPartPurchase(
        tx,
        {
          paidBy: "tech",
          purchaserUserId: tech1.id,
          category: "fuel",
          purchasedOn: today(),
          totalCents: 3000,
          receiptMediaId: m,
        },
        actor,
      ),
    );
    expect(r.partPurchaseId).toBeTruthy();
    const [row] = await db.select().from(media).where(eq(media.id, m));
    expect(row).toMatchObject({ entityType: "fuel", entityId: fuelId });
    // …and another tech can't route tech1's file through the api either.
    const stolen = await upload(tech1.id);
    await expect(
      db.transaction((tx) =>
        createPartPurchase(
          tx,
          {
            paidBy: "tech",
            purchaserUserId: tech2.id,
            category: "fuel",
            purchasedOn: today(),
            totalCents: 3000,
            receiptMediaId: stolen,
          },
          { kind: "user", userId: tech2.id },
        ),
      ),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
