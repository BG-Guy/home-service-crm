// Insights KPI SQL (SPEC M20; BUILD_PLAN §9 B8 tests) on a throwaway PGlite with a
// hand-built fixture whose expected values are worked out in the comments.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b8-kpi-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";

import { sql } from "drizzle-orm";
import { closeDb, ensureDb, execRows } from "@/db";
import {
  getAdminKpis,
  getAnomalies,
  getArAging,
  getDisputeStats,
  getLeadSourceRoi,
  getTechLeaderboard,
  getUnsoldEstimates,
  toCsv,
} from "@/features/insights/kpis";
import { getOpsData, getTechStats } from "@/features/insights/ops";
import { resolvePeriod } from "@/features/insights/period";
import { getSetupChecklist } from "@/features/insights/setup";
import { resolvePerms } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-15T15:00:00Z");
const P = resolvePeriod(
  { period: "custom", from: "2026-10-01", to: "2026-10-15" },
  NOW,
  TZ,
);
const id = () => randomUUID();
const ids = {
  admin: id(),
  t1: id(),
  t2: id(),
  c: id(),
  p: id(),
  j0: id(),
  j1: id(),
  j2: id(),
  j3: id(),
  j4: id(),
  j5: id(),
  j6: id(),
  jx: id(),
  src: id(),
  pay1: id(),
  pay2: id(),
  payOld: id(),
};
/** Chicago wall time on an October 2026 day (CDT = UTC−5). */
const oct = (day: number, hh = 10, mm = 0) =>
  new Date(Date.UTC(2026, 9, day, hh + 5, mm)).toISOString();

async function run(q: ReturnType<typeof sql>) {
  await execRows(q);
}

function sessionUser(
  uid: string,
  role: "admin" | "office" | "tech",
): SessionUser {
  return {
    id: uid,
    email: `${uid}@t.test`,
    name: role,
    firstName: role,
    role,
    baseRole: role,
    status: "active",
    workerType: "1099",
    usesCompanyTools: true,
    usesCompanyVehicle: true,
    monitoringNoticeAckAt: null,
    perms: resolvePerms({ role, baseRole: role }),
    sessionId: id(),
  } as SessionUser;
}

