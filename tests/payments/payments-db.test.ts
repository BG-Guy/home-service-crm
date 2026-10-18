// B4 integration (QA round 2) on a throwaway PGlite (TEST_PGLITE_ROOT, default OS temp):
// - T5-02 / T5-03: recordManualPayment and loadCollectContext bind every id to the
//   viewer's scope (no pairing your own job with someone else's invoice/deposit/customer).
// - T6-01: checkout.session.completed before payment_intent.succeeded books the tip as
//   tip (not invoice payment), never overpays, and the later PI fills the card snapshot.
// - Partial refunds: a processor-side partial refund keeps a paid invoice paid (credit
//   note); a full refund still re-opens it.
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b4-test-"),
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
  invoices,
  jobAssignments,
  jobs,
  lineItems,
  payments,
  properties,
} from "@/db/schema";
import "@/db/seed/register";
import {
  loadCollectContext,
  recordManualPayment,
} from "@/features/payments/actions";
import { getInvoiceBalance } from "@/features/payments/api";
import { handlers as paymentHandlers } from "@/features/payments/events";
import { partialRefundCreditCents } from "@/features/payments/provider-events";
import { ingestStripeWebhook } from "@/features/payments/webhook";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
const WHSEC = "whsec_test";
let admin: SessionUser;
let tech1: SessionUser;
let tech2: SessionUser;
let customerA = "";
let customerB = "";
let propertyA = "";
let propertyB = "";
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

