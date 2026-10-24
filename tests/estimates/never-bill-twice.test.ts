// Quote to Paid E1, "never bill the same work twice", on a throwaway PGlite
// (TEST_PGLITE_ROOT):
// - approving an estimate onto a DRAFT invoice replaces what the draft billed
//   (lead quote, earlier estimates, manual lines) and keeps parts used on the job
//   (purchase / stock move / parts flow) without adding them again;
// - a change order appends (tagged change_order);
// - an issued invoice is never touched and ApproveResult says so;
// - other open estimates on the job become "superseded": not signable, not in the
//   signed total, not in the close rate;
// - a new estimate on a job starts from the draft invoice's lines;
// - J-1070: an unchanged estimate keeps the invoice at $876.89 and needs no change
//   order; the approval emits invoice.lines_changed.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-never-twice-"),
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
  const check = async (perm?: string | string[]) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    for (const p of perm ? (Array.isArray(perm) ? perm : [perm]) : [])
      if (!auth.user.perms.has(p as never)) {
        const { ForbiddenError } = await import("@/lib/errors");
        throw new ForbiddenError(undefined, p);
      }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string | string[]) => check(perm),
    requireAnyPerm: (perms: string[]) => check(perms.slice(0, 1)),
  };
});

import { and, asc, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows, type Tx } from "@/db";
import {
  customers,
  estimateOptions,
  estimates,
  invoices,
  lineItems,
  pricebookItems,
  properties,
  stockMoves,
} from "@/db/schema";
import "@/db/seed/register";
import {
  approveChangeOrderTx,
  approveEstimateTx,
  createChangeOrderTx,
  createEstimateDraft,
  getChangeOrderStatus,
  recomputeChangeOrder,
} from "@/features/estimates/api";
import { canApproveEstimate } from "@/features/estimates/logic";
import { getCloseRates } from "@/features/estimates/queries";
import type { LineInput } from "@/features/invoices/api";
import { addJobLine, insertLines } from "@/features/invoices/api";
import { LEAD_QUOTE_LINE_DESCRIPTION } from "@/features/invoices/lead-quote";
import { createJob } from "@/features/jobs/api";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let admin: SessionUser;
let customerId = "";
let propertyId = "";
let deadboltId = "";

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn);

async function newJob(title = "Grade 1 deadbolts"): Promise<string> {
  const r = await inTx((tx) =>
    createJob(tx, { customerId, propertyId, title }, SYSTEM_ACTOR),
  );
  return r.jobId;
}

const addLine = (jobId: string, line: LineInput) =>
  inTx((tx) => addJobLine(tx, jobId, line, SYSTEM_ACTOR)).then(
    (r) => r.lineItemId,
  );

async function invoiceOf(jobId: string) {
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
        .orderBy(asc(lineItems.sort))
    : [];
  return { inv, lines };
}

async function newEstimate(jobId: string) {
  const { estimateId, number } = await inTx((tx) =>
    createEstimateDraft(tx, { customerId, jobId }, SYSTEM_ACTOR),
  );
  const [opt] = await db
    .select()
    .from(estimateOptions)
    .where(eq(estimateOptions.estimateId, estimateId));
  const lines = await db
    .select()
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "estimate_option"),
        eq(lineItems.parentId, opt?.id as string),
      ),
    )
    .orderBy(asc(lineItems.sort));
  return { estimateId, number, optionId: opt?.id as string, lines };
}

const addOptionLines = (optionId: string, lines: LineInput[]) =>
  inTx((tx) => insertLines(tx, "estimate_option", optionId, lines));

const verbal = {
  signerName: "Sophia Taylor",
  signatureMediaId: null,
  channel: "verbal" as const,
  esignConsent: false,
  consentText: "Verbal approval recorded in a test",
};

const approve = (estimateId: string, optionId: string) =>
  inTx((tx) =>
    approveEstimateTx(
      tx,
      { estimateId, optionId, addonIds: [], sign: verbal },
      SYSTEM_ACTOR,
    ),
  );

const statusOf = async (estimateId: string) =>
  (
    await db
      .select({ status: estimates.status })
      .from(estimates)
      .where(eq(estimates.id, estimateId))
  )[0]?.status;

