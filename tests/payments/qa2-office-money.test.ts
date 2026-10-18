// Office money chain, QA round 2 verification pass (money fixer), on a throwaway
// PGlite (TEST_PGLITE_ROOT):
// 1. A job booked from a lead with a quoted price, then an approved estimate: the
//    quote placeholder line is REPLACED on the draft invoice (no $250 + $334.54).
//    An issued invoice is never touched.
// 3. "Request deposit" works with a draft invoice; refused once the invoice is issued.
// 4. One office deposit request = one deposit text (the built-in automation skips
//    office requests; a rule-made deposit is still texted now + 24 h).
// 5. The job's Balance card data: Paid (net payments) and Credits apart.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-office-money-"),
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

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  creditNotes,
  customers,
  depositRequests,
  depositRules,
  estimateOptions,
  estimates,
  invoices,
  leads,
  lineItems,
  payments,
  properties,
  scheduledMessages,
} from "@/db/schema";
import "@/db/seed/register";
import { handlers as automationHandlers } from "@/features/automations/events";
import { approveEstimateTx } from "@/features/estimates/api";
import { LEAD_QUOTE_LINE_DESCRIPTION } from "@/features/invoices/lead-quote";
import { createJobAction } from "@/features/jobs/actions";
import { requestDeposit } from "@/features/payments/actions";
import { ensureDepositRequest, recordPayment } from "@/features/payments/api";
import { handlers as paymentHandlers } from "@/features/payments/events";
import { getJobPaymentsPanel } from "@/features/payments/queries";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let customerId = "";
let propertyId = "";
let n = 0;

async function bookFromLead(quotedCents: number): Promise<string> {
  n++;
  const [l] = await db
    .insert(leads)
    .values({
      name: `Eddie ${n}`,
      phone: "+17375553102",
      customerId,
      status: "new",
      quotedPriceCents: quotedCents,
      serviceText: "Installation",
    } as never)
    .returning({ id: leads.id });
  const r = await createJobAction({
    customerId,
    propertyId,
    title: "Installation",
    leadId: l?.id as string,
  } as never);
  if (!r.ok) throw new Error(r.error);
  return (r.data as { jobId: string }).jobId;
}

async function draftInvoiceOf(jobId: string) {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.jobId, jobId));
  const lines = inv
    ? await db
        .select()
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "invoice"),
            eq(lineItems.parentId, inv.id),
          ),
        )
    : [];
  return { inv, lines };
}

