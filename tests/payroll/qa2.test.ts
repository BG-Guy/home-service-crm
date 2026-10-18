// B6 QA round 2 integration tests on a throwaway PGlite (TEST_PGLITE_ROOT):
//  - T6-07 partial refund in B4's shape (invoice stays paid, credit note for the
//    refunded base, payment partially_refunded): commission scales, the tip stays
//  - T6-02 recompute on a locked job posts the adjustment once, however many
//    events trigger it
//  - T6-03/T3-01 W-2 minimum-wage and overtime top-ups land on the statement being
//    approved (not "posted late" into the open week)
//  - T5-01 removePartLine only removes a part line of the job it was called with
//  - T5-14 payroll CSV formula guard; T1-06 hand-in maximum
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b6-qa2-"),
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

import { and, eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  cashRemittances,
  creditNotes,
  customers,
  invoices,
  jobAssignments,
  jobFinancials,
  jobs,
  ledgerEntries,
  lineItems,
  payments,
  payPeriods,
  properties,
  refunds,
  settlements,
  timeEntries,
  users,
} from "@/db/schema";
import "@/db/seed/register";
import { removePartLine } from "@/features/parts/actions";
import { remitCash } from "@/features/payroll/actions";
import { recomputeJobFinancials } from "@/features/payroll/server/financials";
import { payrollCsv } from "@/features/payroll/server/payouts";
import { techPlans } from "@/features/payroll/server/plans";
import {
  approveSettlement,
  closePayPeriod,
  generateSettlements,
  type SettlementTotalsJson,
} from "@/features/payroll/server/settlements";
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
let adminId = "";
let techA: SessionUser;
let techB: SessionUser;
let customerId = "";
let propertyId = "";
let n = 0;
let lastWeekStart = "";
let lastWeekEnd = "";

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

const at = (day: string, h: number) =>
  zonedTimeToUtc({ ...parseDateKey(day), hour: h, minute: 0 }, TZ);

