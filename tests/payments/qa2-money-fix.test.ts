// Money fixer, QA round 2 verification pass, on a throwaway PGlite (TEST_PGLITE_ROOT):
// 1. Stripe webhook card payment (REAL shape: `latest_charge` is an id string) stores
//    a card fee ESTIMATE, so commission is net of the fee from the start; the
//    `stripe_fee` worker swaps in the actual fee, emits `payment.fee_updated` and
//    payroll recomputes once (no double posting).
// 2. The same worker fills the card snapshot (brand, last4, fingerprint, AVS/CVC, auth
//    code) that real webhooks don't carry.
// 4. A refund that leaves part of the tip captured is `partially_refunded`.
// 5. A rule-made, unpaid deposit is canceled when the job no longer matches any rule
//    (its queued deposit.request texts too); a hand-made one stays.
// 6. Tech daily agenda: a 21:00 run and the 05:15 run schedule ONE agenda.
// 7. Payroll close / settlement review deadline follow the tick's `now`.
// (b) "Refund now" on a card payment without a connected processor answers in plain
//     words (never the env var name) and records nothing.
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-money-fix-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
delete process.env.STRIPE_SECRET_KEY;

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
import { providerErrorMessage } from "@/adapters/payments";
import {
  snapshotFromPaymentIntent,
  stripeProvider,
} from "@/adapters/payments/stripe";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  customers,
  depositRequests,
  depositRules,
  invoices,
  jobAssignments,
  jobs,
  ledgerEntries,
  lineItems,
  payments,
  payPeriods,
  properties,
  scheduledMessages,
  settlements,
} from "@/db/schema";
import "@/db/seed/register";
import { scheduleFixedTime } from "@/features/automations/reminders";
import { refundPayment } from "@/features/payments/actions";
import { fetchStripeFee } from "@/features/payments/background";
import { handlers as paymentHandlers } from "@/features/payments/events";
import { refundedInFull } from "@/features/payments/provider-events";
import { ingestStripeWebhook } from "@/features/payments/webhook";
import { handlers as payrollHandlers } from "@/features/payroll/events";
import { closePayPeriod } from "@/features/payroll/server/settlements";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const PASSWORD = "tangerine-kayak-41";
const WHSEC = "whsec_test";
let adminId = "";
let techId = "";
let customerId = "";
let propertyId = "";
let lastWeekStart = "";
let n = 0;

const at = (day: string, h: number, m = 0) =>
  zonedTimeToUtc({ ...parseDateKey(day), hour: h, minute: m }, TZ);

async function invite(name: string, email: string): Promise<string> {
  const inv = await db.transaction((tx) =>
    createInvite(tx, { name, email, role: "tech" }, SYSTEM_ACTOR),
  );
  const s = await acceptInvite({
    token: inv.token,
    password: PASSWORD,
    monitoringAck: true,
    esignConsent: true,
  });
  return s.userId;
}