/** A job for `tech` with an issued invoice of `total` (one service line). */
async function jobWithInvoice(i: {
  tech: SessionUser;
  customerId: string;
  propertyId: string;
  total: number;
  status?: string;
}): Promise<{ jobId: string; invoiceId: string }> {
  n++;
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-B4-${n}`,
      customerId: i.customerId,
      propertyId: i.propertyId,
      title: `B4 job ${n}`,
      status: i.status ?? "completed",
      completedAt: new Date(),
    })
    .returning({ id: jobs.id });
  if (!j) throw new Error("job");
  await db.insert(jobAssignments).values({
    jobId: j.id,
    userId: i.tech.id,
    role: "primary",
    splitBps: 10000,
  });
  const [inv] = await db
    .insert(invoices)
    .values({
      number: `INV-B4-${n}`,
      customerId: i.customerId,
      jobId: j.id,
      status: "issued",
      subtotalCents: i.total,
      totalCents: i.total,
      issuedAt: new Date(),
    })
    .returning({ id: invoices.id });
  if (!inv) throw new Error("invoice");
  await db.insert(lineItems).values({
    parentType: "invoice",
    parentId: inv.id,
    type: "service",
    name: "Service",
    qty: 1,
    unitPriceCents: i.total,
    totalCents: i.total,
    taxable: false,
  });
  return { jobId: j.id, invoiceId: inv.id };
}

let tick = 1_792_237_800;
async function deliver(evt: Record<string, unknown>) {
  const raw = JSON.stringify(evt);
  const t = ++tick;
  const sig = createHmac("sha256", WHSEC).update(`${t}.${raw}`).digest("hex");
  return ingestStripeWebhook(raw, `t=${t},v1=${sig}`, {
    secret: WHSEC,
    nowSec: t,
  });
}

const paymentByRef = async (ref: string) =>
  db.select().from(payments).where(eq(payments.providerRef, ref));

const succeededEvents = async (paymentId: string) =>
  Number(
    (
      await execRows<{ n: number }>(
        sql`select count(*)::int as n from events where type = 'payment.succeeded' and payload->>'payment_id' = ${paymentId}`,
      )
    )[0]?.n ?? 0,
  );

const invoiceStatus = async (id: string) =>
  (
    await db
      .select({ s: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, id))
  )[0]?.s;

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "B4 Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  tech1 = await invite("Tom Tech", "tom@example.com");
  tech2 = await invite("Tina Tech", "tina@example.com");
  const [a] = await db
    .insert(customers)
    .values({ displayName: "Pat Customer", firstName: "Pat" } as never)
    .returning({ id: customers.id });
  const [b] = await db
    .insert(customers)
    .values({ displayName: "Riley Other", firstName: "Riley" } as never)
    .returning({ id: customers.id });
  customerA = a?.id as string;
  customerB = b?.id as string;
  const [pa] = await db
    .insert(properties)
    .values({
      customerId: customerA,
      street: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    })
    .returning({ id: properties.id });
  const [pb] = await db
    .insert(properties)
    .values({
      customerId: customerB,
      street: "9 Elm St",
      city: "Austin",
      state: "TX",
      zip: "78702",
    })
    .returning({ id: properties.id });
  propertyA = pa?.id as string;
  propertyB = pb?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("T5-02 recordManualPayment binds ids to the viewer's scope", () => {
  let own: { jobId: string; invoiceId: string };
  let other: { jobId: string; invoiceId: string };
  let otherDeposit = "";

  beforeAll(async () => {
    own = await jobWithInvoice({
      tech: tech1,
      customerId: customerA,
      propertyId: propertyA,
      total: 20000,
    });
    other = await jobWithInvoice({
      tech: tech2,
      customerId: customerB,
      propertyId: propertyB,
      total: 30000,
      status: "scheduled",
    });
    const [d] = await db
      .insert(depositRequests)
      .values({
        jobId: other.jobId,
        amountCents: 5000,
        mode: "manual",
        status: "requested",
      })
      .returning({ id: depositRequests.id });
    otherDeposit = d?.id as string;
  });

  const cash = (extra: Record<string, unknown>) =>
    recordManualPayment({
      method: "cash",
      amountCents: 1000,
      clientId: randomUUID(),
      ...extra,
    } as never);

  it("rejects the tech's own job paired with another tech's invoice", async () => {
    auth.user = tech1;
    const r = await cash({ jobId: own.jobId, invoiceId: other.invoiceId });
    expect(r.ok).toBe(false);
  });

  it("rejects the tech's own job paired with another job's deposit", async () => {
    auth.user = tech1;
    const r = await cash({
      jobId: own.jobId,
      depositRequestId: otherDeposit,
      kind: "deposit",
    });
    expect(r.ok).toBe(false);
    const r2 = await cash({ depositRequestId: otherDeposit, kind: "deposit" });
    expect(r2.ok).toBe(false);
    const [d] = await db
      .select({ status: depositRequests.status })
      .from(depositRequests)
      .where(eq(depositRequests.id, otherDeposit));
    expect(d?.status).toBe("requested");
  });

  it("rejects a customer-only payment for a customer outside the tech's scope", async () => {
    auth.user = tech1;
    expect((await cash({ customerId: customerB })).ok).toBe(false);
  });

  it("rejects the tech's own job paired with another customer", async () => {
    auth.user = tech1;
    expect((await cash({ jobId: own.jobId, customerId: customerB })).ok).toBe(
      false,
    );
  });

  it("no payment rows were written by the rejected attempts", async () => {
    const rows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.customerId, customerB));
    expect(rows).toHaveLength(0);
  });

  it("still records on the tech's own job and invoice", async () => {
    auth.user = tech1;
    const r = await cash({ jobId: own.jobId, invoiceId: own.invoiceId });
    expect(r.ok).toBe(true);
    const bal = await getInvoiceBalance(own.invoiceId);
    expect(bal.paidCents).toBe(1000);
  });

  it("an office check has no field collector (no 'paid to <office user>')", async () => {
    auth.user = admin;
    const clientId = randomUUID();
    const r = await recordManualPayment({
      invoiceId: own.invoiceId,
      method: "check",
      amountCents: 2000,
      reference: "1001",
      clientId,
    } as never);
    expect(r.ok).toBe(true);
    const [p] = await db
      .select({ by: payments.collectedByUserId })
      .from(payments)
      .where(eq(payments.clientId, clientId));
    expect(p?.by).toBeNull();
  });

  it("T5-03: loadCollectContext rejects own job + someone else's invoice", async () => {
    auth.user = tech1;
    const bad = await loadCollectContext({
      jobId: own.jobId,
      invoiceId: other.invoiceId,
    });
    expect(bad.ok).toBe(false);
    const alone = await loadCollectContext({ invoiceId: other.invoiceId });
    expect(alone.ok).toBe(false);
    const good = await loadCollectContext({ jobId: own.jobId });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.data?.invoiceId).toBe(own.invoiceId);
  });
});

// The T6 tester's signed fixtures (qa2-T6/fx/cs2.json, pi2.json), ids re-pointed.
function cs2(meta: Record<string, string>, ref: string) {
  return {
    id: `evt_cs_${ref}`,
    object: "event",
    type: "checkout.session.completed",
    created: 1792237838,
    data: {
      object: {
        id: `cs_${ref}`,
        object: "checkout.session",
        payment_status: "paid",
        status: "complete",
        amount_total: 13500,
        payment_intent: ref,
        metadata: { ...meta, tip_cents: "1000" },
      },
    },
  };
}
function pi2(meta: Record<string, string>, ref: string) {
  return {
    id: `evt_pi_${ref}`,
    object: "event",
    type: "payment_intent.succeeded",
    created: 1792237838,
    data: {
      object: {
        id: ref,
        object: "payment_intent",
        status: "succeeded",
        amount: 13500,
        amount_received: 13500,
        currency: "usd",
        metadata: { ...meta, tip_cents: "1000" },
        latest_charge: {
          id: `ch_${ref}`,
          created: 1792237838,
          payment_method_details: {
            type: "card",
            card: {
              brand: "visa",
              last4: "1111",
              funding: "debit",
              fingerprint: `fp_${ref}`,
              checks: { cvc_check: "pass" },
            },
          },
        },
      },
    },
  };
}
function refund(ref: string, id: string, amount: number) {
  return {
    id: `evt_${id}`,
    object: "event",
    type: "charge.refunded",
    created: 1792237909,
    data: {
      object: {
        id: `ch_${ref}`,
        object: "charge",
        payment_intent: ref,
        amount: 13500,
        amount_refunded: amount,
        refunds: {
          object: "list",
          data: [
            {
              id,
              object: "refund",
              amount,
              status: "succeeded",
              payment_intent: ref,
            },
          ],
        },
      },
    },
  };
}

describe("T6-01 Stripe event order (checkout session vs payment intent)", () => {
  async function setup() {
    const j = await jobWithInvoice({
      tech: tech1,
      customerId: customerA,
      propertyId: propertyA,
      total: 12500,
    });
    const meta = {
      invoice_id: j.invoiceId,
      job_id: j.jobId,
      customer_id: customerA,
    };
    return { ...j, meta };
  }

  it("session first (unexpanded PI): tip is a tip, invoice exactly paid, PI fills the card", async () => {
    const { invoiceId, meta } = await setup();
    const ref = "pi_t6_002";
    expect((await deliver(cs2(meta, ref))).status).toBe(200);
    let [p] = await paymentByRef(ref);
    expect(p?.amountCents).toBe(12500);
    expect(p?.tipCents).toBe(1000);
    expect(p?.cardLast4).toBeNull();
    let bal = await getInvoiceBalance(invoiceId);
    expect(bal.paidCents).toBe(12500);
    expect(bal.balanceCents).toBe(0);
    expect(await invoiceStatus(invoiceId)).toBe("paid");

    expect((await deliver(pi2(meta, ref))).status).toBe(200);
    const rows = await paymentByRef(ref);
    expect(rows).toHaveLength(1);
    [p] = rows;
    expect(p?.amountCents).toBe(12500);
    expect(p?.tipCents).toBe(1000);
    expect(p?.cardLast4).toBe("1111");
    expect(p?.cardFingerprint).toBe(`fp_${ref}`);
    expect(p?.cardFunding).toBe("debit");
    bal = await getInvoiceBalance(invoiceId);
    expect(bal.paidCents).toBe(12500);
    expect(await succeededEvents(p?.id as string)).toBe(1);
  });

  it("PI first, then the session: same single payment, card kept", async () => {
    const { invoiceId, meta } = await setup();
    const ref = "pi_t6_002b";
    await deliver(pi2(meta, ref));
    await deliver(cs2(meta, ref));
    const rows = await paymentByRef(ref);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountCents).toBe(12500);
    expect(rows[0]?.tipCents).toBe(1000);
    expect(rows[0]?.cardLast4).toBe("1111");
    expect((await getInvoiceBalance(invoiceId)).balanceCents).toBe(0);
    expect(await succeededEvents(rows[0]?.id as string)).toBe(1);
  });

  it("a partial dashboard refund keeps the invoice paid (credit note); a full one re-opens it", async () => {
    const { invoiceId, jobId, meta } = await setup();
    const ref = "pi_t6_refund";
    await deliver(cs2(meta, ref));
    await deliver(pi2(meta, ref));
    await deliver(refund(ref, "re_t6_part", 2000));
    const [p] = await paymentByRef(ref);
    expect(p?.status).toBe("partially_refunded");
    const cns = await db
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.invoiceId, invoiceId));
    expect(cns).toHaveLength(1);
    expect(cns[0]?.amountCents).toBe(2000);
    expect(await invoiceStatus(invoiceId)).toBe("paid");
    expect((await getInvoiceBalance(invoiceId)).balanceCents).toBe(0);
    const [j] = await db
      .select({ ps: jobs.paymentStatus })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(j?.ps).toBe("paid");

    // Redelivery is idempotent: no second credit note.
    await deliver(refund(ref, "re_t6_part", 2000));
    expect(
      await db
        .select({ id: creditNotes.id })
        .from(creditNotes)
        .where(eq(creditNotes.invoiceId, invoiceId)),
    ).toHaveLength(1);

    // Refunding the rest of the base is a full refund: no credit, balance re-opens.
    await deliver(refund(ref, "re_t6_rest", 10500));
    const [p2] = await paymentByRef(ref);
    // The $10 tip is still captured: partially refunded (QA2 money fixer).
    expect(p2?.status).toBe("partially_refunded");
    expect(
      await db
        .select({ id: creditNotes.id })
        .from(creditNotes)
        .where(and(eq(creditNotes.invoiceId, invoiceId))),
    ).toHaveLength(1);
    expect(await invoiceStatus(invoiceId)).not.toBe("paid");
    const reopened = (await getInvoiceBalance(invoiceId)).balanceCents;
    expect(reopened).toBe(10500); // 12500 base back, minus the 2000 credit

    // Integration (invoice_balances, 0003): refunding the tip too never pushes the
    // balance past the invoice amount (refunds come off the base, then the tip).
    await deliver(refund(ref, "re_t6_tip", 1000));
    const bal = await getInvoiceBalance(invoiceId);
    expect(bal.refundedCents).toBe(12500);
    expect(bal.balanceCents).toBe(reopened);
    expect((await paymentByRef(ref))[0]?.status).toBe("refunded");
  });
});

describe("partialRefundCreditCents (pure)", () => {
  const base = {
    paymentAmountCents: 12500,
    invoiceTotalCents: 12500,
    creditedCents: 0,
  };
  it("credits the refunded base on a paid invoice", () => {
    expect(
      partialRefundCreditCents({
        ...base,
        refundCents: 2000,
        refundedTotalCents: 2000,
        balanceAfterCents: 2000,
      }),
    ).toBe(2000);
  });
  it("never credits a full refund of the base", () => {
    expect(
      partialRefundCreditCents({
        ...base,
        refundCents: 12500,
        refundedTotalCents: 12500,
        balanceAfterCents: 12500,
      }),
    ).toBe(0);
  });
  it("doesn't credit when the refund only removed an overpayment", () => {
    expect(
      partialRefundCreditCents({
        ...base,
        paymentAmountCents: 13500,
        refundCents: 1000,
        refundedTotalCents: 1000,
        balanceAfterCents: 0,
      }),
    ).toBe(0);
  });
  it("caps at the uncredited invoice total", () => {
    expect(
      partialRefundCreditCents({
        ...base,
        creditedCents: 11000,
        refundCents: 2000,
        refundedTotalCents: 2000,
        balanceAfterCents: 2000,
      }),
    ).toBe(1500);
  });
});

describe("T6-09 deposit rules re-run when a pre-start job gets its lines", () => {
  const run = async (name: string, payload: Record<string, unknown>) => {
    const h = paymentHandlers.find((x) => x.name === name);
    if (!h) throw new Error(`handler ${name}`);
    await db.transaction((tx) => h.run({ payload } as never, { tx } as never));
  };
  const depositsOf = (jobId: string) =>
    db
      .select({ amount: depositRequests.amountCents })
      .from(depositRequests)
      .where(eq(depositRequests.jobId, jobId));

  beforeAll(async () => {
    await db.insert(depositRules).values({
      name: "Big jobs",
      priority: 1,
      active: true,
      trigger: { type: "estimate_total_gte", value: 50000 },
      amount: { type: "fixed", value: 10000 },
      mode: "manual",
    } as never);
  });

  async function scheduledJobWithoutLines(status: string) {
    n++;
    const [j] = await db
      .insert(jobs)
      .values({
        number: `J-B4-${n}`,
        customerId: customerA,
        propertyId: propertyA,
        title: `B4 job ${n}`,
        status,
        scheduledStart: new Date(Date.now() + 3 * 86_400_000),
      })
      .returning({ id: jobs.id });
    return j?.id as string;
  }
  async function addDraftLines(jobId: string, total: number) {
    n++;
    const [inv] = await db
      .insert(invoices)
      .values({
        number: `INV-B4-${n}`,
        customerId: customerA,
        jobId,
        status: "draft",
        subtotalCents: total,
        totalCents: total,
      })
      .returning({ id: invoices.id });
    await db.insert(lineItems).values({
      parentType: "invoice",
      parentId: inv?.id as string,
      type: "service",
      name: "Garage door",
      qty: 1,
      unitPriceCents: total,
      totalCents: total,
      taxable: false,
    });
    return inv?.id as string;
  }

  it("no lines at scheduling → no deposit; lines + confirm → deposit", async () => {
    const jobId = await scheduledJobWithoutLines("scheduled");
    await run("payments.deposit_on_schedule", { job_id: jobId });
    expect(await depositsOf(jobId)).toHaveLength(0);
    await addDraftLines(jobId, 60000);
    await run("payments.deposit_on_confirmed", {
      job_id: jobId,
      via: "manual",
    });
    const deps = await depositsOf(jobId);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.amount).toBe(10000);
    // Idempotent: a second trigger keeps the one request.
    await run("payments.deposit_on_rescheduled", { job_id: jobId });
    expect(await depositsOf(jobId)).toHaveLength(1);
  });

  it("an invoice issued for a pre-start job re-evaluates; a finished job never asks", async () => {
    const pre = await scheduledJobWithoutLines("confirmed");
    const preInv = await addDraftLines(pre, 70000);
    await run("payments.deposit_on_invoice_issued", { invoice_id: preInv });
    expect(await depositsOf(pre)).toHaveLength(1);
    const done = await scheduledJobWithoutLines("completed");
    const doneInv = await addDraftLines(done, 70000);
    await run("payments.deposit_on_invoice_issued", { invoice_id: doneInv });
    expect(await depositsOf(done)).toHaveLength(0);
  });
});

describe("integration: credit notes, lines_changed, paper pay links", () => {
  it("createCreditNote validates, numbers, audits and caps at the total", async () => {
    const { createCreditNote } = await import("@/features/invoices/api");
    const { invoiceId } = await jobWithInvoice({
      tech: tech1,
      customerId: customerA,
      propertyId: propertyA,
      total: 10000,
    });
    const cn = await db.transaction((tx) =>
      createCreditNote(
        tx,
        { invoiceId, amountCents: 4000, reason: "Goodwill" },
        SYSTEM_ACTOR,
      ),
    );
    expect(cn.number).toMatch(/\S/);
    expect((await getInvoiceBalance(invoiceId)).creditedCents).toBe(4000);
    const audits = await execRows<{ n: number }>(
      sql`select count(*)::int as n from audit_log where action = 'credit_note.created' and entity_id = ${invoiceId}`,
    );
    expect(audits[0]?.n).toBe(1);
    await expect(
      db.transaction((tx) =>
        createCreditNote(
          tx,
          { invoiceId, amountCents: 6001, reason: "Too much" },
          SYSTEM_ACTOR,
        ),
      ),
    ).rejects.toMatchObject({ code: "credit_exceeds_total" });
  });

  it("addJobLine on a pre-start job emits invoice.lines_changed → deposit", async () => {
    const { addJobLine } = await import("@/features/invoices/api");
    n++;
    const [j] = await db
      .insert(jobs)
      .values({
        number: `J-B4-${n}`,
        customerId: customerA,
        propertyId: propertyA,
        title: `B4 job ${n}`,
        status: "scheduled",
        scheduledStart: new Date(Date.now() + 3 * 86_400_000),
      })
      .returning({ id: jobs.id });
    const jobId = j?.id as string;
    await db.transaction((tx) =>
      addJobLine(
        tx,
        jobId,
        {
          type: "service",
          name: "New opener",
          qty: 1,
          unitPriceCents: 80000,
          taxable: false,
        },
        SYSTEM_ACTOR,
      ),
    );
    const evs = await execRows<{ payload: { job_id: string } }>(
      sql`select payload from events where type = 'invoice.lines_changed' and payload->>'job_id' = ${jobId}`,
    );
    expect(evs).toHaveLength(1);
    const h = paymentHandlers.find(
      (x) => x.name === "payments.deposit_on_lines_changed",
    );
    if (!h) throw new Error("handler payments.deposit_on_lines_changed");
    await db.transaction((tx) =>
      h.run({ payload: evs[0]?.payload } as never, { tx } as never),
    );
    const deps = await db
      .select({ id: depositRequests.id })
      .from(depositRequests)
      .where(eq(depositRequests.jobId, jobId));
    expect(deps).toHaveLength(1); // the "Big jobs" rule (≥ $500) from T6-09
  });

  it("the printed invoice's pay QR is one stable link that outlives the paper", async () => {
    const { mintPayLink, paperPayTtlMs } = await import(
      "@/features/portal/links"
    );
    const { invoiceId, jobId } = await jobWithInvoice({
      tech: tech1,
      customerId: customerA,
      propertyId: propertyA,
      total: 9000,
    });
    const dueAt = new Date(Date.now() + 30 * 86_400_000);
    const inv = { id: invoiceId, customerId: customerA, jobId, dueAt };
    const a = await db.transaction((tx) =>
      mintPayLink(tx, inv, { forPaper: true }),
    );
    const b = await db.transaction((tx) =>
      mintPayLink(tx, inv, { forPaper: true }),
    );
    expect(b).toBe(a);
    const rows = await execRows<{ exp: string }>(
      sql`select expires_at as exp from public_tokens where kind = 'pay' and entity_id = ${invoiceId}`,
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]?.exp as string).getTime()).toBeGreaterThanOrEqual(
      dueAt.getTime() + 30 * 86_400_000,
    );
    // A resend (not paper) still mints a fresh link.
    const c = await db.transaction((tx) => mintPayLink(tx, inv));
    expect(c).not.toBe(a);
    // pure: never under the 7-day default; covers due + 30 d
    const now = Date.now();
    expect(paperPayTtlMs(null, now)).toBe(7 * 86_400_000);
    expect(paperPayTtlMs(dueAt, now) / 2).toBeGreaterThanOrEqual(
      dueAt.getTime() + 30 * 86_400_000 - now,
    );
  });
});
