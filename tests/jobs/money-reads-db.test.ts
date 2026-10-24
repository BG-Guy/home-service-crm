// The job's money card reads (Quote to Paid, part J2/J3) on a private PGlite: the
// light estimates select with tax-inclusive option totals, the lead-quote line
// that doesn't count as billing, the deposit that counts, and the batched badge
// read for the /jobs cards. They feed the golden-tested moneyStage().
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-q2p-money-"),
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
  depositRequests,
  estimateOptions,
  estimates,
  invoices,
  jobs,
  lineItems,
  properties,
  taxRates,
} from "@/db/schema";
import "@/db/seed/register";
import { LEAD_QUOTE_LINE_DESCRIPTION } from "@/features/invoices/lead-quote";
import {
  invoiceHasRealLines,
  jobEstimatesForMoney,
  loadJobMoneyFacts,
  moneyStagesFor,
} from "@/features/jobs/money-reads";
import { moneyStage } from "@/features/jobs/money-stage";

const TZ = "America/Denver";
const CUSTOMER = "81111111-1111-4111-8111-111111111111";
const PROPERTY = "82222222-2222-4222-8222-222222222222";
const JOB = "83333333-3333-4333-8333-333333333333";
const QUICK_JOB = "83333333-3333-4333-8333-333333333334";
const ESTIMATE = "84444444-4444-4444-8444-444444444444";
const OLD_ESTIMATE = "84444444-4444-4444-8444-444444444445";
const GOOD = "85555555-5555-4555-8555-555555555551";
const BETTER = "85555555-5555-4555-8555-555555555552";
const INVOICE = "86666666-6666-4666-8666-666666666666";
const QUICK_INVOICE = "86666666-6666-4666-8666-666666666667";

const line = (
  parentType: "estimate_option" | "invoice",
  parentId: string,
  o: {
    name: string;
    cents: number;
    type?: string;
    taxable?: boolean;
    description?: string;
  },
) => ({
  parentType,
  parentId,
  type: o.type ?? "part",
  name: o.name,
  description: o.description ?? null,
  qty: 1,
  unitPriceCents: o.cents,
  totalCents: o.cents,
  taxable: o.taxable ?? true,
});