/** A completed job (last week) for the tech with an issued invoice of `total`. */
async function completedJob(total: number) {
  n++;
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-MF${n}`,
      customerId,
      propertyId,
      title: `Money fix ${n}`,
      status: "completed",
      completedAt: at(addDaysToKey(lastWeekStart, 2), 11),
      createdAt: at(addDaysToKey(lastWeekStart, 1), 9),
    })
    .returning({ id: jobs.id });
  if (!j) throw new Error("job");
  await db
    .insert(jobAssignments)
    .values({ jobId: j.id, userId: techId, role: "primary", splitBps: 10000 });
  const [inv] = await db
    .insert(invoices)
    .values({
      number: `INV-MF${n}`,
      customerId,
      jobId: j.id,
      status: "issued",
      subtotalCents: total,
      totalCents: total,
      issuedAt: at(addDaysToKey(lastWeekStart, 2), 12),
    })
    .returning({ id: invoices.id });
  if (!inv) throw new Error("invoice");
  await db.insert(lineItems).values({
    parentType: "invoice",
    parentId: inv.id,
    type: "service",
    name: "Service",
    qty: 1,
    unitPriceCents: total,
    totalCents: total,
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

/** `payment_intent.succeeded` exactly as Stripe sends it: latest_charge is an id. */
function piSucceeded(
  ref: string,
  meta: Record<string, string>,
  gross: number,
  tip = 0,
) {
  return {
    id: `evt_${ref}`,
    object: "event",
    type: "payment_intent.succeeded",
    created: 1792237838,
    data: {
      object: {
        id: ref,
        object: "payment_intent",
        status: "succeeded",
        amount: gross,
        amount_received: gross,
        currency: "usd",
        latest_charge: `ch_${ref}`,
        payment_method: `pm_${ref}`,
        metadata: { ...meta, ...(tip ? { tip_cents: String(tip) } : {}) },
      },
    },
  };
}

/** GET /v1/payment_intents/:id?expand[]=latest_charge.balance_transaction */
function expandedPi(ref: string, gross: number, fee: number | null) {
  return {
    id: ref,
    object: "payment_intent",
    status: "succeeded",
    amount: gross,
    amount_received: gross,
    latest_charge: {
      id: `ch_${ref}`,
      object: "charge",
      created: 1792237838,
      authorization_code: "123456",
      billing_details: { name: "Pat Customer" },
      balance_transaction:
        fee == null ? `txn_${ref}` : { id: `txn_${ref}`, fee },
      payment_method_details: {
        type: "card",
        card: {
          brand: "visa",
          last4: "4242",
          funding: "credit",
          country: "US",
          fingerprint: `fp_${ref}`,
          checks: {
            cvc_check: "pass",
            address_postal_code_check: "pass",
          },
        },
      },
    },
  };
}

function chargeRefunded(
  ref: string,
  id: string,
  amount: number,
  gross: number,
) {
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
        amount: gross,
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

const paymentByRef = async (ref: string) =>
  (await db.select().from(payments).where(eq(payments.providerRef, ref)))[0];

const eventsOf = (type: string, paymentId: string) =>
  execRows<{
    id: number;
    payload: Record<string, unknown>;
    created_at: string;
  }>(
    sql`select id, payload, created_at from events where type = ${type} and payload->>'payment_id' = ${paymentId} order by id`,
  );

async function runHandler(
  list: typeof payrollHandlers,
  name: string,
  ev: { id: number; payload: Record<string, unknown> },
  type: string,
  now = new Date(),
) {
  const h = list.find((x) => x.name === name);
  if (!h) throw new Error(`handler ${name}`);
  await db.transaction((tx) =>
    h.run(
      {
        id: ev.id,
        type,
        entity: null,
        payload: ev.payload,
        actorUserId: null,
        createdAt: new Date(),
      } as never,
      { tx, now },
    ),
  );
}

const techLedger = (jobId: string) =>
  db
    .select()
    .from(ledgerEntries)
    .where(
      and(eq(ledgerEntries.jobId, jobId), eq(ledgerEntries.userId, techId)),
    );
const sum = (rows: { amountCents: number }[]) =>
  rows.reduce((a, r) => a + r.amountCents, 0);

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Money Fix Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: TZ,
    state: "tx",
  });
  adminId = s.userId;
  auth.user = (await loadSessionUser(
    s.userId,
    s.session?.sessionId as string,
  )) as SessionUser;
  techId = await invite("Tom Tech", "tom@example.com");
  const [c] = await db
    .insert(customers)
    .values({ displayName: "Pat Customer", firstName: "Pat" } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    })
    .returning({ id: properties.id });
  propertyId = p?.id as string;
  const today = dateKey(new Date(), TZ);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = addDaysToKey(today, -((dow + 6) % 7));
  lastWeekStart = addDaysToKey(thisMonday, -7);
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

let feeJob = { jobId: "", invoiceId: "" };

describe("1+2: Stripe webhook card payment: fee estimate → actual fee, card snapshot", () => {
  const ref = "pi_mf_fee";

  it("a real-shape webhook (latest_charge id) books a fee estimate of $3.93 and queues the fee fetch", async () => {
    feeJob = await completedJob(12500);
    const meta = {
      invoice_id: feeJob.invoiceId,
      job_id: feeJob.jobId,
      customer_id: customerId,
    };
    expect((await deliver(piSucceeded(ref, meta, 12500))).status).toBe(200);
    const p = await paymentByRef(ref);
    expect(p?.amountCents).toBe(12500);
    expect(p?.feeCents).toBe(393); // 2.9 % × 125.00 = 3.625 → 3.63 + 0.30
    expect(p?.feeSource).toBe("configured");
    expect(p?.feeOnTipCents).toBe(0);
    expect(p?.cardLast4).toBeNull();
    expect((p?.raw as { latest_charge?: unknown }).latest_charge).toEqual({
      id: `ch_${ref}`,
    });
    const q = await execRows<{ n: number }>(
      sql`select count(*)::int as n from job_queue where kind = 'stripe_fee' and payload->>'paymentId' = ${p?.id as string}`,
    );
    expect(q[0]?.n).toBe(1);
    expect(
      (
        await db
          .select()
          .from(invoices)
          .where(eq(invoices.id, feeJob.invoiceId))
      )[0]?.status,
    ).toBe("paid");
  });

  it("payroll on payment.succeeded: commission 25 % × (125.00 − 3.93) = 30.27", async () => {
    const p = await paymentByRef(ref);
    const [ev] = await eventsOf("payment.succeeded", p?.id as string);
    if (!ev) throw new Error("payment.succeeded not emitted");
    await runHandler(
      payrollHandlers,
      "payroll.recompute_on_payment",
      ev,
      "payment.succeeded",
    );
    const rows = await techLedger(feeJob.jobId);
    expect(rows.map((r) => [r.type, r.amountCents])).toEqual([
      ["commission", 3027],
    ]);
  });

  it("the worker fetches the actual fee ($3.80) and the card; emits payment.fee_updated once", async () => {
    const spy = vi
      .spyOn(stripeProvider, "retrievePayment")
      .mockResolvedValue(
        snapshotFromPaymentIntent(expandedPi(ref, 12500, 380)),
      );
    const before = await paymentByRef(ref);
    await fetchStripeFee(before?.id as string);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ref);
    const p = await paymentByRef(ref);
    expect(p?.feeCents).toBe(380);
    expect(p?.feeSource).toBe("actual");
    expect(p?.cardBrand).toBe("visa");
    expect(p?.cardLast4).toBe("4242");
    expect(p?.cardFunding).toBe("credit");
    expect(p?.cardFingerprint).toBe(`fp_${ref}`);
    expect(p?.avsResult).toBe("pass");
    expect(p?.cvcResult).toBe("pass");
    expect(p?.payerName).toBe("Pat Customer");
    const ch = (p?.raw as { latest_charge?: Record<string, unknown> })
      .latest_charge;
    expect(ch?.authorization_code).toBe("123456");
    expect(
      (p?.raw as { metadata?: { job_id?: string } }).metadata?.job_id,
    ).toBe(feeJob.jobId);
    const evs = await eventsOf("payment.fee_updated", p?.id as string);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.payload).toMatchObject({
      payment_id: p?.id,
      job_id: feeJob.jobId,
      invoice_id: feeJob.invoiceId,
      fee_cents: 380,
      previous_fee_cents: 393,
    });

    // Fee and card already in: a second run doesn't call Stripe or emit again.
    await fetchStripeFee(p?.id as string);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await eventsOf("payment.fee_updated", p?.id as string)).toHaveLength(
      1,
    );
  });

  it("payroll on payment.fee_updated: commission 25 % × (125.00 − 3.80) = 30.30, posted once", async () => {
    const p = await paymentByRef(ref);
    const [ev] = await eventsOf("payment.fee_updated", p?.id as string);
    if (!ev) throw new Error("payment.fee_updated not emitted");
    await runHandler(
      payrollHandlers,
      "payroll.recompute_on_fee",
      ev,
      "payment.fee_updated",
    );
    let rows = await techLedger(feeJob.jobId);
    expect(sum(rows)).toBe(3030);
    expect(rows.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([
      -3027, 3027, 3030,
    ]);
    // Re-delivered event / another recompute: nothing more is posted.
    await runHandler(
      payrollHandlers,
      "payroll.recompute_on_fee",
      ev,
      "payment.fee_updated",
    );
    const [paid] = await eventsOf("payment.succeeded", p?.id as string);
    if (paid)
      await runHandler(
        payrollHandlers,
        "payroll.recompute_on_payment",
        paid,
        "payment.succeeded",
      );
    rows = await techLedger(feeJob.jobId);
    expect(rows).toHaveLength(3);
    expect(sum(rows)).toBe(3030);
  });

  it("no balance transaction yet: the card fills in, the estimate stays and the worker retries", async () => {
    const j = await completedJob(20000);
    const r2 = "pi_mf_pending";
    await deliver(
      piSucceeded(
        r2,
        { invoice_id: j.invoiceId, job_id: j.jobId, customer_id: customerId },
        20000,
      ),
    );
    const p = await paymentByRef(r2);
    expect(p?.feeCents).toBe(610); // 2.9 % × 200 = 5.80 + 0.30
    vi.spyOn(stripeProvider, "retrievePayment").mockResolvedValue(
      snapshotFromPaymentIntent(expandedPi(r2, 20000, null)),
    );
    await expect(fetchStripeFee(p?.id as string)).rejects.toThrow(/fee/);
    const after = await paymentByRef(r2);
    expect(after?.cardLast4).toBe("4242");
    expect(after?.feeCents).toBe(610);
    expect(after?.feeSource).toBe("configured");
    expect(await eventsOf("payment.fee_updated", p?.id as string)).toHaveLength(
      0,
    );
  });

  it("snapshotFromPaymentIntent tolerates a string latest_charge (no card, no fee)", () => {
    const s = snapshotFromPaymentIntent({
      id: "pi_x",
      status: "succeeded",
      amount: 5000,
      latest_charge: "ch_x",
    });
    expect(s.amountCents).toBe(5000);
    expect(s.feeCents).toBeUndefined();
    expect(s.last4).toBeUndefined();
    expect(s.entryMode).toBe("online");
  });
});

describe("4: refund status counts the tip", () => {
  it("$125 + $20 tip, $130 refunded → partially_refunded; the last $15 → refunded", async () => {
    const j = await completedJob(12500);
    const ref = "pi_mf_tip";
    await deliver(
      piSucceeded(
        ref,
        { invoice_id: j.invoiceId, job_id: j.jobId, customer_id: customerId },
        14500,
        2000,
      ),
    );
    let p = await paymentByRef(ref);
    expect(p?.amountCents).toBe(12500);
    expect(p?.tipCents).toBe(2000);
    await deliver(chargeRefunded(ref, "re_mf_1", 13000, 14500));
    p = await paymentByRef(ref);
    expect(p?.status).toBe("partially_refunded");
    await deliver(chargeRefunded(ref, "re_mf_2", 1500, 14500));
    p = await paymentByRef(ref);
    expect(p?.status).toBe("refunded");
  });

  it("refundedInFull (pure)", () => {
    expect(refundedInFull(12500, { amountCents: 12500, tipCents: 0 })).toBe(
      true,
    );
    expect(refundedInFull(13000, { amountCents: 12500, tipCents: 2000 })).toBe(
      false,
    );
    expect(refundedInFull(14500, { amountCents: 12500, tipCents: 2000 })).toBe(
      true,
    );
  });
});

describe("5: a rule-made deposit is canceled when the job no longer qualifies", () => {
  const run = (name: string, payload: Record<string, unknown>) =>
    runHandler(
      paymentHandlers as never,
      name,
      { id: 0, payload },
      "invoice.lines_changed",
    );

  async function scheduledJob(total: number) {
    n++;
    const [j] = await db
      .insert(jobs)
      .values({
        number: `J-MF${n}`,
        customerId,
        propertyId,
        title: `Deposit job ${n}`,
        status: "scheduled",
        scheduledStart: new Date(Date.now() + 3 * 86_400_000),
      })
      .returning({ id: jobs.id });
    const jobId = j?.id as string;
    n++;
    const [inv] = await db
      .insert(invoices)
      .values({
        number: `INV-MF${n}`,
        customerId,
        jobId,
        status: "draft",
        subtotalCents: total,
        totalCents: total,
      })
      .returning({ id: invoices.id });
    const [line] = await db
      .insert(lineItems)
      .values({
        parentType: "invoice",
        parentId: inv?.id as string,
        type: "service",
        name: "New opener",
        qty: 1,
        unitPriceCents: total,
        totalCents: total,
        taxable: false,
      })
      .returning({ id: lineItems.id });
    return { jobId, invoiceId: inv?.id as string, lineId: line?.id as string };
  }
  async function queueDepositTexts(depositId: string, jobId: string) {
    for (const [i, hours] of [0, 24].entries())
      await db.insert(scheduledMessages).values({
        dedupeKey: `test:deposit:${depositId}:${i}`,
        templateKey: "deposit.request",
        channel: "sms",
        purpose: "transactional",
        audienceType: "customer",
        recipientCustomerId: customerId,
        entityType: "deposit_request",
        entityId: depositId,
        jobId,
        sendAt: new Date(Date.now() + (hours + 1) * 3_600_000),
        status: "scheduled",
      });
  }
  const depositsOf = (jobId: string) =>
    db.select().from(depositRequests).where(eq(depositRequests.jobId, jobId));

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

  it("$600 line → deposit $100; line removed → request expired, texts canceled, audited", async () => {
    const j = await scheduledJob(60000);
    await run("payments.deposit_on_lines_changed", { job_id: j.jobId });
    let deps = await depositsOf(j.jobId);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.status).toBe("required");
    expect(deps[0]?.ruleId).toBeTruthy();
    const depId = deps[0]?.id as string;
    await queueDepositTexts(depId, j.jobId);

    await db.delete(lineItems).where(eq(lineItems.id, j.lineId));
    await db
      .update(invoices)
      .set({ subtotalCents: 0, totalCents: 0 })
      .where(eq(invoices.id, j.invoiceId));
    await run("payments.deposit_on_lines_changed", { job_id: j.jobId });
    deps = await depositsOf(j.jobId);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.status).toBe("expired");
    const sends = await db
      .select({
        status: scheduledMessages.status,
        err: scheduledMessages.lastError,
      })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.entityId, depId));
    expect(sends).toEqual([
      { status: "canceled", err: "deposit_not_needed" },
      { status: "canceled", err: "deposit_not_needed" },
    ]);
    const audit = await execRows<{ n: number }>(
      sql`select count(*)::int as n from audit_log where action = 'deposit.canceled' and entity_id = ${depId}`,
    );
    expect(audit[0]?.n).toBe(1);
    const act = await execRows<{ summary: string }>(
      sql`select summary from activity where kind = 'deposit.canceled' and job_id = ${j.jobId}`,
    );
    expect(act).toHaveLength(1);
    expect(act[0]?.summary).toContain("$100.00");

    // Idempotent; and the line coming back asks again (a new request).
    await run("payments.deposit_on_lines_changed", { job_id: j.jobId });
    expect(await depositsOf(j.jobId)).toHaveLength(1);
    await db.insert(lineItems).values({
      parentType: "invoice",
      parentId: j.invoiceId,
      type: "service",
      name: "New opener",
      qty: 1,
      unitPriceCents: 60000,
      totalCents: 60000,
      taxable: false,
    });
    await run("payments.deposit_on_lines_changed", { job_id: j.jobId });
    deps = await depositsOf(j.jobId);
    expect(deps.map((d) => d.status).sort()).toEqual(["expired", "required"]);
  });

  it("a deposit the office asked for by hand stays", async () => {
    const j = await scheduledJob(0);
    const [d] = await db
      .insert(depositRequests)
      .values({
        jobId: j.jobId,
        amountCents: 5000,
        mode: "manual",
        status: "requested",
      })
      .returning({ id: depositRequests.id });
    await queueDepositTexts(d?.id as string, j.jobId);
    await run("payments.deposit_on_lines_changed", { job_id: j.jobId });
    const deps = await depositsOf(j.jobId);
    expect(deps.map((x) => x.status)).toEqual(["requested"]);
    const sends = await db
      .select({ status: scheduledMessages.status })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.entityId, d?.id as string));
    expect(sends.every((s) => s.status === "scheduled")).toBe(true);
  });
});

describe("6: tech daily agenda dedupes by the send date", () => {
  it("ticks at 21:00 and 05:15 schedule one 07:00 agenda", async () => {
    const day = addDaysToKey(dateKey(new Date(), TZ), 10);
    const next = addDaysToKey(day, 1);
    // Jobs on both days (the evening run used to key tomorrow's 07:00 under today).
    for (const d of [day, next]) {
      n++;
      const [j] = await db
        .insert(jobs)
        .values({
          number: `J-MF${n}`,
          customerId,
          propertyId,
          title: `Agenda ${n}`,
          status: "scheduled",
          windowStart: at(d, 9),
          windowEnd: at(d, 11),
          scheduledStart: at(d, 9),
        })
        .returning({ id: jobs.id });
      await db.insert(jobAssignments).values({
        jobId: j?.id as string,
        userId: techId,
        role: "primary",
        splitBps: 10000,
      });
    }
    const agendas = () =>
      db
        .select({
          sendAt: scheduledMessages.sendAt,
          key: scheduledMessages.dedupeKey,
        })
        .from(scheduledMessages)
        .where(
          and(
            eq(scheduledMessages.templateKey, "staff.daily_agenda"),
            eq(scheduledMessages.recipientUserId, techId),
          ),
        );
    await scheduleFixedTime(at(day, 21));
    let rows = await agendas();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sendAt.getTime()).toBe(at(next, 7).getTime());
    expect(rows[0]?.key).toContain(`:${next}:`);
    await scheduleFixedTime(at(next, 5, 15));
    rows = await agendas();
    expect(rows).toHaveLength(1);
  });
});

describe("7 (T6-14): payroll close uses the tick's now", () => {
  it("closed_at and the review deadline follow the injected clock", async () => {
    const fakeNow = new Date(Date.now() + 3 * 86_400_000);
    const [period] = await db
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.startsOn, lastWeekStart));
    expect(period).toBeTruthy();
    await db.transaction((tx) =>
      closePayPeriod(tx, period?.id as string, SYSTEM_ACTOR, fakeNow),
    );
    const [closed] = await db
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, period?.id as string));
    expect(closed?.closedAt?.getTime()).toBe(fakeNow.getTime());
    // The pay_period.closed handler drafts statements with the pass's clock.
    await runHandler(
      payrollHandlers,
      "payroll.draft_settlements",
      { id: 0, payload: { pay_period_id: period?.id } },
      "pay_period.closed",
      fakeNow,
    );
    const [st] = await db
      .select()
      .from(settlements)
      .where(
        and(
          eq(settlements.userId, techId),
          eq(settlements.payPeriodId, period?.id as string),
        ),
      );
    expect(st?.reviewDeadline?.getTime()).toBe(
      fakeNow.getTime() + 48 * 3_600_000,
    );
    expect(adminId).toBeTruthy();
  });
});

describe("(b) card refund without a connected processor", () => {
  it("refuses in plain words and records no refund", async () => {
    const p = await paymentByRef("pi_mf_pending");
    if (!p) throw new Error("payment");
    const r = await refundPayment({
      paymentId: p.id,
      amountCents: 1000,
      reason: "Customer asked",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("payment processor");
      expect(r.error).not.toMatch(/STRIPE|SECRET|_KEY/);
    }
    const rows = await execRows<{ n: number }>(
      sql`select count(*)::int as n from refunds where payment_id = ${p.id}`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("providerErrorMessage hides credential names, keeps processor messages", () => {
    const missing = Object.assign(
      new Error("STRIPE_SECRET_KEY is not configured"),
      { code: "not_configured" },
    );
    expect(providerErrorMessage(missing, "x")).not.toMatch(/STRIPE|SECRET/);
    expect(
      providerErrorMessage(new Error("Charge already refunded"), "x"),
    ).toBe("Charge already refunded");
    expect(providerErrorMessage(null, "Refund failed")).toBe("Refund failed");
  });
});