/** A sent estimate on the job with one option ($200.00 + $134.54 = $334.54). */
async function sentEstimate(jobId: string) {
  n++;
  const [e] = await db
    .insert(estimates)
    .values({
      number: `EST-OM${n}`,
      jobId,
      customerId,
      propertyId,
      status: "sent",
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    .returning({ id: estimates.id });
  const [o] = await db
    .insert(estimateOptions)
    .values({ estimateId: e?.id as string, label: "Better", recommended: true })
    .returning({ id: estimateOptions.id });
  for (const [name, cents] of [
    ["Smart deadbolt", 20000],
    ["Lock installation", 13454],
  ] as const)
    await db.insert(lineItems).values({
      parentType: "estimate_option",
      parentId: o?.id as string,
      type: "service",
      name,
      qty: 1,
      unitPriceCents: cents,
      totalCents: cents,
      taxable: false,
    });
  return { estimateId: e?.id as string, optionId: o?.id as string };
}

const approve = (estimateId: string, optionId: string) =>
  db.transaction((tx) =>
    approveEstimateTx(
      tx,
      {
        estimateId,
        optionId,
        addonIds: [],
        sign: {
          signerName: "Eddie Embedson",
          signatureMediaId: null,
          channel: "verbal",
          esignConsent: false,
          consentText: "Verbal approval recorded in a test",
        },
      },
      SYSTEM_ACTOR,
    ),
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

const depositTexts = (depositId: string) =>
  db
    .select({
      key: scheduledMessages.dedupeKey,
      sendAt: scheduledMessages.sendAt,
    })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.entityId, depositId),
        eq(scheduledMessages.templateKey, "deposit.request"),
      ),
    );

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Office Money Locks",
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
  auth.user = admin;
  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Eddie Embedson",
      firstName: "Eddie",
      phone: "+17375553102",
      smsStatus: "consented",
    } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "1100 Lavaca St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    })
    .returning({ id: properties.id });
  propertyId = p?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("1: the lead's quoted price is a placeholder an approved estimate replaces", () => {
  it("booking adds the $250 quote line, marked as the placeholder", async () => {
    const jobId = await bookFromLead(25000);
    const { inv, lines } = await draftInvoiceOf(jobId);
    expect(inv?.status).toBe("draft");
    expect(lines.map((l) => [l.name, l.totalCents, l.description])).toEqual([
      ["Installation", 25000, LEAD_QUOTE_LINE_DESCRIPTION],
    ]);
  });

  it("approving the $334.54 estimate replaces it: total $334.54, not $584.54", async () => {
    const jobId = await bookFromLead(25000);
    const { estimateId, optionId } = await sentEstimate(jobId);
    await approve(estimateId, optionId);
    const { inv, lines } = await draftInvoiceOf(jobId);
    expect(inv?.totalCents).toBe(33454);
    expect(lines.map((l) => l.name).sort()).toEqual([
      "Lock installation",
      "Smart deadbolt",
    ]);
    const act = await execRows<{ summary: string }>(
      sql`select summary from activity where kind = 'invoice.line_removed' and entity_id = ${inv?.id as string}`,
    );
    expect(act[0]?.summary).toContain("Quoted price $250.00 replaced");
  });

  it("a quote line someone edited stays; an issued invoice is never touched", async () => {
    const edited = await bookFromLead(18000);
    const before = await draftInvoiceOf(edited);
    await db
      .update(lineItems)
      .set({ description: "Agreed on the phone" })
      .where(eq(lineItems.id, before.lines[0]?.id as string));
    const e1 = await sentEstimate(edited);
    await approve(e1.estimateId, e1.optionId);
    expect((await draftInvoiceOf(edited)).lines).toHaveLength(3);

    const issued = await bookFromLead(18000);
    const { inv } = await draftInvoiceOf(issued);
    await db
      .update(invoices)
      .set({ status: "issued", issuedAt: new Date() })
      .where(eq(invoices.id, inv?.id as string));
    const e2 = await sentEstimate(issued);
    await approve(e2.estimateId, e2.optionId);
    const after = await draftInvoiceOf(issued);
    expect(after.lines.map((l) => l.totalCents)).toEqual([18000]);
    expect(after.inv?.totalCents).toBe(18000);
  });
});

describe("3+4: Request deposit with a draft invoice, one text per request", () => {
  let jobId = "";

  it("a job with only a draft invoice can get a deposit; the office link is the only text", async () => {
    jobId = await bookFromLead(20000); // draft invoice with the quote line
    const r = await requestDeposit({
      jobId,
      amountCents: 7500,
      mode: "manual",
      send: true,
    });
    expect(r.ok).toBe(true);
    const [d] = await db
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.jobId, jobId));
    expect(d?.status).toBe("requested");
    const [ev] = await execRows<{ payload: { office_request?: boolean } }>(
      sql`select payload from events where type = 'deposit.required' and entity_id = ${d?.id as string}`,
    );
    expect(ev?.payload.office_request).toBe(true);
    // The built-in deposit_request automation sees the event and skips it.
    await runEngineFor("deposit.required", d?.id as string);
    const texts = await depositTexts(d?.id as string);
    expect(texts).toHaveLength(1);
    expect(texts[0]?.key).toMatch(/^deposit_link:/);
  });

  it("refused once the invoice is issued (collect the balance instead)", async () => {
    const issuedJob = await bookFromLead(20000);
    const { inv } = await draftInvoiceOf(issuedJob);
    await db
      .update(invoices)
      .set({ status: "issued", issuedAt: new Date() })
      .where(eq(invoices.id, inv?.id as string));
    const r = await requestDeposit({
      jobId: issuedJob,
      amountCents: 5000,
      mode: "manual",
      send: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("already issued");
  });

  it("a rule-made deposit is still texted by the automation (now + 24 h)", async () => {
    await db.insert(depositRules).values({
      name: "Everyone",
      priority: 1,
      active: true,
      trigger: { type: "always" },
      amount: { type: "fixed", value: 5000 },
      mode: "manual",
    } as never);
    const ruleJob = await bookFromLead(20000);
    const brief = await db.transaction((tx) =>
      ensureDepositRequest(
        tx,
        { jobId: ruleJob, context: "job_scheduled" },
        SYSTEM_ACTOR,
      ),
    );
    expect(brief).toBeTruthy();
    const [d] = await db
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.jobId, ruleJob));
    await runEngineFor("deposit.required", d?.id as string);
    const texts = await depositTexts(d?.id as string);
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => t.key.startsWith("auto:deposit_request:"))).toBe(
      true,
    );
    await db.update(depositRules).set({ active: false });
  });
});