beforeAll(async () => {
  await ensureDb();
  // 10% default tax so option totals show it's included.
  await db
    .update(taxRates)
    .set({ rateBps: 1000 })
    .where(eq(taxRates.isDefault, true));
  await db.insert(customers).values({
    id: CUSTOMER,
    displayName: "Sophia Taylor",
    firstName: "Sophia",
  });
  await db.insert(properties).values({
    id: PROPERTY,
    customerId: CUSTOMER,
    street: "8106 S Monaco Pkwy",
    city: "Denver",
    state: "CO",
    zip: "80112",
    timezone: TZ,
  });
  await db.insert(jobs).values([
    {
      id: JOB,
      number: "J-9079",
      customerId: CUSTOMER,
      propertyId: PROPERTY,
      title: "Install Grade 1 deadbolts",
      status: "arrived",
    },
    {
      id: QUICK_JOB,
      number: "J-9071",
      customerId: CUSTOMER,
      propertyId: PROPERTY,
      title: "Lockout",
      status: "in_progress",
    },
  ]);
  await db.insert(estimates).values([
    {
      id: OLD_ESTIMATE,
      number: "E-9020",
      jobId: JOB,
      customerId: CUSTOMER,
      status: "declined",
      createdAt: new Date("2026-10-20T15:00:00Z"),
    },
    {
      id: ESTIMATE,
      number: "E-9026",
      jobId: JOB,
      customerId: CUSTOMER,
      status: "sent",
      sentAt: new Date("2026-10-22T15:00:00Z"),
      createdAt: new Date("2026-10-22T14:00:00Z"),
    },
  ]);
  await db.insert(estimateOptions).values([
    { id: GOOD, estimateId: ESTIMATE, label: "Good", sort: 0 },
    {
      id: BETTER,
      estimateId: ESTIMATE,
      label: "Better",
      sort: 1,
      recommended: true,
    },
  ]);
  await db.insert(lineItems).values([
    line("estimate_option", GOOD, { name: "Grade 1 deadbolt", cents: 12900 }),
    line("estimate_option", BETTER, { name: "Grade 1 deadbolt", cents: 25800 }),
    line("estimate_option", BETTER, {
      name: "Installation",
      cents: 17000,
      type: "labor",
      taxable: false,
    }),
  ]);
  // The lead's quoted price: a placeholder until the estimate is approved.
  await db.insert(invoices).values([
    {
      id: INVOICE,
      number: "INV-9067",
      jobId: JOB,
      customerId: CUSTOMER,
      status: "draft",
      totalCents: 15000,
    },
    {
      id: QUICK_INVOICE,
      number: "INV-9071",
      jobId: QUICK_JOB,
      customerId: CUSTOMER,
      status: "draft",
      totalCents: 12500,
    },
  ]);
  await db.insert(lineItems).values([
    line("invoice", INVOICE, {
      name: "Deadbolts",
      cents: 15000,
      type: "service",
      taxable: false,
      description: LEAD_QUOTE_LINE_DESCRIPTION,
    }),
    line("invoice", QUICK_INVOICE, {
      name: "Lockout",
      cents: 12500,
      type: "service",
      taxable: false,
    }),
  ]);
  await db.insert(depositRequests).values({
    jobId: JOB,
    estimateId: ESTIMATE,
    amountCents: 9000,
    mode: "manual",
    status: "required",
  });
}, 180_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

const invoiceSummary = (id: string, number: string, total: number) => ({
  id,
  number,
  jobId: null,
  customerId: CUSTOMER,
  status: "draft" as const,
  version: 1,
  issuedAt: null,
  dueAt: null,
  subtotalCents: total,
  discountCents: 0,
  taxCents: 0,
  totalCents: total,
  balanceCents: total,
});

describe("money card reads", () => {
  it("reads the job's estimates with tax-inclusive option totals", async () => {
    const list = await jobEstimatesForMoney(JOB);
    expect(list.map((e) => e.number)).toEqual(["E-9026", "E-9020"]);
    const e = list[0];
    expect(e?.optionCount).toBe(2);
    expect(e?.hasLines).toBe(true);
    // Better (recommended): $258 part + 10% tax + $170 labor (not taxed).
    expect(e?.totalCents).toBe(25800 + 2580 + 17000);
    // Good: $129 + 10% tax.
    expect(e?.fromCents).toBe(12900 + 1290);
    expect(e?.recommendedLabel).toBe("Better");
    expect(e?.approvedLabel).toBeNull();
    expect(list[1]?.hasLines).toBe(false);
  });

  it("the lead's quoted price isn't billing; a real line is", async () => {
    expect(await invoiceHasRealLines(INVOICE)).toBe(false);
    expect(await invoiceHasRealLines(QUICK_INVOICE)).toBe(true);
  });

  it("feeds the rail: present the sent estimate, the deposit waits", async () => {
    const facts = await loadJobMoneyFacts(
      { id: JOB, status: "arrived", customerFirstName: "Sophia" },
      {
        estimatesOn: true,
        invoice: invoiceSummary(INVOICE, "INV-9067", 15000),
      },
    );
    expect(facts.deposit).toEqual({ amountCents: 9000, status: "required" });
    expect(facts.invoice?.hasLines).toBe(false);
    const s = moneyStage(facts, { tz: TZ });
    expect(s.steps.map((x) => x.state)).toEqual([
      "done",
      "now",
      "todo",
      "todo",
      "todo",
    ]);
    expect(s.next).toEqual({
      kind: "present",
      label: "Present to Sophia",
      estimateId: ESTIMATE,
    });
  });

  it("once approved, the deposit is the next step", async () => {
    await db
      .update(estimates)
      .set({
        status: "approved",
        approvedOptionId: BETTER,
        approvedAt: new Date(),
      })
      .where(eq(estimates.id, ESTIMATE));
    const facts = await loadJobMoneyFacts(
      { id: JOB, status: "arrived", customerFirstName: "Sophia" },
      {
        estimatesOn: true,
        invoice: invoiceSummary(INVOICE, "INV-9067", 15000),
      },
    );
    expect(facts.estimates[0]?.approvedLabel).toBe("Better");
    const s = moneyStage(facts, { tz: TZ });
    expect(s.current).toBe("deposit");
    expect(s.color).toBe("invoice");
    expect(s.summary).toBe("Approved · $453.80");
    expect(s.next?.label).toBe("Collect $90 deposit");
  });

  it("an unknown estimate status (e.g. superseded) counts as closed", async () => {
    await db
      .update(estimates)
      .set({ status: "superseded" })
      .where(eq(estimates.id, OLD_ESTIMATE));
    const facts = await loadJobMoneyFacts(
      { id: JOB, status: "arrived", customerFirstName: "Sophia" },
      { estimatesOn: true, invoice: null },
    );
    expect(moneyStage(facts, { tz: TZ }).current).toBe("deposit");
  });

  it("batches the card badges for a page of jobs", async () => {
    const map = await moneyStagesFor([JOB, QUICK_JOB], {
      estimatesOn: true,
      tz: TZ,
    });
    expect(map.get(JOB)?.badge).toBe("Deposit due");
    expect(map.get(JOB)?.color).toBe("invoice");
    // The lockout: no estimate, billed directly.
    const quick = map.get(QUICK_JOB);
    expect(quick?.steps.map((x) => x.state).slice(0, 3)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(quick?.badge).toBe("Invoice draft");
    expect(await moneyStagesFor([], { estimatesOn: true, tz: TZ })).toEqual(
      new Map(),
    );
  });
});