/** A job for `tech` with one service line, its invoice and a card payment. */
async function job(i: {
  tech: string;
  status?: string;
  invoiceStatus?: string;
  priceCents: number;
  tipCents?: number;
  pay?: boolean;
}) {
  n++;
  const completed = i.status === undefined || i.status === "completed";
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-Q${n}`,
      customerId,
      propertyId,
      title: `QA job ${n}`,
      status: i.status ?? "completed",
      completedAt: completed ? at(addDaysToKey(lastWeekStart, 2), 11) : null,
      createdAt: at(addDaysToKey(lastWeekStart, 1), 9),
    })
    .returning();
  if (!j) throw new Error("job");
  await db
    .insert(jobAssignments)
    .values({ jobId: j.id, userId: i.tech, role: "primary", splitBps: 10000 });
  const [inv] = await db
    .insert(invoices)
    .values({
      number: `INV-Q${n}`,
      customerId,
      jobId: j.id,
      status: i.invoiceStatus ?? "paid",
      subtotalCents: i.priceCents,
      totalCents: i.priceCents,
      issuedAt: i.invoiceStatus === "draft" ? null : at(lastWeekStart, 12),
    })
    .returning();
  if (!inv) throw new Error("invoice");
  await db.insert(lineItems).values({
    parentType: "invoice",
    parentId: inv.id,
    type: "service",
    name: "Service",
    qty: 1,
    unitPriceCents: i.priceCents,
    totalCents: i.priceCents,
    taxable: false,
  });
  let paymentId = "";
  if (i.pay !== false) {
    const [p] = await db
      .insert(payments)
      .values({
        invoiceId: inv.id,
        jobId: j.id,
        customerId,
        kind: "payment",
        method: "card",
        provider: "stripe",
        status: "succeeded",
        amountCents: i.priceCents,
        tipCents: i.tipCents ?? 0,
        feeCents: 0,
        succeededAt: at(addDaysToKey(lastWeekStart, 2), 11),
      })
      .returning({ id: payments.id });
    paymentId = p?.id ?? "";
  }
  return { jobId: j.id, invoiceId: inv.id, paymentId };
}

/** B4's partial-refund shape: refund row + credit note; payment partially_refunded. */
async function partialRefund(
  r: { invoiceId: string; paymentId: string },
  cents: number,
) {
  n++;
  await db.insert(refunds).values({
    paymentId: r.paymentId,
    amountCents: cents,
    reason: "requested_by_customer",
    status: "succeeded",
    completedAt: new Date(),
  });
  await db.insert(creditNotes).values({
    number: `CN-Q${n}`,
    invoiceId: r.invoiceId,
    amountCents: cents,
    reason: `Partial refund of $${(cents / 100).toFixed(2)}`,
  });
  await db
    .update(payments)
    .set({ status: "partially_refunded" })
    .where(eq(payments.id, r.paymentId));
}

const jobLedger = async (jobId: string, userId: string) =>
  db
    .select()
    .from(ledgerEntries)
    .where(
      and(eq(ledgerEntries.jobId, jobId), eq(ledgerEntries.userId, userId)),
    );
const sum = (rows: { amountCents: number }[]) =>
  rows.reduce((a, r) => a + r.amountCents, 0);
const recompute = (jobId: string, reason: string) =>
  db.transaction((tx) =>
    recomputeJobFinancials(tx, jobId, SYSTEM_ACTOR, reason),
  );

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "B6 QA",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: TZ,
    state: "tx",
  });
  adminId = s.userId;
  techA = await invite("Tom Tech", "tom@example.com");
  techB = await invite("Maria W2", "maria@example.com");
  await db
    .update(users)
    .set({ workerType: "1099" })
    .where(eq(users.id, techA.id));
  await db
    .update(users)
    .set({ workerType: "w2" })
    .where(eq(users.id, techB.id));
  const [c] = await db
    .insert(customers)
    .values({ displayName: "QA Customer" })
    .returning();
  customerId = c?.id ?? "";
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    })
    .returning();
  propertyId = p?.id ?? "";
  // Weekly periods start Monday (payroll.week_starts_on default 1).
  const today = dateKey(new Date(), TZ);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = addDaysToKey(today, -((dow + 6) % 7));
  lastWeekStart = addDaysToKey(thisMonday, -7);
  lastWeekEnd = addDaysToKey(thisMonday, -1);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

let refundJob: { jobId: string; invoiceId: string; paymentId: string };

describe("T6-07 partial refund (B4 shape)", () => {
  it("$400 + $20 tip, $20 refunded → commission $95.00, tip $20 kept", async () => {
    refundJob = await job({
      tech: techA.id,
      priceCents: 40000,
      tipCents: 2000,
    });
    await recompute(refundJob.jobId, "test");
    // partner_25, no fee/parts: 25% × 400 = 100.00 + tip 20.00
    expect(sum(await jobLedger(refundJob.jobId, techA.id))).toBe(12000);

    await partialRefund(refundJob, 2000);
    const r = await recompute(refundJob.jobId, "refund.succeeded");
    expect(r.earned).toBe(true);
    // credit 20 and refund 20 count once: base 400 × 380/400 = 380 → 95.00
    expect(r.result?.refundedCents).toBe(2000);
    expect(r.result?.baseCents).toBe(38000);
    const rows = await jobLedger(refundJob.jobId, techA.id);
    expect(sum(rows)).toBe(11500);
    expect(
      sum(rows.filter((x) => x.type === "tip" && !x.reversesId)),
    ).toBeGreaterThanOrEqual(2000);
    const [fin] = await db
      .select()
      .from(jobFinancials)
      .where(eq(jobFinancials.jobId, refundJob.jobId));
    expect(fin?.baseCents).toBe(38000);
  });

  it("a refund that re-opens the invoice (no credit note) still doesn't un-earn the job", async () => {
    const j = await job({ tech: techA.id, priceCents: 20000, tipCents: 1000 });
    await recompute(j.jobId, "test");
    expect(sum(await jobLedger(j.jobId, techA.id))).toBe(6000); // 50 + 10
    await db.insert(refunds).values({
      paymentId: j.paymentId,
      amountCents: 5000,
      reason: "requested_by_customer",
      status: "succeeded",
    });
    await db
      .update(payments)
      .set({ status: "partially_refunded" })
      .where(eq(payments.id, j.paymentId));
    await db
      .update(invoices)
      .set({ status: "partially_paid" })
      .where(eq(invoices.id, j.invoiceId));
    await recompute(j.jobId, "refund.succeeded");
    // 25% × 200 × 150/200 = 37.50 + tip 10 = 47.50 (was a full reversal: 0)
    expect(sum(await jobLedger(j.jobId, techA.id))).toBe(4750);
  });

  it("a lost dispute's refund is left to the chargeback rules", async () => {
    const j = await job({ tech: techA.id, priceCents: 10000 });
    await recompute(j.jobId, "test");
    await db.insert(refunds).values({
      paymentId: j.paymentId,
      amountCents: 10000,
      reason: "dispute_lost",
      status: "succeeded",
    });
    await db
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.id, j.paymentId));
    await db
      .update(invoices)
      .set({ status: "issued" })
      .where(eq(invoices.id, j.invoiceId));
    const r = await recompute(j.jobId, "test");
    expect(r.posted + r.reversed).toBe(0);
    expect(sum(await jobLedger(j.jobId, techA.id))).toBe(2500);
  });
});

describe("statements: lock, top-ups", () => {
  let w2Job = "";

  it("sets up a W-2 week: $200 job, 45 h clocked", async () => {
    const plan = (await techPlans(db, [techB.id], lastWeekEnd)).get(techB.id);
    expect(plan?.plan.min_wage_cents_per_hour).toBe(725);
    w2Job = (await job({ tech: techB.id, priceCents: 20000 })).jobId;
    await recompute(w2Job, "test");
    expect(sum(await jobLedger(w2Job, techB.id))).toBe(5000);
    for (let d = 0; d < 5; d++) {
      const day = addDaysToKey(lastWeekStart, d);
      await db.insert(timeEntries).values({
        userId: techB.id,
        clockInAt: at(day, 8),
        clockOutAt: at(day, 17),
        breakMinutes: 0,
      });
    }
    await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.startsOn, lastWeekStart));
      expect(p).toBeTruthy();
      await closePayPeriod(tx, p?.id ?? "", { kind: "user", userId: adminId });
      await generateSettlements(tx, p?.id ?? "", {
        kind: "user",
        userId: adminId,
      });
    });
  });

  it("T6-03: approving the W-2 statement includes its own top-ups", async () => {
    // 45 h × 7.25 = 326.25 floor; wages 50.00 → guarantee top-up 276.25
    // OT = ½ × (326.25 / 45 h) × 5 h = 326.25 × 300 / 5400 = 18.125 → 18.13
    // closing = 50.00 + 276.25 + 18.13 = 344.38
    const [s] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.userId, techB.id));
    const a = await db.transaction((tx) =>
      approveSettlement(
        tx,
        s?.id ?? "",
        { kind: "user", userId: adminId },
        { force: true },
      ),
    );
    expect(a.status).toBe("approved");
    expect(a.closingBalanceCents).toBe(34438);
    const tops = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, techB.id));
    const g = tops.find((t) => t.type === "guarantee_topup");
    const ot = tops.find((t) => t.type === "ot_topup");
    expect(g?.amountCents).toBe(27625);
    expect(ot?.amountCents).toBe(1813);
    expect(g?.effectiveDate).toBe(lastWeekEnd);
    expect(g?.memo).not.toContain("posted late");
    const ids = (a.totals as SettlementTotalsJson).entry_ids;
    expect(ids).toContain(g?.id);
    expect(ids).toContain(ot?.id);
  });

  it("T6-02: a locked job's refund posts one adjustment, however many events fire", async () => {
    const [s] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.userId, techA.id));
    await db.transaction((tx) =>
      approveSettlement(
        tx,
        s?.id ?? "",
        { kind: "user", userId: adminId },
        { force: true },
      ),
    );
    const [fin] = await db
      .select()
      .from(jobFinancials)
      .where(eq(jobFinancials.jobId, refundJob.jobId));
    expect(fin?.lockedAt).toBeTruthy();

    // A further $40 partial refund: base 400 × 340/400 → 85.00 (was 95.00) → −10.00
    await partialRefund(refundJob, 4000);
    const r1 = await recompute(refundJob.jobId, "refund.created");
    const r2 = await recompute(refundJob.jobId, "refund.succeeded");
    expect(r1.locked).toBe(true);
    expect(r1.posted).toBe(1);
    expect(r2.posted).toBe(0);
    const adj = (await jobLedger(refundJob.jobId, techA.id)).filter(
      (x) => x.type === "adjustment",
    );
    expect(adj.map((x) => x.amountCents)).toEqual([-1000]);
    // Before the fix a $20 refund docked the full earnings twice (−$402.90 in QA).
  });
});

describe("T5-01 removePartLine binds the line to the job", () => {
  it("a tech can't remove a part from another tech's draft invoice", async () => {
    const mine = await job({
      tech: techA.id,
      status: "in_progress",
      invoiceStatus: "draft",
      priceCents: 10000,
      pay: false,
    });
    const theirs = await job({
      tech: techB.id,
      status: "in_progress",
      invoiceStatus: "draft",
      priceCents: 10000,
      pay: false,
    });
    const part = async (invoiceId: string) => {
      const [l] = await db
        .insert(lineItems)
        .values({
          parentType: "invoice",
          parentId: invoiceId,
          type: "part",
          name: "Cylinder",
          qty: 1,
          unitPriceCents: 4500,
          totalCents: 4500,
          taxable: false,
        })
        .returning({ id: lineItems.id });
      return l?.id ?? "";
    };
    const myLine = await part(mine.invoiceId);
    const theirLine = await part(theirs.invoiceId);
    auth.user = techA;
    const bad = await removePartLine({
      jobId: mine.jobId,
      lineItemId: theirLine,
    });
    expect(bad.ok).toBe(false);
    const [still] = await db
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(eq(lineItems.id, theirLine));
    expect(still?.id).toBe(theirLine);
    const good = await removePartLine({
      jobId: mine.jobId,
      lineItemId: myLine,
    });
    expect(good.ok).toBe(true);
    const [gone] = await db
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(eq(lineItems.id, myLine));
    expect(gone).toBeUndefined();
  });
});

describe("T1-06 hand-in maximum", () => {
  it("can't hand in more cash than the tech holds", async () => {
    await db.insert(payments).values({
      customerId,
      kind: "payment",
      method: "cash",
      provider: "manual",
      status: "succeeded",
      amountCents: 11875,
      tipCents: 0,
      collectedByUserId: techA.id,
      succeededAt: new Date(),
    });
    auth.user = techA;
    const tooMuch = await remitCash({ amountCents: 500000, method: "hand_in" });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok)
      expect(tooMuch.fieldErrors?.amountCents?.[0]).toContain("$118.75");
    const ok = await remitCash({ amountCents: 11875, method: "hand_in" });
    expect(ok.ok).toBe(true);
    // The pending hand-in already covers it: a second one is refused.
    const again = await remitCash({ amountCents: 100, method: "hand_in" });
    expect(again.ok).toBe(false);
    const rows = await db
      .select()
      .from(cashRemittances)
      .where(eq(cashRemittances.userId, techA.id));
    expect(rows).toHaveLength(1);
  });
});

describe("T5-14 payroll CSV", () => {
  it("neutralizes formulas in text cells, keeps negative money as numbers", () => {
    const csv = payrollCsv([
      {
        name: '=HYPERLINK("http://x","pay")',
        email: "+evil@example.com",
        workerType: "1099",
        period: "2026-10-05..2026-10-11",
        totals: { byType: {} } as unknown as SettlementTotalsJson,
        closingCents: -11850,
      },
    ]);
    const row = csv.split("\n")[1] ?? "";
    expect(row.startsWith(`"'=HYPERLINK(""http://x"",""pay"")"`)).toBe(true);
    expect(row).toContain(",'+evil@example.com,");
    expect(row.endsWith(",-118.50")).toBe(true);
  });
});
