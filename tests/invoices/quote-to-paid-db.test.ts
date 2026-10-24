// Quote to Paid, Part I (invoice screen, getting paid, sending, receipts, photos,
// preview, "invoice viewed") on a throwaway PGlite (TEST_PGLITE_ROOT):
// - I2: "Get paid" on a draft issues it in the same transaction (via "collect"), is
//   idempotent on the clientId (offline replays), never also texts the invoice, and
//   an empty draft has nothing to collect (not "paid in full").
// - I3: the receipt in the app, sent by text or email, a reused share link, and the
//   automatic receipt's status.
// - I4: Send says what happened; the text card goes to the sender's own outbox only
//   inside their contact window (else the office sends it and the number stays
//   hidden); a draft is issued first (via "send").
// - I5: only this job's live invoice photos go on an invoice; none picked = none.
// - I6: one reused preview link per invoice; only staff preview.
// - I7: the customer's first view emits invoice.viewed once; drafts never count.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-q2p-i-"),
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

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  customers,
  invoices,
  jobAssignments,
  jobs,
  lineItems,
  media,
  payments,
  properties,
  publicTokens,
  scheduledMessages,
} from "@/db/schema";
import "@/db/seed/register";
import { handlers as automationHandlers } from "@/features/automations/events";
import {
  issueInvoice,
  previewInvoice,
  sendInvoice,
  setInvoicePhotos,
} from "@/features/invoices/actions";
import { invoicePhotoLabel } from "@/features/invoices/photo-labels";
import { describeSend } from "@/features/invoices/screen-copy";
import {
  invoicePreviewer,
  markInvoiceViewed,
} from "@/features/invoices/viewed";
import { invoicePhotoState } from "@/features/media/api";
import {
  createPayLink,
  loadCollectContext,
  loadReceipt,
  receiptLink,
  receiptStatus,
  recordManualPayment,
  sendReceipt,
} from "@/features/payments/actions";
import { nothingDueMessage } from "@/features/payments/collect-copy";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type Actor, type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let tech: SessionUser;
let customerId = "";
let propertyId = "";
let n = 0;

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