const svc = (name: string, cents: number, o: Partial<LineInput> = {}) =>
  ({
    type: "service",
    name,
    qty: 1,
    unitPriceCents: cents,
    taxable: false,
    ...o,
  }) as LineInput;

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Ironclad Lock & Key",
    name: "Ada Admin",
    email: "ada@ironclad.test",
    password: "tangerine-kayak-41",
    timezone: "America/Denver",
    state: "co",
  });
  admin = (await loadSessionUser(
    s.userId,
    s.session?.sessionId as string,
  )) as SessionUser;
  auth.user = admin;
  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Sophia Taylor",
      firstName: "Sophia",
      phone: "+17205550142",
    } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "8106 S Monaco Pkwy",
      city: "Centennial",
      state: "CO",
      zip: "80112",
    })
    .returning({ id: properties.id });
  propertyId = p?.id as string;
  const [pb] = await db
    .insert(pricebookItems)
    .values({
      kind: "part",
      name: "Grade 1 deadbolt",
      unitPriceCents: 12900,
      unitCostCents: 4800,
      taxable: true,
    } as never)
    .returning({ id: pricebookItems.id });
  deadboltId = pb?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("approving an estimate replaces the draft's lines", () => {
  it("removes the lead quote and manual lines, adds the approved ones (tagged)", async () => {
    const jobId = await newJob();
    await addLine(
      jobId,
      svc("Installation", 25000, {
        description: LEAD_QUOTE_LINE_DESCRIPTION,
        sourceType: "lead_quote",
      }),
    );
    await addLine(jobId, svc("Trip charge", 4500));
    const est = await newEstimate(jobId);
    // Started from the invoice: the quote (marker dropped) and the trip charge.
    expect(est.lines.map((l) => [l.name, l.description])).toEqual([
      ["Installation", null],
      ["Trip charge", null],
    ]);
    await addOptionLines(est.optionId, [svc("Rekey to one key", 11500)]);
    const r = await approve(est.estimateId, est.optionId);
    expect(r.linesSkipped).toBeNull();
    const { inv, lines } = await invoiceOf(jobId);
    expect(lines.map((l) => [l.name, l.totalCents])).toEqual([
      ["Installation", 25000],
      ["Trip charge", 4500],
      ["Rekey to one key", 11500],
    ]);
    expect(inv?.totalCents).toBe(41000);
    expect(
      lines.every(
        (l) => l.sourceType === "estimate" && l.sourceId === est.estimateId,
      ),
    ).toBe(true);
    const [removed] = await execRows<{ summary: string; data: unknown }>(
      sql`select summary, data from activity where kind = 'invoice.line_removed' and entity_id = ${inv?.id as string}`,
    );
    expect(removed?.summary).toBe(
      `2 lines ($295.00) replaced by estimate ${est.number}`,
    );
    const [ev] = await execRows<{ n: number }>(
      sql`select count(*)::int as n from events where type = 'invoice.lines_changed' and entity_id = ${inv?.id as string}`,
    );
    expect(Number(ev?.n)).toBeGreaterThan(0);
  });

  it("keeps parts used on the job and doesn't add them again", async () => {
    const jobId = await newJob();
    // From the van (a stock move points at the line) and one bought on a receipt.
    const fromStock = await addLine(jobId, {
      type: "part",
      pricebookItemId: deadboltId,
      name: "Grade 1 deadbolt",
      qty: 1,
      unitPriceCents: 12900,
      taxable: true,
      partSource: "company_stock",
    });
    await db.insert(stockMoves).values({
      pricebookItemId: deadboltId,
      qty: 1,
      kind: "use_on_job",
      jobId,
      lineItemId: fromStock,
    });
    const bought = await addLine(jobId, {
      type: "part",
      name: "Strike plate",
      qty: 2,
      unitPriceCents: 900,
      taxable: true,
      partSource: "tech_purchased",
      partPurchaseId: "4b7a1d0e-6b8f-4f4e-9d61-1c2b3a4d5e6f",
    });
    // The parts flow tags its lines too (company order: no purchase, no stock move).
    const ordered = await addLine(jobId, {
      type: "part",
      name: "Door reinforcer",
      qty: 1,
      unitPriceCents: 3500,
      taxable: true,
      partSource: "company_po",
      sourceType: "part",
    });
    await addLine(jobId, svc("Quoted on the phone", 9000));
    const est = await newEstimate(jobId);
    expect(est.lines.map((l) => l.name)).toEqual([
      "Grade 1 deadbolt",
      "Strike plate",
      "Door reinforcer",
      "Quoted on the phone",
    ]);
    // The purchase stays with the invoice line only.
    expect(est.lines.every((l) => l.partPurchaseId == null)).toBe(true);
    await addOptionLines(est.optionId, [
      svc("Deadbolt installation", 8500, { type: "labor" }),
    ]);
    await approve(est.estimateId, est.optionId);
    const { lines } = await invoiceOf(jobId);
    expect(
      lines.map((l) => [l.name, l.id === fromStock || l.id === bought]),
    ).toEqual([
      ["Grade 1 deadbolt", true],
      ["Strike plate", true],
      ["Door reinforcer", false],
      ["Quoted on the phone", false],
      ["Deadbolt installation", false],
    ]);
    // The estimate's copies of the three parts were not added again.
    expect(lines.filter((l) => l.name === "Grade 1 deadbolt")).toHaveLength(1);
    expect(lines.find((l) => l.name === "Door reinforcer")?.id).toBe(ordered);
    expect(
      lines.find((l) => l.name === "Quoted on the phone")?.sourceType,
    ).toBe("estimate");
  });

  it("keeps the service-call fee and credits it once", async () => {
    const jobId = await newJob();
    await addLine(
      jobId,
      svc("Service call", 8900, { isServiceFee: true, taxable: false }),
    );
    const est = await newEstimate(jobId);
    expect(est.lines).toHaveLength(0); // no default price on this job type
    await addOptionLines(est.optionId, [svc("Lock repair", 18500)]);
    await approve(est.estimateId, est.optionId);
    const first = await invoiceOf(jobId);
    expect(first.lines.map((l) => [l.name, l.totalCents])).toEqual([
      ["Service call", 8900],
      ["Lock repair", 18500],
      ["Service call fee credited", -8900],
    ]);
    // A second estimate replaces the repair but keeps one fee and one credit.
    const second = await newEstimate(jobId);
    expect(second.lines.map((l) => l.name)).toEqual(["Lock repair"]);
    await approve(second.estimateId, second.optionId);
    const after = await invoiceOf(jobId);
    expect(after.lines.map((l) => l.name).sort()).toEqual([
      "Lock repair",
      "Service call",
      "Service call fee credited",
    ]);
    expect(after.inv?.totalCents).toBe(18500);
  });
});