describe("5: Balance card shows Paid and Credits apart", () => {
  it("$334.54 invoice, $150 paid, $20 credit → paid 150.00, credits 20.00, balance 164.54", async () => {
    const jobId = await bookFromLead(33454);
    const { inv } = await draftInvoiceOf(jobId);
    const invoiceId = inv?.id as string;
    await db
      .update(invoices)
      .set({ status: "partially_paid", issuedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await db.insert(payments).values({
      invoiceId,
      jobId,
      customerId,
      kind: "payment",
      method: "check",
      provider: "manual",
      status: "succeeded",
      amountCents: 15000,
      tipCents: 0,
      succeededAt: new Date(),
    });
    await db.insert(creditNotes).values({
      number: "CN-OM1",
      invoiceId,
      amountCents: 2000,
      reason: "Goodwill for the delay",
    });
    const data = await getJobPaymentsPanel(jobId, admin);
    expect(data.invoice).toMatchObject({
      totalCents: 33454,
      paidNetCents: 15000,
      creditedCents: 2000,
      balanceCents: 16454,
    });
  });
});

// QA2 re-check (J-1091): a $50 deposit asked for by hand stayed "Deposit required" and
// its deposit.request text stayed in the outbox after $150 of invoice payments.
describe("6: invoice payments that cover an open deposit close it", () => {
  const depositOf = async (jobId: string) =>
    (
      await db
        .select()
        .from(depositRequests)
        .where(eq(depositRequests.jobId, jobId))
    )[0];
  const textsOf = (depositId: string) =>
    db
      .select({
        status: scheduledMessages.status,
        lastError: scheduledMessages.lastError,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.entityId, depositId),
          eq(scheduledMessages.templateKey, "deposit.request"),
        ),
      );
  /** A job with a $50 office deposit request (texted) and an issued invoice. */
  async function jobWithDeposit() {
    const jobId = await bookFromLead(33454);
    const r = await requestDeposit({
      jobId,
      amountCents: 5000,
      mode: "manual",
      send: true,
    });
    expect(r.ok).toBe(true);
    const { inv } = await draftInvoiceOf(jobId);
    await db
      .update(invoices)
      .set({ status: "issued", issuedAt: new Date() })
      .where(eq(invoices.id, inv?.id as string));
    const d = await depositOf(jobId);
    expect(d?.status).toBe("requested");
    expect((await textsOf(d?.id as string)).map((t) => t.status)).not.toContain(
      "canceled",
    );
    return { jobId, invoiceId: inv?.id as string, depositId: d?.id as string };
  }
  const pay = (invoiceId: string, jobId: string, amountCents: number) =>
    db.transaction((tx) =>
      recordPayment(
        tx,
        {
          customerId,
          invoiceId,
          jobId,
          kind: "payment",
          method: "cash",
          amountCents,
          skipRules: true,
        },
        { kind: "user", userId: admin.id },
      ),
    );

  it("stays open while payments are short of it, closes once they cover it", async () => {
    const { jobId, invoiceId, depositId } = await jobWithDeposit();
    await pay(invoiceId, jobId, 3000);
    expect((await depositOf(jobId))?.status).toBe("requested");
    await pay(invoiceId, jobId, 12000);
    const d = await depositOf(jobId);
    expect(d?.status).toBe("waived");
    expect(d?.waivedBy).toBeNull();
    expect(d?.paymentId).toBeNull();
    expect(d?.waiveReason).toMatch(/^covered by \$150\.00 paid on /);
    // Its queued text is canceled with a clear reason; the panel shows no open deposit.
    const texts = await textsOf(depositId);
    expect(texts.length).toBeGreaterThan(0);
    expect(
      texts.every(
        (t) =>
          t.status === "canceled" &&
          t.lastError === "deposit_covered_by_payments",
      ),
    ).toBe(true);
    const panel = await getJobPaymentsPanel(jobId, admin);
    expect(
      panel.deposits.some((x) => ["required", "requested"].includes(x.status)),
    ).toBe(false);
    const audit = await execRows<{ action: string; after: { reason: string } }>(
      sql`select action, after from audit_log where entity_id = ${depositId} and action = 'deposit.satisfied'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after.reason).toBe("covered_by_invoice_payments");
  });

  it("the payment.succeeded handler does it for card / webhook payments (idempotent)", async () => {
    const { jobId, invoiceId } = await jobWithDeposit();
    const [p] = await db
      .insert(payments)
      .values({
        invoiceId,
        jobId,
        customerId,
        kind: "payment",
        method: "card",
        provider: "stripe",
        status: "succeeded",
        amountCents: 6000,
        tipCents: 500,
        succeededAt: new Date(),
      })
      .returning({ id: payments.id });
    const h = paymentHandlers.find(
      (x) => x.name === "payments.deposit_covered_by_payments",
    );
    if (!h) throw new Error("handler");
    const ev = {
      id: 1,
      type: "payment.succeeded",
      entity: { type: "payment", id: p?.id },
      payload: {
        payment_id: p?.id,
        invoice_id: invoiceId,
        job_id: null,
        kind: "payment",
        amount_cents: 6000,
        tip_cents: 500,
      },
      actorUserId: null,
      createdAt: new Date(),
    } as never;
    await db.transaction((tx) => h.run(ev, { tx, now: new Date() } as never));
    await db.transaction((tx) => h.run(ev, { tx, now: new Date() } as never));
    expect((await depositOf(jobId))?.status).toBe("waived");
    const acts = await execRows<{ n: number }>(
      sql`select count(*)::int as n from activity where kind = 'deposit.satisfied' and job_id = ${jobId}`,
    );
    expect(acts[0]?.n).toBe(1);
  });

  it("a deposit that was actually paid is never touched", async () => {
    const jobId = await bookFromLead(33454);
    const r = await requestDeposit({
      jobId,
      amountCents: 5000,
      mode: "manual",
      send: false,
    });
    expect(r.ok).toBe(true);
    const d0 = await depositOf(jobId);
    await db.transaction((tx) =>
      recordPayment(
        tx,
        {
          customerId,
          jobId,
          depositRequestId: d0?.id,
          kind: "deposit",
          method: "cash",
          amountCents: 5000,
          skipRules: true,
        },
        { kind: "user", userId: admin.id },
      ),
    );
    const paid = await depositOf(jobId);
    expect(["paid", "applied"]).toContain(paid?.status);
    const { inv } = await draftInvoiceOf(jobId);
    await db
      .update(invoices)
      .set({ status: "issued", issuedAt: new Date() })
      .where(eq(invoices.id, inv?.id as string));
    await pay(inv?.id as string, jobId, 20000);
    const after = await depositOf(jobId);
    expect(after?.status).toBe(paid?.status);
    expect(after?.paymentId).toBe(paid?.paymentId);
  });
});
