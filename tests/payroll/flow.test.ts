// B6 integration: parts → job financials → ledger → settlement → payout → NACHA →
// custody, on a private throwaway PGlite (TEST_PGLITE_ROOT, default OS temp dir).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b6-test-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

// Read DAL calls requireUser()/requireAnyPerm(); tests choose the user directly.
const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  const need = async (perms: string[], any: boolean) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    const ok = any
      ? perms.length === 0 ||
        perms.some((p) => auth.user?.perms.has(p as never))
      : perms.every((p) => auth.user?.perms.has(p as never));
    if (!ok) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, perms.join("|"));
    }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string | string[]) =>
      need(perm ? (Array.isArray(perm) ? perm : [perm]) : [], false),
    requireAnyPerm: (perms: readonly string[]) => need([...perms], true),
  };
});

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  approvals,
  cashRemittances,
  customers,
  invoices,
  jobAssignments,
  jobs,
  ledgerEntries,
  lineItems,
  partPurchases,
  payments,
  payPeriods,
  properties,
  settlements,
  users,
} from "@/db/schema";
import "@/db/seed/register";
import { makeDemoCtx } from "@/db/seed/demo";
import { seedDemo as seedCore } from "@/db/seed/demo-core";
import { seedId } from "@/db/seed/demo-ids";
import { DEMO } from "@/db/seed/demo-plan";
import { decideApproval } from "@/features/approvals/api";
import { createPartPurchase } from "@/features/parts/api";
import {
  decideRemittance,
  recordRemittance,
} from "@/features/payroll/server/cash";
import { custodyFor } from "@/features/payroll/server/custody";
import { recomputeJobFinancials } from "@/features/payroll/server/financials";
import { exportNacha, recordPayout } from "@/features/payroll/server/payouts";
import {
  approveSettlement,
  closePayPeriod,
  closeWithoutPayout,
  generateSettlements,
} from "@/features/payroll/server/settlements";
import { encrypt } from "@/lib/crypto";
import { updateSettings } from "@/lib/settings";
import { addDaysToKey, dateKey } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const tech1 = seedId("user", "tech1");
const tech2 = seedId("user", "tech2");
const adminId = seedId("user", "admin");
const admin = { kind: "user" as const, userId: adminId };

let customerId = "";
let propertyId = "";
let n = 0;