/** A completed job for the tech with a DRAFT invoice (one $total line, or none). */
async function draftJob(total: number | null): Promise<{
  jobId: string;
  invoiceId: string;
  number: string;
}> {
  n++;
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-Q${n}`,
      customerId,
      propertyId,
      title: `Rekey ${n}`,
      status: "completed",
      completedAt: new Date(),
    })
    .returning({ id: jobs.id });
  if (!j) throw new Error("job");
  await db.insert(jobAssignments).values({
    jobId: j.id,
    userId: tech.id,
    role: "primary",
    splitBps: 10000,
  });
  const number = `INV-Q${n}`;
  const [inv] = await db
    .insert(invoices)
    .values({
      number,
      customerId,
      jobId: j.id,
      propertyId,
      status: "draft",
      subtotalCents: total ?? 0,
      totalCents: total ?? 0,
    })
    .returning({ id: invoices.id });
  if (!inv) throw new Error("invoice");
  if (total != null)
    await db.insert(lineItems).values({
      parentType: "invoice",
      parentId: inv.id,
      type: "service",
      name: "Rekey",
      qty: 1,
      unitPriceCents: total,
      totalCents: total,
      taxable: false,
    });
  return { jobId: j.id, invoiceId: inv.id, number };
}

const cash = (
  i: { jobId: string; invoiceId: string },
  amount: number,
  extra: Record<string, unknown> = {},
) => ({
  clientId: randomUUID(),
  clientTs: new Date().toISOString(),
  jobId: i.jobId,
  invoiceId: i.invoiceId,
  customerId,
  kind: "payment" as const,
  method: "cash" as const,
  amountCents: amount,
  tipCents: 0,
  ...extra,
});

const invoiceRow = async (id: string) =>
  (await db.select().from(invoices).where(eq(invoices.id, id)))[0];

const issuedEvents = (invoiceId: string) =>
  execRows<{ via: string }>(
    sql`select payload->>'via' as via from events where type = 'invoice.issued' and entity_id = ${invoiceId}`,
  );

/** Run the automations '*' engine for the latest event of a type for an entity. */
async function runEngineFor(type: string, entityId: string) {
  const [ev] = await execRows<{
    id: number;
    type: string;
    entity_type: string | null;
    entity_id: string | null;
    payload: Record<string, unknown>;
    actor_user_id: string | null;
    created_at: string;
  }>(
    sql`select id, type, entity_type, entity_id, payload, actor_user_id, created_at from events where type = ${type} and entity_id = ${entityId} order by id desc limit 1`,
  );
  if (!ev) throw new Error(`no ${type} event`);
  const h = automationHandlers.find((x) => x.name === "automations.engine");
  if (!h) throw new Error("engine handler");
  await db.transaction((tx) =>
    h.run(
      {
        id: ev.id,
        type: ev.type,
        entity: { type: ev.entity_type, id: ev.entity_id },
        payload: ev.payload,
        actorUserId: ev.actor_user_id,
        createdAt: new Date(ev.created_at),
      } as never,
      { tx, now: new Date() },
    ),
  );
}

const invoiceTexts = (invoiceId: string) =>
  db
    .select({ id: scheduledMessages.id })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.entityId, invoiceId),
        eq(scheduledMessages.templateKey, "invoice.sent"),
      ),
    );

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Quote to Paid Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(
    s.userId,
    s.session?.sessionId as string,
  )) as SessionUser;
  tech = await invite("Derek Novak", "derek@example.com");
  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Sophia Taylor",
      firstName: "Sophia",
      phone: "+13035550117",
      email: "sophia@example.com",
    } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "8106 S Monaco Pkwy",
      city: "Denver",
      state: "CO",
      zip: "80224",
    })
    .returning({ id: properties.id });
  propertyId = p?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("I2 Get paid on a draft", () => {
  it("records the payment and issues the draft in one go (via collect)", async () => {
    const d = await draftJob(14_036);
    auth.user = tech;
    const r = await recordManualPayment(cash(d, 14_036, { issueDraft: true }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const inv = await invoiceRow(d.invoiceId);
    expect(inv?.status).toBe("paid");
    expect(inv?.issuedAt).toBeTruthy();
    expect((await issuedEvents(d.invoiceId)).map((e) => e.via)).toEqual([
      "collect",
    ]);
    const pays = await db
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, d.invoiceId));
    expect(pays).toHaveLength(1);
    expect(pays[0]?.amountCents).toBe(14_036);
  });

  it("a replay with the same clientId (offline outbox) changes nothing", async () => {
    const d = await draftJob(20_000);
    auth.user = tech;
    const input = cash(d, 5_000, { issueDraft: true });
    const a = await recordManualPayment(input);
    const b = await recordManualPayment(input);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.data?.paymentId).toBe(a.data?.paymentId);
    expect(await issuedEvents(d.invoiceId)).toHaveLength(1);
    const pays = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.invoiceId, d.invoiceId));
    expect(pays).toHaveLength(1);
    expect((await invoiceRow(d.invoiceId))?.status).toBe("partially_paid");
  });

  it("never also texts the invoice (invoice_sent runs for a manual issue only)", async () => {
    const collected = await draftJob(9_000);
    auth.user = tech;
    expect(
      (await recordManualPayment(cash(collected, 9_000, { issueDraft: true })))
        .ok,
    ).toBe(true);
    await runEngineFor("invoice.issued", collected.invoiceId);
    expect(await invoiceTexts(collected.invoiceId)).toHaveLength(0);

    const manual = await draftJob(9_000);
    auth.user = admin;
    expect((await issueInvoice({ invoiceId: manual.invoiceId })).ok).toBe(true);
    expect((await issuedEvents(manual.invoiceId)).map((e) => e.via)).toEqual([
      "manual",
    ]);
    await runEngineFor("invoice.issued", manual.invoiceId);
    expect(await invoiceTexts(manual.invoiceId)).toHaveLength(1);
  });

  it("needs permission to issue invoices; nothing is recorded without it", async () => {
    const d = await draftJob(7_500);
    auth.user = {
      ...tech,
      perms: new Set([...tech.perms].filter((p) => p !== "invoices.create")),
    } as SessionUser;
    const r = await recordManualPayment(cash(d, 7_500, { issueDraft: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/issu/i);
    expect((await invoiceRow(d.invoiceId))?.status).toBe("draft");
    expect(
      await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.invoiceId, d.invoiceId)),
    ).toHaveLength(0);
  });

  it("a card pay link on a draft issues it first only when asked", async () => {
    const d = await draftJob(12_000);
    auth.user = tech;
    const refused = await createPayLink({ invoiceId: d.invoiceId });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe("Issue the invoice first.");
    const r = await createPayLink({ invoiceId: d.invoiceId, issueDraft: true });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (r.ok) expect(r.data?.url).toMatch(/\/p\//);
    expect((await invoiceRow(d.invoiceId))?.status).toBe("issued");
    expect((await issuedEvents(d.invoiceId)).map((e) => e.via)).toEqual([
      "collect",
    ]);
  });

  it("an empty draft has nothing to collect yet (not 'paid in full')", async () => {
    const d = await draftJob(null);
    auth.user = tech;
    const r = await loadCollectContext({ invoiceId: d.invoiceId });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.invoiceHasLines).toBe(false);
    expect(r.data.balanceCents).toBe(0);
    expect(r.data.issuesDraft).toBe(true);
    expect(nothingDueMessage(r.data)).toBe(
      `Nothing to collect yet. Add items to ${d.number} first.`,
    );
  });
});

describe("I4 Sending says what happened", () => {
  it("Send on a draft issues it (via send); the text waits in the sender's outbox", async () => {
    const d = await draftJob(45_073);
    auth.user = admin;
    const r = await sendInvoice({
      invoiceId: d.invoiceId,
      channel: "sms",
      clientId: randomUUID(),
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.issued).toBe(true);
    expect(r.data.outcome.status).toBe("pending_tap");
    expect(r.data.outcome.mine).toBe(true);
    expect(r.data.outcome.rawTo).toBe("+13035550117");
    expect(r.data.outcome.to).toBe("(303) 555-0117");
    expect(r.data.outcome.body).toContain(d.number);
    const [row] = await db
      .select({ assigned: scheduledMessages.assignedUserId })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, r.data.outcome.scheduledMessageId));
    expect(row?.assigned).toBe(admin.id);
    expect((await issuedEvents(d.invoiceId)).map((e) => e.via)).toEqual([
      "send",
    ]);
    // The person sent it: the automation doesn't text it a second time.
    await runEngineFor("invoice.issued", d.invoiceId);
    expect(await invoiceTexts(d.invoiceId)).toHaveLength(1);
    expect(describeSend(r.data.outcome, { firstName: "Sophia" }).title).toBe(
      "Ready to text",
    );
  });

  it("outside the contact window the office sends it and the number stays hidden", async () => {
    const d = await draftJob(10_000);
    auth.user = tech; // unscheduled job: no contact window
    const r = await sendInvoice({
      invoiceId: d.invoiceId,
      channel: "sms",
      clientId: randomUUID(),
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.outcome.status).toBe("pending_tap");
    expect(r.data.outcome.mine).toBe(false);
    expect(r.data.outcome.rawTo).toBeNull();
    expect(r.data.outcome.body).toBeNull();
    expect(r.data.outcome.to).toBe("•••• 0117");
    const [row] = await db
      .select({ assigned: scheduledMessages.assignedUserId })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, r.data.outcome.scheduledMessageId));
    expect(row?.assigned).toBeNull();
    expect(describeSend(r.data.outcome, { firstName: "Sophia" }).title).toBe(
      "Waiting in the office outbox",
    );
  });

  it("email says where it went; one clientId sends once", async () => {
    const d = await draftJob(10_000);
    auth.user = admin;
    const clientId = randomUUID();
    const a = await sendInvoice({
      invoiceId: d.invoiceId,
      channel: "email",
      clientId,
    });
    const b = await sendInvoice({
      invoiceId: d.invoiceId,
      channel: "email",
      clientId,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !a.data) return;
    expect(a.data.outcome.channel).toBe("email");
    expect(a.data.outcome.to).toBe("sophia@example.com");
    expect(describeSend(a.data.outcome, { firstName: "Sophia" }).title).toBe(
      "Emailed to sophia@example.com",
    );
    const rows = await db
      .select({ id: scheduledMessages.id })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.dedupeKey, `manual:${clientId}`));
    expect(rows).toHaveLength(1);
  });

  it("opted out of texts: Not sent, and says why", async () => {
    const d = await draftJob(10_000);
    await db
      .update(customers)
      .set({ smsStatus: "opted_out" })
      .where(eq(customers.id, customerId));
    try {
      auth.user = admin;
      const r = await sendInvoice({
        invoiceId: d.invoiceId,
        channel: "sms",
        clientId: randomUUID(),
      });
      expect(r.ok).toBe(true);
      if (!r.ok || !r.data) return;
      expect(r.data.outcome.status).toBe("suppressed_optout");
      const copy = describeSend(r.data.outcome, { firstName: "Sophia" });
      expect(copy.title).toBe("Not sent");
      expect(copy.detail).toBe("Sophia opted out of texts. Try email.");
    } finally {
      await db
        .update(customers)
        .set({ smsStatus: "unknown" })
        .where(eq(customers.id, customerId));
    }
  });
});

describe("I3 Receipts in the app", () => {
  it("loads the receipt with the invoice's payments, sends it, reuses its link", async () => {
    const d = await draftJob(30_000);
    auth.user = tech;
    const first = await recordManualPayment(
      cash(d, 10_000, { issueDraft: true }),
    );
    const second = await recordManualPayment(
      cash(d, 20_000, { tipCents: 3_000 }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok || !second.data) return;
    const paymentId = second.data.paymentId;

    const r = await loadReceipt({ paymentId });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.amountCents).toBe(20_000);
    expect(r.data.tipCents).toBe(3_000);
    expect(r.data.methodLabel).toBe("Cash");
    expect(r.data.invoiceStatus).toBe("paid");
    expect(r.data.remainingBalanceCents).toBe(0);
    expect(r.data.invoicePayments.map((p) => [p.label, p.cents])).toEqual([
      ["Payment", 10_000],
      ["This payment", 23_000],
    ]);

    auth.user = admin;
    const sent = await sendReceipt({
      paymentId,
      channel: "email",
      clientId: randomUUID(),
    });
    expect(sent.ok, sent.ok ? "" : sent.error).toBe(true);
    if (sent.ok)
      expect(sent.data?.outcome).toMatchObject({
        channel: "email",
        to: "sophia@example.com",
      });

    const l1 = await receiptLink({ paymentId });
    const l2 = await receiptLink({ paymentId });
    expect(l1.ok && l2.ok).toBe(true);
    if (l1.ok && l2.ok) {
      expect(l1.data?.url).toBe(l2.data?.url);
      expect(l1.data?.url).toMatch(new RegExp(`/i/.+\\?receipt=${paymentId}$`));
    }
  });

  it("reports the automatic receipt once the automation queued it", async () => {
    const d = await draftJob(8_000);
    auth.user = tech;
    const r = await recordManualPayment(cash(d, 8_000, { issueDraft: true }));
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    const paymentId = r.data.paymentId;
    const before = await receiptStatus({ paymentId });
    expect(before.ok && before.data).toEqual([]);
    await runEngineFor("payment.succeeded", paymentId);
    auth.user = admin;
    const after = await receiptStatus({ paymentId });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.data?.map((a) => a.channel)).toContain("email");
  });
});

describe("I5 Invoice photos", () => {
  async function photo(jobId: string, tag: string) {
    n++;
    const [m] = await db
      .insert(media)
      .values({
        kind: "photo",
        tag,
        jobId,
        customerId,
        storageKey: `test/photo-${n}.jpg`,
        mime: "image/jpeg",
      } as never)
      .returning({ id: media.id });
    return m?.id as string;
  }

  it("keeps only this job's live invoice photos; none picked means none shown", async () => {
    const d = await draftJob(5_000);
    const other = await draftJob(5_000);
    const before = await photo(d.jobId, "problem");
    const after = await photo(d.jobId, "after");
    const goal = await photo(d.jobId, "goal");
    const foreign = await photo(other.jobId, "after");
    auth.user = tech;
    const r = await setInvoicePhotos({
      invoiceId: d.invoiceId,
      showPhotos: true,
      photoMediaIds: [goal, after, foreign, before],
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const inv = await invoiceRow(d.invoiceId);
    expect(inv?.photoMediaIds).toEqual([after, before]);
    expect(inv?.showPhotos).toBe(true);

    const state = await invoicePhotoState(d.invoiceId);
    expect(state.blocked).toBeNull();
    expect(state.photos.map((p) => p.id)).toEqual([after, before]);
    expect(state.photos.map((p) => invoicePhotoLabel(p.tag))).toEqual([
      "After",
      "Before",
    ]);
    // The goal photo is an estimate's: not even counted as pickable.
    expect(state.available).toBe(2);

    const none = await setInvoicePhotos({
      invoiceId: d.invoiceId,
      showPhotos: false,
      photoMediaIds: [],
    });
    expect(none.ok).toBe(true);
    expect((await invoiceRow(d.invoiceId))?.showPhotos).toBe(false);
    expect((await invoicePhotoState(d.invoiceId)).photos).toEqual([]);
  });
});

describe("I6 Preview as the customer", () => {
  it("reuses one preview link per invoice, and only staff preview", async () => {
    const d = await draftJob(5_000);
    auth.user = tech;
    const a = await previewInvoice({ invoiceId: d.invoiceId });
    const b = await previewInvoice({ invoiceId: d.invoiceId });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok || !a.data) return;
    expect(a.data.href).toBe(b.data?.href);
    expect(a.data.href).toMatch(/^\/i\/[A-Za-z0-9_-]+\?preview=1$/);
    const token = a.data.href.slice(3, a.data.href.indexOf("?"));
    const tokens = await db
      .select({ id: publicTokens.id })
      .from(publicTokens)
      .where(eq(publicTokens.entityId, d.invoiceId));
    expect(tokens).toHaveLength(1);

    const p = await invoicePreviewer(token);
    expect(p?.tok.entityId).toBe(d.invoiceId);
    expect(p?.name).toBe("Derek Novak");
    auth.user = null;
    expect(await invoicePreviewer(token)).toBeNull();
  });
});

describe("I7 Invoice viewed", () => {
  const actor: Actor = { kind: "public_token", userId: null };

  it("the customer's first view of an issued invoice is told once", async () => {
    const d = await draftJob(5_000);
    auth.user = admin;
    expect((await issueInvoice({ invoiceId: d.invoiceId })).ok).toBe(true);
    const tokenId = randomUUID();
    const first = await db.transaction((tx) =>
      markInvoiceViewed(tx, d.invoiceId, tokenId, actor),
    );
    const again = await db.transaction((tx) =>
      markInvoiceViewed(tx, d.invoiceId, tokenId, actor),
    );
    expect([first, again]).toEqual([true, false]);
    const evts = await execRows<{ invoice_id: string; token_id: string }>(
      sql`select payload->>'invoice_id' as invoice_id, payload->>'token_id' as token_id from events where type = 'invoice.viewed' and entity_id = ${d.invoiceId}`,
    );
    expect(evts).toEqual([{ invoice_id: d.invoiceId, token_id: tokenId }]);
    const acts = await execRows<{ summary: string }>(
      sql`select summary from activity where kind = 'invoice.viewed' and entity_id = ${d.invoiceId}`,
    );
    expect(acts.map((a) => a.summary)).toEqual([
      `Customer opened invoice ${d.number}`,
    ]);
  });

  it("a draft never counts", async () => {
    const d = await draftJob(5_000);
    const r = await db.transaction((tx) =>
      markInvoiceViewed(tx, d.invoiceId, randomUUID(), actor),
    );
    expect(r).toBe(false);
  });
});