describe("change orders append; issued invoices are left alone", () => {
  it("a change order adds its lines (tagged) and counts in the signed total", async () => {
    const jobId = await newJob();
    const est = await newEstimate(jobId);
    await addOptionLines(est.optionId, [svc("Rekey", 11500)]);
    await approve(est.estimateId, est.optionId);
    const co = await inTx((tx) =>
      createChangeOrderTx(tx, { jobId, reason: "Third door" }, SYSTEM_ACTOR),
    );
    await inTx(async (tx) => {
      await insertLines(tx, "change_order", co.changeOrderId, [
        svc("Rekey a third door", 4000),
      ]);
      await recomputeChangeOrder(tx, co.changeOrderId);
    });
    await inTx((tx) =>
      approveChangeOrderTx(
        tx,
        { changeOrderId: co.changeOrderId, sign: verbal },
        SYSTEM_ACTOR,
      ),
    );
    const { inv, lines } = await invoiceOf(jobId);
    expect(lines.map((l) => [l.name, l.sourceType])).toEqual([
      ["Rekey", "estimate"],
      ["Rekey a third door", "change_order"],
    ]);
    expect(lines[1]?.sourceId).toBe(co.changeOrderId);
    const st = await getChangeOrderStatus(jobId);
    expect(st.signedTotalCents).toBe(15500);
    expect(st.currentTotalCents).toBe(inv?.totalCents);
    expect(st.required).toBe(false);
  });

  it("an issued invoice: approval succeeds, no lines added, the result says so", async () => {
    const jobId = await newJob();
    await addLine(jobId, svc("Lockout", 12500));
    const { inv } = await invoiceOf(jobId);
    await db
      .update(invoices)
      .set({ status: "issued", issuedAt: new Date() })
      .where(eq(invoices.id, inv?.id as string));
    const est = await newEstimate(jobId);
    // Not a draft: the estimate doesn't start from it.
    expect(est.lines).toHaveLength(0);
    await addOptionLines(est.optionId, [svc("Rekey", 11500)]);
    const r = await approve(est.estimateId, est.optionId);
    expect(r.linesSkipped).toEqual({ invoiceNumber: inv?.number });
    const after = await invoiceOf(jobId);
    expect(after.lines.map((l) => l.name)).toEqual(["Lockout"]);
    expect(await statusOf(est.estimateId)).toBe("approved");
  });
});