beforeAll(async () => {
  await ensureDb();
  await run(sql`insert into company (id, name, timezone, state) values (1, 'KPI Test Co', ${TZ}, 'TX')
    on conflict (id) do update set timezone = excluded.timezone`);
  await run(sql`insert into users (id, email, name, role) values
    (${ids.admin}, 'a@t.test', 'Ada Admin', 'admin'),
    (${ids.t1}, 't1@t.test', 'Tom One', 'tech'),
    (${ids.t2}, 't2@t.test', 'Tia Two', 'tech')`);
  await run(
    sql`insert into customers (id, display_name) values (${ids.c}, 'Casey Customer')`,
  );
  await run(sql`insert into properties (id, customer_id, street, city, state, zip)
    values (${ids.p}, ${ids.c}, '1 Main St', 'Austin', 'TX', '78701')`);

  // Jobs. J1, J2 (T1) and J3 (callback of J1), J4 (T2) complete inside the period.
  const job = (
    jid: string,
    n: number,
    status: string,
    extra: {
      sched?: string;
      done?: string;
      cancel?: string;
      arrived?: string;
      reason?: string;
      callbackOf?: string;
      readiness?: number;
    },
  ) =>
    run(sql`insert into jobs (id, number, customer_id, property_id, title, status, scheduled_start,
        completed_at, cancelled_at, arrived_at, cancel_reason, callback_of_job_id, is_callback, readiness_score)
      values (${jid}, ${`J-${n}`}, ${ids.c}, ${ids.p}, 'Job', ${status}, ${extra.sched ?? null}::timestamptz,
        ${extra.done ?? null}::timestamptz, ${extra.cancel ?? null}::timestamptz, ${extra.arrived ?? null}::timestamptz,
        ${extra.reason ?? null}, ${extra.callbackOf ?? null}::uuid, ${!!extra.callbackOf}, ${extra.readiness ?? null})`);
  await job(ids.j0, 1000, "completed", {
    sched: "2026-08-31T15:00:00Z",
    done: "2026-08-31T18:00:00Z",
  });
  await job(ids.j1, 1001, "completed", {
    sched: oct(5, 9),
    done: oct(5, 12),
    readiness: 80,
  });
  await job(ids.j2, 1002, "completed", {
    sched: oct(9, 9),
    done: oct(9, 12),
    readiness: 60,
  });
  await job(ids.j3, 1003, "completed", {
    sched: oct(10, 9),
    done: oct(10, 11),
    callbackOf: ids.j1,
  });
  await job(ids.j4, 1004, "completed", {
    sched: oct(11, 9),
    done: oct(11, 12),
  });
  await job(ids.j5, 1005, "cancelled", {
    sched: oct(12, 9),
    cancel: oct(12, 10),
    arrived: oct(12, 9, 30),
    reason: "customer_no_show",
  });
  await job(ids.j6, 1006, "scheduled", { sched: oct(13, 9) });
  await job(ids.jx, 999, "closed", {
    sched: "2026-08-20T15:00:00Z",
    done: "2026-08-20T18:00:00Z",
  });
  for (const [j, u] of [
    [ids.j0, ids.t2],
    [ids.j1, ids.t1],
    [ids.j2, ids.t1],
    [ids.j3, ids.t2],
    [ids.j4, ids.t2],
    [ids.j5, ids.t2],
    [ids.j6, ids.t1],
  ] as const)
    await run(
      sql`insert into job_assignments (job_id, user_id, role) values (${j}, ${u}, 'primary')`,
    );
  await run(sql`insert into job_status_events (job_id, to_status, at, distance_m)
    values (${ids.j5}, 'arrived', ${oct(12, 9, 30)}::timestamptz, 40)`);

  // Invoices (numbers I-1000…I-1004 with I-1003 missing → one gap).
  const inv = (
    n: number,
    job: string,
    status: string,
    issued: string,
    sub: number,
    disc: number,
    total: number,
    due: string,
  ) =>
    run(sql`insert into invoices (id, number, job_id, customer_id, status, issued_at, due_at, subtotal_cents, discount_cents, tax_cents, total_cents)
      values (${id()}, ${`I-${n}`}, ${job}, ${ids.c}, ${status}, ${issued}::timestamptz, ${due}::timestamptz, ${sub}, ${disc}, ${total - (sub - disc)}, ${total})
      returning id`);
  await inv(
    1000,
    ids.j0,
    "issued",
    "2026-08-31T18:00:00Z",
    10000,
    0,
    10000,
    "2026-09-30T18:00:00Z",
  );
  await inv(1001, ids.j1, "paid", oct(5, 12), 50000, 0, 54125, oct(5, 12));
  await inv(1002, ids.j2, "paid", oct(9, 12), 20000, 6000, 14000, oct(9, 12));
  await inv(1004, ids.j4, "issued", oct(11, 12), 30000, 0, 30000, oct(12, 12));
  const invoiceId = async (n: string) =>
    (
      await execRows<{ id: string }>(
        sql`select id from invoices where number = ${n}`,
      )
    )[0]?.id as string;

  // Payments: card on J1, unverified cash on J2 (collected by T1), an old card payment on JX.
  await run(sql`insert into payments (id, invoice_id, job_id, customer_id, kind, method, provider, status, amount_cents, succeeded_at, created_at)
    values (${ids.pay1}, ${await invoiceId("I-1001")}, ${ids.j1}, ${ids.c}, 'payment', 'card', 'stripe', 'succeeded', 54125, ${oct(5, 12)}::timestamptz, ${oct(5, 12)}::timestamptz)`);
  await run(sql`insert into payments (id, invoice_id, job_id, customer_id, kind, method, provider, status, amount_cents, succeeded_at, created_at, collected_by_user_id)
    values (${ids.pay2}, ${await invoiceId("I-1002")}, ${ids.j2}, ${ids.c}, 'payment', 'cash', 'manual', 'succeeded', 14000, ${oct(9, 12)}::timestamptz, ${oct(9, 12)}::timestamptz, ${ids.t1})`);
  await run(sql`insert into payments (id, job_id, customer_id, kind, method, provider, status, amount_cents, succeeded_at, created_at, verified_at)
    values (${ids.payOld}, ${ids.jx}, ${ids.c}, 'payment', 'card', 'stripe', 'succeeded', 20000, '2026-08-20T18:00:00Z', '2026-08-20T18:00:00Z', '2026-08-20T18:00:00Z')`);
  await run(sql`insert into refunds (payment_id, amount_cents, reason, status, created_at)
    values (${ids.pay1}, 5000, 'goodwill', 'succeeded', ${oct(7)}::timestamptz)`);

  // Disputes: one open in the last 30 days, one won ~60 days ago.
  await run(sql`insert into disputes (payment_id, provider, provider_ref, category, amount_cents, status, created_at) values
    (${ids.pay1}, 'stripe', 'dp_1', 'product_unacceptable', 54125, 'needs_response', ${oct(8)}::timestamptz),
    (${ids.payOld}, 'stripe', 'dp_0', 'fraudulent', 20000, 'won', '2026-08-22T18:00:00Z')`);

  // Financials for margin and company net.
  await run(sql`insert into job_financials (job_id, revenue_cents, tax_cents, tip_cents, company_parts_cents, tech_parts_cents,
      fees_cents, fees_on_tips_cents, base_cents, company_net_cents, plan_key, plan_version, trace) values
    (${ids.j1}, 50000, 4125, 0, 5000, 0, 1600, 0, 43400, 30000, 'partner_25', 1, '{}'::jsonb),
    (${ids.j2}, 14000, 0, 0, 0, 0, 0, 0, 14000, 9000, 'partner_25', 1, '{}'::jsonb)`);
  await run(sql`insert into job_earnings (job_id, user_id, split_bps, rate_bps, rate_source, commission_cents, spiffs_cents,
      tip_cents, reimbursement_cents, cash_held_cents, net_cents, trace) values
    (${ids.j1}, ${ids.t1}, 10000, 2500, 'plan', 12500, 1000, 0, 0, 0, 13500, '{}'::jsonb),
    (${ids.j2}, ${ids.t1}, 10000, 2500, 'plan', 3500, 0, 0, 500, 14000, -10000, '{}'::jsonb)`);

  // Ledger: commission + spiff count toward payroll cost; tips and reimbursements don't.
  await run(sql`insert into ledger_entries (user_id, type, amount_cents, effective_date) values
    (${ids.t1}, 'commission', 20000, '2026-10-05'),
    (${ids.t1}, 'spiff', 1000, '2026-10-05'),
    (${ids.t1}, 'tip', 500, '2026-10-05'),
    (${ids.t1}, 'reimbursement_parts', 3000, '2026-10-06')`);

  // Estimates sent in the period: approved, declined, expired, still open.
  for (const [n, status] of [
    [1, "approved"],
    [2, "declined"],
    [3, "expired"],
    [4, "sent"],
  ] as const)
    await run(sql`insert into estimates (id, number, customer_id, job_id, status, sent_at, created_by, expires_at)
      values (${id()}, ${`E-${n}`}, ${ids.c}, ${ids.j1}, ${status}, ${oct(3)}::timestamptz, ${ids.t1}, '2026-12-01T00:00:00Z')`);
  const e4 = (
    await execRows<{ id: string }>(
      sql`select id from estimates where number = 'E-4'`,
    )
  )[0]?.id as string;
  const o1 = id();
  const o2 = id();
  await run(
    sql`insert into estimate_options (id, estimate_id, label, sort) values (${o1}, ${e4}, 'Good', 0), (${o2}, ${e4}, 'Best', 1)`,
  );
  await run(sql`insert into line_items (parent_type, parent_id, type, name, qty, unit_price_cents, total_cents) values
    ('estimate_option', ${o1}, 'service', 'Rekey', 1, 12000, 12000),
    ('estimate_option', ${o2}, 'service', 'Replace', 1, 30000, 30000),
    ('estimate_option', ${o2}, 'part', 'Smart lock', 1, 25000, 25000)`);

  // Leads: 3 real (speeds 3, 10, 20 min; one booked) + 1 spam.
  await run(
    sql`insert into lead_sources (id, name, kind) values (${ids.src}, 'Google LSA', 'google_lsa')`,
  );
  await run(
    sql`insert into source_spend (lead_source_id, month, amount_cents) values (${ids.src}, '2026-10-01', 31000)`,
  );
  await run(sql`insert into leads (lead_source_id, status, name, created_at, first_response_at, source_cost_cents, converted_job_id) values
    (${ids.src}, 'booked', 'L1', ${oct(2, 9)}::timestamptz, ${oct(2, 9, 3)}::timestamptz, 2000, ${ids.j1}),
    (${ids.src}, 'lost', 'L2', ${oct(3, 9)}::timestamptz, ${oct(3, 9, 10)}::timestamptz, 2000, null),
    (null, 'contacted', 'L3', ${oct(4, 9)}::timestamptz, ${oct(4, 9, 20)}::timestamptz, null, null),
    (null, 'spam', 'L4', ${oct(4, 9)}::timestamptz, null, null, null)`);

  // Review requests: 2 sent, 1 clicked.
  await run(sql`insert into review_requests (job_id, customer_id, tech_user_id, first_sent_at, clicked_at) values
    (${ids.j1}, ${ids.c}, ${ids.t1}, ${oct(6)}::timestamptz, ${oct(6, 12)}::timestamptz),
    (${ids.j2}, ${ids.c}, ${ids.t1}, ${oct(10)}::timestamptz, null)`);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("admin KPIs (SPEC M20 formulas)", () => {
  it("collected, invoiced, avg ticket, completed, margin, company net", async () => {
    const k = await getAdminKpis(P);
    // 54,125 card + 14,000 cash − 5,000 refund (the Aug card payment is outside)
    expect(k.collectedCents).toBe(63_125);
    expect(k.refundedCents).toBe(5_000);
    // (50,000 − 0) + (20,000 − 6,000) + 30,000; I-1000 was issued in August
    expect(k.invoicedCents).toBe(94_000);
    expect(k.jobsCompleted).toBe(4);
    expect(k.ticketJobs).toBe(3);
    expect(k.avgTicketCents).toBe(Math.round(94_000 / 3));
    // (64,000 − 5,000 parts − 1,600 fees − 17,000 commission+spiffs − 500 reimb) ÷ 64,000
    expect(k.grossMarginPct).toBeCloseTo(39_900 / 64_000, 6);
    expect(k.companyNetPerJobCents).toBe(Math.round(39_000 / 4));
  });

  it("estimate close rate, leads, median speed to lead, % within 5 min", async () => {
    const k = await getAdminKpis(P);
    expect([k.estimatesApproved, k.estimatesDecided]).toEqual([1, 3]);
    expect(k.closeRate).toBeCloseTo(1 / 3);
    expect([k.leads, k.leadsBooked]).toEqual([3, 1]); // spam excluded
    expect(k.leadBookedRate).toBeCloseTo(1 / 3);
    expect(k.medianSpeedMin).toBeCloseTo(10);
    expect(k.contacted5Rate).toBeCloseTo(1 / 3);
  });

  it("callback, cancellation, no-show and review click rates", async () => {
    const k = await getAdminKpis(P);
    expect(k.callbacks).toBe(1);
    expect(k.callbackRate).toBeCloseTo(1 / 4);
    expect(k.jobsScheduled).toBe(6);
    expect(k.cancelled).toBe(1);
    expect(k.cancelRate).toBeCloseTo(1 / 6);
    expect(k.noShowRate).toBeCloseTo(1 / 6);
    expect(k.cancelledAfterArrival).toBe(1);
    expect(k.reviewClickRate).toBeCloseTo(0.5);
  });

  it("payroll cost % = commission + spiffs (no tips/reimbursements) ÷ collected", async () => {
    const k = await getAdminKpis(P);
    expect(k.techEarningsCents).toBe(21_000);
    expect(k.payrollCostPct).toBeCloseTo(21_000 / 63_125, 6);
  });

  it("an empty period yields nulls, never NaN", async () => {
    const empty = resolvePeriod(
      { period: "custom", from: "2025-01-01", to: "2025-01-02" },
      NOW,
      TZ,
    );
    const k = await getAdminKpis(empty);
    expect(k.collectedCents).toBe(0);
    expect(k.avgTicketCents).toBeNull();
    expect(k.closeRate).toBeNull();
    expect(k.medianSpeedMin).toBeNull();
    expect(k.payrollCostPct).toBeNull();
  });
});

describe("AR aging, unsold estimates, disputes", () => {
  it("buckets open balances by days since issue", async () => {
    const ar = await getArAging(NOW);
    expect(ar.totalCents).toBe(40_000);
    expect(ar.count).toBe(2);
    expect(ar.buckets["0-30"]).toEqual({ cents: 30_000, count: 1 });
    expect(ar.buckets["31-60"]).toEqual({ cents: 10_000, count: 1 });
    expect(ar.buckets["61-90"].cents + ar.buckets["90+"].cents).toBe(0);
    expect(ar.overdueCount).toBe(2);
  });

  it("unsold value uses the most expensive option", async () => {
    expect(await getUnsoldEstimates(NOW)).toEqual({ cents: 55_000, count: 1 });
  });

  it("dispute rate over trailing 30/90 days of card payments; win rate", async () => {
    const d = await getDisputeStats(NOW);
    expect([d.disputes30, d.cardPayments30]).toEqual([1, 1]);
    expect(d.rate30).toBe(1);
    expect([d.disputes90, d.cardPayments90]).toEqual([2, 2]);
    expect(d.winRate).toBe(1);
    expect(d.open).toBe(1);
  });
});

describe("lead-source ROI and tech leaderboard", () => {
  it("prorates monthly spend and attributes revenue through converted jobs", async () => {
    const rows = await getLeadSourceRoi(P);
    const g = rows.find((r) => r.name === "Google LSA");
    expect(g).toMatchObject({ leads: 2, booked: 1, revenueCents: 54_125 });
    // 2 × 2,000 per-lead + 31,000 × 15/31 days
    expect(g?.costCents).toBe(4_000 + 15_000);
    expect(g?.cplCents).toBe(9_500);
    expect(g?.roas).toBeCloseTo(54_125 / 19_000);
    expect(rows.find((r) => r.name === "No source")).toMatchObject({
      leads: 1,
      booked: 0,
    });
  });

  it("per tech: jobs, revenue, avg ticket, callbacks by original tech, cash share", async () => {
    const rows = await getTechLeaderboard(P);
    const t1 = rows.find((r) => r.userId === ids.t1);
    const t2 = rows.find((r) => r.userId === ids.t2);
    expect(t1).toMatchObject({
      completed: 2,
      revenueCents: 64_000,
      avgTicketCents: 32_000,
      callbacks: 1,
    });
    expect(t1?.callbackRate).toBeCloseTo(0.5);
    expect(t1?.readinessAvg).toBeCloseTo(70);
    expect(t1?.cashShare).toBeCloseTo(14_000 / 68_125);
    expect(t1?.closeRate).toBeCloseTo(1 / 3);
    expect(t2).toMatchObject({
      completed: 2,
      revenueCents: 30_000,
      avgTicketCents: 30_000,
      callbacks: 0,
    });
    expect(rows[0]?.userId).toBe(ids.t1); // sorted by revenue
  });
});

describe("anomaly report", () => {
  it("flags each signal in the trailing window", async () => {
    const a = await getAnomalies(NOW, TZ);
    const c = Object.fromEntries(a.items.map((i) => [i.key, i.count]));
    expect(a.windowDays).toBe(7);
    expect(c.cancelled_after_arrival).toBe(1);
    expect(c.geo_cancel).toBe(1);
    expect(c.discounts).toBe(1); // I-1002: 30% > 25%
    expect(c.no_payment).toBe(1); // J3: done > 48 h, no payment, no invoice
    expect(c.unverified).toBe(1); // cash on J2
    expect(c.invoice_gaps).toBe(1); // I-1003 missing
    expect(c.cash_share).toBe(0);
    expect(c.flagged).toBe(0);
    expect(
      a.items.every((i) => typeof i.label === "string" && i.label.length > 0),
    ).toBe(true);
  });
});

describe("ops board and My Stats queries", () => {
  it("office board counts overdue invoices and returns lists", async () => {
    const d = await getOpsData(sessionUser(ids.admin, "admin"));
    expect(d.overdueInvoices).toEqual({ count: 2, cents: 40_000 });
    expect(Array.isArray(d.unassigned)).toBe(true);
    expect(d.slaMinutes).toBeGreaterThan(0);
  });

  it("tech stats only count the viewer's own jobs", async () => {
    const s = await getTechStats(sessionUser(ids.t2, "tech"), P);
    expect(s.completed).toBe(2);
    expect(s.revenueCents).toBe(30_000);
    expect(s.avgTicketCents).toBe(30_000);
  });
});

describe("setup checklist (QA2 T3-21)", () => {
  it("leaves out items of modules that are switched off", async () => {
    const on = await getSetupChecklist(ids.admin);
    const flagged = ["reviews", "comp", "vehicles", "leadform", "cash"];
    expect(on.items.map((i) => i.key)).toEqual(expect.arrayContaining(flagged));
    await run(sql`update company set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features}',
      coalesce(settings->'features', '{}'::jsonb) || '{"reviews":false,"payroll":false,"vehicles":false,"leads":false}'::jsonb)
      where id = 1`);
    try {
      const off = await getSetupChecklist(ids.admin);
      const keys = off.items.map((i) => i.key);
      for (const k of flagged) expect(keys).not.toContain(k);
      expect(off.total).toBe(on.total - flagged.length);
      expect(off.done).toBeLessThanOrEqual(off.total);
    } finally {
      await run(sql`update company set settings = settings #- '{features,reviews}' #- '{features,payroll}'
        #- '{features,vehicles}' #- '{features,leads}' where id = 1`);
    }
  });
});

describe("CSV", () => {
  it("quotes, escapes and neutralizes formulas", () => {
    const csv = toCsv([
      { a: "plain", b: 'say "hi"', c: "=HYPERLINK(1)", d: -5 },
    ]);
    expect(csv).toBe(`a,b,c,d\r\nplain,"say ""hi""",'=HYPERLINK(1),-5`);
  });
});