/** A completed, paid job for `tech` with the given lines and payments. */
async function job(i: {
  tech: string;
  completedAt: Date;
  lines: {
    type: string;
    name: string;
    qty: number;
    price: number;
    cost?: number;
    source?: string;
  }[];
  pays: {
    method: string;
    amount: number;
    tip?: number;
    fee?: number;
    collectedBy?: string | null;
  }[];
}) {
  n++;
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-T${n}`,
      customerId,
      propertyId,
      title: `Test job ${n}`,
      status: "completed",
      completedAt: i.completedAt,
      createdAt: i.completedAt,
    })
    .returning();
  if (!j) throw new Error("job");
  await db
    .insert(jobAssignments)
    .values({ jobId: j.id, userId: i.tech, role: "primary", splitBps: 10000 });
  const total = i.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const [inv] = await db
    .insert(invoices)
    .values({
      number: `INV-T${n}`,
      customerId,
      jobId: j.id,
      status: "paid",
      subtotalCents: total,
      totalCents: total,
      issuedAt: i.completedAt,
    })
    .returning();
  if (!inv) throw new Error("invoice");
  await db.insert(lineItems).values(
    i.lines.map((l) => ({
      parentType: "invoice",
      parentId: inv.id,
      type: l.type,
      name: l.name,
      qty: l.qty,
      unitPriceCents: l.price,
      unitCostCents: l.cost ?? null,
      totalCents: l.qty * l.price,
      partSource: l.source ?? null,
      taxable: false,
    })),
  );
  for (const p of i.pays)
    await db.insert(payments).values({
      invoiceId: inv.id,
      jobId: j.id,
      customerId,
      kind: "payment",
      method: p.method,
      provider: p.method === "card" ? "stripe" : "manual",
      status: "succeeded",
      amountCents: p.amount,
      tipCents: p.tip ?? 0,
      feeCents: p.fee ?? 0,
      collectedByUserId: p.collectedBy ?? null,
      succeededAt: i.completedAt,
    });
  return j.id;
}

const ledgerSum = async (userId: string, jobId?: string) => {
  const rows = await db
    .select({ type: ledgerEntries.type, amount: ledgerEntries.amountCents })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        jobId ? eq(ledgerEntries.jobId, jobId) : undefined,
      ),
    );
  return rows.reduce((a, r) => a + r.amount, 0);
};

let lastWeekEnd = "";
let lastWeekStart = "";

beforeAll(async () => {
  await ensureDb();
  const now = new Date();
  const ctx = makeDemoCtx(now, () => {});
  await seedCore(db, ctx);
  const [c] = await db
    .insert(customers)
    .values({ displayName: "Test Customer" })
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
  // Weekly periods starting Monday; "last week" is fully in the past.
  const today = dateKey(now, TZ);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = addDaysToKey(today, -((dow + 6) % 7));
  lastWeekStart = addDaysToKey(thisMonday, -7);
  lastWeekEnd = addDaysToKey(thisMonday, -1);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

const midLastWeek = () =>
  new Date(`${addDaysToKey(lastWeekStart, 2)}T17:00:00Z`);

describe("B6 money path", () => {
  let jobA = "";
  let jobB = "";

  it("demo users exist with worker types", async () => {
    const [u1] = await db.select().from(users).where(eq(users.id, tech1));
    const [u2] = await db.select().from(users).where(eq(users.id, tech2));
    expect(u1?.workerType).toBe("1099");
    expect(u2?.workerType).toBe("w2");
    expect(DEMO.users.length).toBe(5);
  });

  it("case A: tech-paid part auto-approves and the job posts +125.75", async () => {
    jobA = await job({
      tech: tech1,
      completedAt: midLastWeek(),
      lines: [
        { type: "service", name: "Service", qty: 1, price: 30000 },
        {
          type: "part",
          name: "Part",
          qty: 1,
          price: 10000,
          cost: 4000,
          source: "company_stock",
        },
      ],
      pays: [{ method: "card", amount: 40000, tip: 2000, fee: 1260 }],
    });
    const r = await db.transaction((tx) =>
      createPartPurchase(
        tx,
        {
          paidBy: "tech",
          purchaserUserId: tech1,
          category: "part",
          jobId: jobA,
          vendor: "Home Depot",
          purchasedOn: addDaysToKey(lastWeekStart, 2),
          totalCents: 2500,
          receiptMediaId: null,
        },
        SYSTEM_ACTOR,
      ),
    );
    // receipt_required_over_cents = 0 → no receipt = review (approvals row).
    expect(r.status).toBe("pending");
    const [a] = await db
      .select()
      .from(approvals)
      .where(eq(approvals.entityId, r.partPurchaseId));
    expect(a?.status).toBe("pending");
    await db.transaction((tx) =>
      decideApproval(tx, a?.id ?? "", { decision: "approved" }, admin),
    );
    const [pp] = await db
      .select()
      .from(partPurchases)
      .where(eq(partPurchases.id, r.partPurchaseId));
    expect(pp?.status).toBe("approved");
    await db.transaction((tx) =>
      recomputeJobFinancials(tx, jobA, SYSTEM_ACTOR, "test"),
    );
    expect(await ledgerSum(tech1, jobA)).toBe(12575);
    // Idempotent: a second recompute posts nothing.
    const again = await db.transaction((tx) =>
      recomputeJobFinancials(tx, jobA, SYSTEM_ACTOR, "test"),
    );
    expect(again.posted + again.reversed).toBe(0);
  });

  it("case B: cash kept by a 1099 tech nets −202.50", async () => {
    jobB = await job({
      tech: tech1,
      completedAt: midLastWeek(),
      lines: [{ type: "service", name: "Service", qty: 1, price: 30000 }],
      pays: [{ method: "cash", amount: 30000, collectedBy: tech1 }],
    });
    await db.transaction(async (tx) => {
      const { partPurchaseId } = await createPartPurchase(
        tx,
        {
          paidBy: "tech",
          purchaserUserId: tech1,
          category: "part",
          jobId: jobB,
          purchasedOn: addDaysToKey(lastWeekStart, 2),
          totalCents: 3000,
        },
        SYSTEM_ACTOR,
      );
      const [a] = await tx
        .select()
        .from(approvals)
        .where(eq(approvals.entityId, partPurchaseId));
      await decideApproval(tx, a?.id ?? "", { decision: "approved" }, admin);
    });
    expect(await ledgerSum(tech1, jobB)).toBe(-20250);
    const c = (await custodyFor([tech1]))[tech1];
    expect(c?.heldCents).toBe(30000);
  });

  it("a changed invoice reverses and reposts before lock", async () => {
    await db
      .update(payments)
      .set({ tipCents: 3000 })
      .where(eq(payments.jobId, jobA));
    const r = await db.transaction((tx) =>
      recomputeJobFinancials(tx, jobA, SYSTEM_ACTOR, "test"),
    );
    expect(r.reversed).toBeGreaterThan(0);
    // fee pro rata moves with the tip: 1260×40000/43000 → 1172 on base
    expect(await ledgerSum(tech1, jobA)).toBe(13582);
    await db
      .update(payments)
      .set({ tipCents: 2000 })
      .where(eq(payments.jobId, jobA));
    await db.transaction((tx) =>
      recomputeJobFinancials(tx, jobA, SYSTEM_ACTOR, "test"),
    );
    expect(await ledgerSum(tech1, jobA)).toBe(12575);
  });

  it("W-2 card job: cash never netted, settlement approves and pays by direct deposit", async () => {
    const jobC = await job({
      tech: tech2,
      completedAt: midLastWeek(),
      lines: [{ type: "service", name: "Service", qty: 1, price: 25000 }],
      pays: [{ method: "card", amount: 25000, fee: 750 }],
    });
    await db.transaction((tx) =>
      recomputeJobFinancials(tx, jobC, SYSTEM_ACTOR, "test"),
    );
    // 250 − 7.50 = 242.50 × 25% = 60.63 (roundHalfAway 6062.5 → 6063)
    expect(await ledgerSum(tech2, jobC)).toBe(6063);
  });

  it("closing last week drafts statements; approval freezes; payouts lock", async () => {
    await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.startsOn, lastWeekStart));
      expect(p).toBeTruthy();
      await closePayPeriod(tx, p?.id ?? "", admin);
      await generateSettlements(tx, p?.id ?? "", admin);
    });
    const rows = await db.select().from(settlements);
    const s1 = rows.find((r) => r.userId === tech1);
    const s2 = rows.find((r) => r.userId === tech2);
    expect(s1?.status).toBe("tech_review");
    expect(s1?.closingBalanceCents).toBe(12575 - 20250);
    expect(s2?.closingBalanceCents).toBe(6063);

    // tech1 negative → approve + close without payout (carry forward).
    await db.transaction(async (tx) => {
      const a = await approveSettlement(tx, s1?.id ?? "", admin, {
        force: true,
      });
      expect(a.status).toBe("approved");
      await closeWithoutPayout(tx, s1?.id ?? "", admin);
    });
    const [locked1] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.id, s1?.id ?? ""));
    expect(locked1?.status).toBe("locked");
    // Netted cash left custody.
    expect((await custodyFor([tech1]))[tech1]?.heldCents).toBe(0);

    // tech2: bank details + NACHA export.
    await db
      .update(users)
      .set({
        bankRoutingEnc: encrypt("021000021"),
        bankAccountEnc: encrypt("5566778899"),
        bankLast4: "8899",
        bankAccountType: "checking",
        bankHolderType: "personal",
        bankChangedAt: new Date(Date.now() - 10 * 86_400_000),
      })
      .where(eq(users.id, tech2));
    await db.transaction((tx) =>
      updateSettings(
        tx,
        {
          payroll: {
            nacha_enabled: true,
            nacha: {
              immediate_destination: "011000015",
              immediate_destination_name: "FED RESERVE",
              immediate_origin: "1123456789",
              immediate_origin_name: "ACME HOME",
              company_name: "ACME HOME",
              company_id: "1123456789",
              odfi_routing: "011000015",
              entry_description: "PAYROLL",
            },
          },
        },
        admin,
      ),
    );
    const file = await db.transaction(async (tx) => {
      await approveSettlement(tx, s2?.id ?? "", admin, { force: true });
      return exportNacha(
        tx,
        {
          settlementIds: [s2?.id ?? ""],
          effectiveDate: addDaysToKey(lastWeekEnd, 3),
        },
        admin,
      );
    });
    expect(file.included).toHaveLength(1);
    const lines = file.content.split("\n").filter(Boolean);
    expect(lines.every((l) => l.length === 94)).toBe(true);
    expect(lines.length % 10).toBe(0);
    const [paid2] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.id, s2?.id ?? ""));
    expect(paid2?.status).toBe("locked");
    expect(await ledgerSum(tech2)).toBe(0); // 6063 − payout 6063
  });

  it("a locked job change becomes one adjustment in the open period", async () => {
    await db
      .update(payments)
      .set({ tipCents: 2500 })
      .where(eq(payments.jobId, jobA));
    const r = await db.transaction((tx) =>
      recomputeJobFinancials(tx, jobA, SYSTEM_ACTOR, "test"),
    );
    expect(r.locked).toBe(true);
    const adj = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.jobId, jobA),
          eq(ledgerEntries.type, "adjustment"),
        ),
      );
    // +5.00 tip, +0.04 commission (a smaller share of the fee lands on the base)
    expect(adj.map((a) => a.amountCents)).toEqual([504]);
  });

  it("cash hand-in for a separate-remittance tech clears custody; checks are never netted", async () => {
    await job({
      tech: tech2,
      completedAt: new Date(),
      lines: [{ type: "service", name: "Service", qty: 1, price: 12000 }],
      pays: [{ method: "check", amount: 12000, collectedBy: tech2 }],
    });
    expect((await custodyFor([tech2]))[tech2]?.checksHeldCents).toBe(12000);
    const { remittanceId } = await db.transaction((tx) =>
      recordRemittance(
        tx,
        { userId: tech2, amountCents: 12000, method: "hand_in" },
        { kind: "user", userId: tech2 },
      ),
    );
    await db.transaction((tx) =>
      decideRemittance(tx, remittanceId, "confirmed", admin),
    );
    const [r] = await db
      .select()
      .from(cashRemittances)
      .where(eq(cashRemittances.id, remittanceId));
    expect(r?.status).toBe("confirmed");
    expect((await custodyFor([tech2]))[tech2]?.heldCents).toBe(0);
  });

  it("non-job tech purchase posts reimbursement_expense on approval", async () => {
    const { partPurchaseId } = await db.transaction((tx) =>
      createPartPurchase(
        tx,
        {
          paidBy: "tech",
          purchaserUserId: tech2,
          category: "fuel",
          purchasedOn: dateKey(new Date(), TZ),
          totalCents: 6000,
        },
        SYSTEM_ACTOR,
      ),
    );
    const [a] = await db
      .select()
      .from(approvals)
      .where(eq(approvals.entityId, partPurchaseId));
    await db.transaction((tx) =>
      decideApproval(
        tx,
        a?.id ?? "",
        { decision: "approved", edits: { totalCents: 5900 } },
        admin,
      ),
    );
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.refId, partPurchaseId),
          eq(ledgerEntries.type, "reimbursement_expense"),
        ),
      );
    expect(rows.map((r) => r.amountCents)).toEqual([5900]);
  });

  it("read DAL: pay, statements, settlements, reports, parts, inventory, approvals", async () => {
    const { loadSessionUser } = await import("@/lib/auth/current");
    const q = await import("@/features/payroll/queries");
    const pq = await import("@/features/parts/queries");
    const aq = await import("@/features/approvals/queries");
    auth.user = await loadSessionUser(tech1, "test-session");
    const o = await q.getPayOverview();
    expect(o.custody).toBeTruthy();
    const list = await q.listStatements();
    expect(list.length).toBe(1);
    const st = await q.getStatement(list[0]?.id ?? "");
    expect(st.jobLines.map((j) => j.postedCents).sort()).toEqual(
      [-20250, 12575].sort(),
    );
    expect(await pq.listPurchases("mine")).not.toHaveLength(0);
    expect((await q.getPayOverviewFor(tech1)).toAck).toBe(1);
    auth.user = await loadSessionUser(adminId, "test-session");
    expect((await q.listSettlementsForAdmin({})).length).toBe(2);
    const rep = await q.getPayrollReports();
    expect(rep.perTech.length).toBeGreaterThan(0);
    const cs = await q.getCommissionSettings();
    expect(cs.latest.map((p) => p.planKey)).toContain("partner_25");
    expect(await q.techCompSummary(tech2)).toBeTruthy();
    const flags = await pq.listPartFlags();
    expect(flags).toHaveProperty("losses");
    expect(await pq.receiptPickers(auth.user as never)).toHaveProperty("jobs");
    const inv = await pq.getInventory(null);
    expect(inv.manage).toBe(true);
    const ap = await aq.listApprovals({});
    expect(ap.kinds.length).toBeGreaterThan(0);
    const done = await aq.listApprovals({ scope: "done" });
    expect(done.entries.length).toBeGreaterThan(0);
    for (const e of done.entries) await e.kind.Row({ approval: e.row });
    auth.user = null;
  });

  it("payout guard: can't pay more than owed", async () => {
    const [s] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.userId, tech2));
    await expect(
      db.transaction((tx) =>
        recordPayout(
          tx,
          {
            userId: tech2,
            settlementIds: [s?.id ?? ""],
            method: "zelle",
            amountCents: 1,
            paidOn: lastWeekEnd,
          },
          admin,
        ),
      ),
    ).rejects.toThrow();
    void sql;
  });
});