describe("other open estimates on the job are superseded", () => {
  it("can't be signed, aren't in the signed total or the close rate", async () => {
    const jobId = await newJob();
    const a = await newEstimate(jobId);
    await addOptionLines(a.optionId, [svc("Rekey", 11500)]);
    const b = await newEstimate(jobId);
    await addOptionLines(b.optionId, [svc("New deadbolts", 45073)]);
    await db
      .update(estimates)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(estimates.id, b.estimateId));
    await approve(a.estimateId, a.optionId);
    expect(await statusOf(b.estimateId)).toBe("superseded");
    const [act] = await execRows<{ summary: string }>(
      sql`select summary from activity where kind = 'estimate.superseded' and entity_id = ${b.estimateId}`,
    );
    expect(act?.summary).toBe(`Estimate ${b.number} replaced by ${a.number}`);
    expect(canApproveEstimate({ status: "superseded", expiresAt: null })).toBe(
      false,
    );
    await expect(approve(b.estimateId, b.optionId)).rejects.toThrow(
      /replaced by a newer one/,
    );
    expect((await getChangeOrderStatus(jobId)).signedTotalCents).toBe(11500);
    const rates = await getCloseRates({});
    const total = rates.reduce(
      (n, r) => n + r.approved + r.declined + r.expired + r.open,
      0,
    );
    // Created by the system (no author) here, so no row counts them at all; the
    // per-status counts never include a superseded estimate.
    expect(total).toBe(0);
  });

  it("close rate: a superseded estimate by a tech counts neither way", async () => {
    const jobId = await newJob();
    const author = { kind: "user", userId: admin.id } as const;
    const mk = () =>
      inTx((tx) =>
        createEstimateDraft(tx, { customerId, jobId }, author as never),
      );
    const a = await mk();
    const b = await mk();
    const [optA] = await db
      .select()
      .from(estimateOptions)
      .where(eq(estimateOptions.estimateId, a.estimateId));
    await addOptionLines(optA?.id as string, [svc("Rekey", 11500)]);
    await approve(a.estimateId, optA?.id as string);
    expect(await statusOf(b.estimateId)).toBe("superseded");
    const mine = (await getCloseRates({})).find((r) => r.userId === admin.id);
    expect(mine).toMatchObject({ approved: 1, declined: 0, expired: 0 });
    expect(mine?.rate).toBe(100);
  });

  it("a newer approved estimate is the signed total; earlier change orders fold in", async () => {
    const jobId = await newJob();
    const first = await newEstimate(jobId);
    await addOptionLines(first.optionId, [svc("Rekey", 11500)]);
    await approve(first.estimateId, first.optionId);
    const co = await inTx((tx) =>
      createChangeOrderTx(tx, { jobId, reason: "Third door" }, SYSTEM_ACTOR),
    );
    await inTx(async (tx) => {
      await insertLines(tx, "change_order", co.changeOrderId, [
        svc("Rekey a third door", 4000),
      ]);
      await recomputeChangeOrder(tx, co.changeOrderId);
    });
    await inTx((tx) =>
      approveChangeOrderTx(
        tx,
        { changeOrderId: co.changeOrderId, sign: verbal },
        SYSTEM_ACTOR,
      ),
    );
    // The new estimate starts from both and adds a deadbolt.
    const second = await newEstimate(jobId);
    expect(second.lines.map((l) => l.name)).toEqual([
      "Rekey",
      "Rekey a third door",
    ]);
    await addOptionLines(second.optionId, [svc("Deadbolt", 12900)]);
    await approve(second.estimateId, second.optionId);
    const { inv, lines } = await invoiceOf(jobId);
    expect(lines.map((l) => l.name)).toEqual([
      "Rekey",
      "Rekey a third door",
      "Deadbolt",
    ]);
    expect(inv?.totalCents).toBe(28400);
    const st = await getChangeOrderStatus(jobId);
    expect(st.signedTotalCents).toBe(28400);
    expect(st.required).toBe(false);
    expect(await statusOf(first.estimateId)).toBe("approved");
  });
});

describe("J-1070: the invoice stays put and needs no change order", () => {
  it("an unchanged estimate on a $876.89 job keeps it at $876.89", async () => {
    const jobId = await newJob("Grade 1 deadbolts (front + back)");
    // Seeded the way the demo does: stock parts with no stock move, plus labor.
    await addLine(jobId, {
      type: "part",
      pricebookItemId: deadboltId,
      name: "Grade 1 deadbolt",
      qty: 2,
      unitPriceCents: 12900,
      taxable: true,
      partSource: "company_stock",
    });
    await addLine(jobId, {
      type: "part",
      name: "Smart lock",
      qty: 1,
      unitPriceCents: 35000,
      taxable: true,
      partSource: "company_stock",
    });
    await addLine(jobId, svc("Installation", 17000, { type: "labor" }));
    await addLine(jobId, svc("Key duplication", 6000));
    const before = await invoiceOf(jobId);
    const total = before.inv?.totalCents as number;
    expect(total).toBeGreaterThan(0);
    const est = await newEstimate(jobId);
    expect(est.lines).toHaveLength(4);
    await approve(est.estimateId, est.optionId);
    const after = await invoiceOf(jobId);
    expect(after.inv?.totalCents).toBe(total);
    expect(after.lines).toHaveLength(4);
    const st = await getChangeOrderStatus(jobId);
    expect(st.signedTotalCents).toBe(total);
    expect(st.required).toBe(false);
  });
});
