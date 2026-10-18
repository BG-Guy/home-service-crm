import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { execRows } from "@/db";
import { overdueCutoff } from "@/features/invoices/math";
import { getReviewStatsByTech } from "@/features/reviews/api";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import {
  AGING_BUCKETS,
  type AgingBucket,
  businessMinutesBetween,
  isCashShareOutlier,
  median,
  ratio,
} from "./math";
import type { DayRange } from "./period";

// Insights KPIs (SPEC M20). Everything is computed server-side in SQL on view (no
// caching tables, BUILD_PLAN §8.1). Reads are open across tables (§3.2). Money is
// integer cents; rates are fractions (0.42 = 42%) or null when undefined.

const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;
const n = (v: unknown): number => Number(v ?? 0);
const nn = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Payment statuses that mean the money arrived (refunds are subtracted separately). */
const COLLECTED = sql`('succeeded','partially_refunded','refunded','disputed')`;
const MANUAL_METHODS = sql`('cash','check','zelle','venmo','other')`;

async function one<T>(q: SQL): Promise<T> {
  const [r] = await execRows<T>(q);
  return (r ?? {}) as T;
}

/* ------------------------------------------------------------------ admin KPIs */

export interface AdminKpis {
  collectedCents: number;
  refundedCents: number;
  invoicedCents: number;
  jobsCompleted: number;
  ticketJobs: number;
  avgTicketCents: number | null;
  grossMarginPct: number | null;
  companyNetPerJobCents: number | null;
  estimatesApproved: number;
  estimatesDecided: number;
  closeRate: number | null;
  leads: number;
  leadsBooked: number;
  leadBookedRate: number | null;
  medianSpeedMin: number | null;
  contacted5Rate: number | null;
  callbacks: number;
  callbackRate: number | null;
  jobsScheduled: number;
  cancelled: number;
  cancelRate: number | null;
  cancelledAfterArrival: number;
  noShows: number;
  noShowRate: number | null;
  reviewsSent: number;
  reviewsClicked: number;
  reviewClickRate: number | null;
  techEarningsCents: number;
  payrollCostPct: number | null;
}

/** Collected revenue (SPEC M20 definition): succeeded deposits+payments − refunds, tips excluded. */
export function collectedSql(r: { from: Date; to: Date }): SQL {
  return sql`(
    coalesce((select sum(p.amount_cents) from payments p
      where p.kind in ('deposit','payment') and p.status in ${COLLECTED}
        and p.succeeded_at >= ${ts(r.from)} and p.succeeded_at < ${ts(r.to)}), 0)
    - coalesce((select sum(f.amount_cents) from refunds f
      where f.status = 'succeeded' and f.created_at >= ${ts(r.from)} and f.created_at < ${ts(r.to)}), 0)
  )::bigint`;
}

export async function getAdminKpis(r: DayRange): Promise<AdminKpis> {
  const settings = await getSettings();
  const [base, leadRows] = await Promise.all([
    one<Record<string, unknown>>(sql`
      with done as (
        select j.id from jobs j
        where j.completed_at >= ${ts(r.from)} and j.completed_at < ${ts(r.to)}
          and j.status <> 'cancelled'
      ),
      fin as (
        select coalesce(sum(f.revenue_cents),0) rev, coalesce(sum(f.company_parts_cents),0) parts,
               coalesce(sum(f.fees_cents),0) fees, coalesce(sum(f.company_net_cents),0) net,
               count(*) n
        from job_financials f join done d on d.id = f.job_id
      ),
      earn as (
        select coalesce(sum(e.commission_cents + e.spiffs_cents),0) comm,
               coalesce(sum(e.reimbursement_cents),0) reimb
        from job_earnings e join done d on d.id = e.job_id
      )
      select
        ${collectedSql(r)} as collected,
        coalesce((select sum(f.amount_cents) from refunds f where f.status = 'succeeded'
          and f.created_at >= ${ts(r.from)} and f.created_at < ${ts(r.to)}), 0)::bigint as refunded,
        coalesce((select sum(i.subtotal_cents - i.discount_cents) from invoices i
          where i.issued_at >= ${ts(r.from)} and i.issued_at < ${ts(r.to)} and i.status <> 'void'), 0)::bigint as invoiced,
        (select count(*) from done)::int as completed,
        (select count(*) from done d where exists (select 1 from invoices i
          where i.job_id = d.id and i.status <> 'void' and i.total_cents > 0))::int as ticket_jobs,
        (select rev from fin)::bigint as fin_rev, (select parts from fin)::bigint as fin_parts,
        (select fees from fin)::bigint as fin_fees, (select net from fin)::bigint as fin_net,
        (select n from fin)::int as fin_n,
        (select comm from earn)::bigint as comm, (select reimb from earn)::bigint as reimb,
        (select count(*) from estimates e where e.sent_at >= ${ts(r.from)} and e.sent_at < ${ts(r.to)}
          and e.status = 'approved')::int as est_approved,
        (select count(*) from estimates e where e.sent_at >= ${ts(r.from)} and e.sent_at < ${ts(r.to)}
          and e.status in ('approved','declined','expired'))::int as est_decided,
        (select count(*) from jobs c join done d on d.id = c.id where c.callback_of_job_id is not null)::int as callbacks,
        (select count(*) from jobs j where j.scheduled_start >= ${ts(r.from)} and j.scheduled_start < ${ts(r.to)})::int as scheduled,
        (select count(*) from jobs j where j.scheduled_start >= ${ts(r.from)} and j.scheduled_start < ${ts(r.to)}
          and j.status = 'cancelled')::int as cancelled,
        (select count(*) from jobs j where j.scheduled_start >= ${ts(r.from)} and j.scheduled_start < ${ts(r.to)}
          and j.status = 'cancelled' and j.cancel_reason = 'customer_no_show')::int as no_shows,
        (select count(*) from jobs j where j.cancelled_at >= ${ts(r.from)} and j.cancelled_at < ${ts(r.to)}
          and j.status = 'cancelled' and j.arrived_at is not null)::int as cancelled_after_arrival,
        (select count(*) from review_requests rr where rr.first_sent_at >= ${ts(r.from)} and rr.first_sent_at < ${ts(r.to)})::int as reviews_sent,
        (select count(*) from review_requests rr where rr.first_sent_at >= ${ts(r.from)} and rr.first_sent_at < ${ts(r.to)}
          and rr.clicked_at is not null)::int as reviews_clicked,
        coalesce((select sum(l.amount_cents) from ledger_entries l
          where l.type in ('commission','spiff','guarantee_topup','ot_topup')
            and l.effective_date >= ${r.fromKey}::date and l.effective_date <= ${r.toKey}::date), 0)::bigint as tech_earnings
    `),
    execRows<{
      status: string;
      created_at: Date | string;
      first_response_at: Date | string | null;
    }>(sql`
      select status, created_at, first_response_at from leads
      where created_at >= ${ts(r.from)} and created_at < ${ts(r.to)}
        and status <> 'spam' and not is_test`),
  ]);

  const collected = n(base.collected);
  const invoiced = n(base.invoiced);
  const completed = n(base.completed);
  const ticketJobs = n(base.ticket_jobs);
  const finRev = n(base.fin_rev);
  const marginNum =
    finRev -
    n(base.fin_parts) -
    n(base.fin_fees) -
    n(base.comm) -
    n(base.reimb);

  // Speed to lead: minutes from created to first response (business hours if set).
  const bizOnly = (settings.leads as { sla_business_hours?: boolean })
    ?.sla_business_hours;
  const hours = settings.company.business_hours;
  const zone = bizOnly ? await getCompanyTimezone() : "UTC";
  const speeds: number[] = [];
  for (const l of leadRows) {
    if (!l.first_response_at) continue;
    const a = new Date(l.created_at);
    const b = new Date(l.first_response_at);
    speeds.push(
      bizOnly
        ? businessMinutesBetween(a, b, hours, zone)
        : Math.max(0, (b.getTime() - a.getTime()) / 60_000),
    );
  }
  const leads = leadRows.length;
  const booked = leadRows.filter((l) => l.status === "booked").length;
  const within5 = speeds.filter((m) => m <= 5).length;
  const techEarnings = n(base.tech_earnings);
  return {
    collectedCents: collected,
    refundedCents: n(base.refunded),
    invoicedCents: invoiced,
    jobsCompleted: completed,
    ticketJobs,
    avgTicketCents: ticketJobs ? Math.round(invoiced / ticketJobs) : null,
    grossMarginPct: ratio(marginNum, finRev),
    companyNetPerJobCents: completed
      ? Math.round(n(base.fin_net) / completed)
      : null,
    estimatesApproved: n(base.est_approved),
    estimatesDecided: n(base.est_decided),
    closeRate: ratio(n(base.est_approved), n(base.est_decided)),
    leads,
    leadsBooked: booked,
    leadBookedRate: ratio(booked, leads),
    medianSpeedMin: median(speeds),
    contacted5Rate: ratio(within5, leads),
    callbacks: n(base.callbacks),
    callbackRate: ratio(n(base.callbacks), completed),
    jobsScheduled: n(base.scheduled),
    cancelled: n(base.cancelled),
    cancelRate: ratio(n(base.cancelled), n(base.scheduled)),
    cancelledAfterArrival: n(base.cancelled_after_arrival),
    noShows: n(base.no_shows),
    noShowRate: ratio(n(base.no_shows), n(base.scheduled)),
    reviewsSent: n(base.reviews_sent),
    reviewsClicked: n(base.reviews_clicked),
    reviewClickRate: ratio(n(base.reviews_clicked), n(base.reviews_sent)),
    techEarningsCents: techEarnings,
    payrollCostPct: ratio(techEarnings, collected),
  };
}

/* ------------------------------------------------------------------ revenue trend */

/** Collected revenue per local day in the range (zero-filled), for the chart. */
export async function getRevenueSeries(
  r: DayRange,
  tz: string,
): Promise<{ day: string; cents: number }[]> {
  const rows = await execRows<{ day: string; cents: number }>(sql`
    with pay as (
      select to_char(p.succeeded_at at time zone ${tz}, 'YYYY-MM-DD') as day, sum(p.amount_cents) as c
      from payments p
      where p.kind in ('deposit','payment') and p.status in ${COLLECTED}
        and p.succeeded_at >= ${ts(r.from)} and p.succeeded_at < ${ts(r.to)}
      group by 1
    ), ref as (
      select to_char(f.created_at at time zone ${tz}, 'YYYY-MM-DD') as day, sum(f.amount_cents) as c
      from refunds f where f.status = 'succeeded'
        and f.created_at >= ${ts(r.from)} and f.created_at < ${ts(r.to)}
      group by 1
    )
    select coalesce(pay.day, ref.day) as day,
           (coalesce(pay.c,0) - coalesce(ref.c,0))::bigint as cents
    from pay full join ref on ref.day = pay.day`);
  const map = new Map(rows.map((x) => [x.day, n(x.cents)]));
  const out: { day: string; cents: number }[] = [];
  let d = r.fromKey;
  for (let i = 0; i < r.days && i < 400; i++) {
    out.push({ day: d, cents: map.get(d) ?? 0 });
    const [y, m, dd] = d.split("-").map(Number);
    d = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (dd ?? 1) + 1))
      .toISOString()
      .slice(0, 10);
  }
  return out;
}

/* ------------------------------------------------------------------ AR & estimates */

export interface ArAging {
  totalCents: number;
  count: number;
  overdueCents: number;
  overdueCount: number;
  buckets: Record<AgingBucket, { cents: number; count: number }>;
}

export async function getArAging(now: Date): Promise<ArAging> {
  // Overdue from the local day after the due date (invoices/math overdueCutoff, QA2).
  const overdueBefore = overdueCutoff(now, await getCompanyTimezone());
  const rows = await execRows<{
    bucket: AgingBucket;
    cents: number;
    cnt: number;
    overdue_cents: number;
    overdue_cnt: number;
  }>(sql`
    with bal as (
      select i.id, i.issued_at, i.due_at,
        (i.total_cents - b.paid_cents + b.refunded_cents - b.credited_cents) as balance
      from invoices i join invoice_balances b on b.invoice_id = i.id
      where i.status in ('issued','partially_paid') and i.issued_at is not null
    )
    select
      case when ${ts(now)} - issued_at <= interval '30 days' then '0-30'
           when ${ts(now)} - issued_at <= interval '60 days' then '31-60'
           when ${ts(now)} - issued_at <= interval '90 days' then '61-90'
           else '90+' end as bucket,
      sum(balance)::bigint as cents, count(*)::int as cnt,
      coalesce(sum(balance) filter (where due_at < ${ts(overdueBefore)}),0)::bigint as overdue_cents,
      (count(*) filter (where due_at < ${ts(overdueBefore)}))::int as overdue_cnt
    from bal where balance > 0 group by 1`);
  const buckets = Object.fromEntries(
    AGING_BUCKETS.map((b) => [b, { cents: 0, count: 0 }]),
  ) as ArAging["buckets"];
  let totalCents = 0;
  let count = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  for (const r of rows) {
    buckets[r.bucket] = { cents: n(r.cents), count: n(r.cnt) };
    totalCents += n(r.cents);
    count += n(r.cnt);
    overdueCents += n(r.overdue_cents);
    overdueCount += n(r.overdue_cnt);
  }
  return { totalCents, count, overdueCents, overdueCount, buckets };
}

/** Σ max-option total of sent/viewed estimates that haven't expired. */
export async function getUnsoldEstimates(
  now: Date,
): Promise<{ cents: number; count: number }> {
  const r = await one<{ cents: number; cnt: number }>(sql`
    with opt as (
      select o.estimate_id, sum(li.total_cents) filter (where not li.is_optional or li.is_selected) as total
      from estimate_options o join line_items li on li.parent_type = 'estimate_option' and li.parent_id = o.id
      group by o.id, o.estimate_id
    )
    select coalesce(sum(m.total),0)::bigint as cents, count(*)::int as cnt from (
      select e.id, max(opt.total) as total from estimates e join opt on opt.estimate_id = e.id
      where e.status in ('sent','viewed') and (e.expires_at is null or e.expires_at > ${ts(now)})
      group by e.id
    ) m`);
  return { cents: n(r.cents), count: n(r.cnt) };
}

/* ------------------------------------------------------------------ disputes */

export interface DisputeStats {
  disputes30: number;
  cardPayments30: number;
  rate30: number | null;
  disputes90: number;
  cardPayments90: number;
  rate90: number | null;
  won: number;
  closed: number;
  winRate: number | null;
  open: number;
}

/** Dispute rate (trailing 30/90 d vs card payments in the same window; alert at 0.75%). */
export async function getDisputeStats(now: Date): Promise<DisputeStats> {
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const r = await one<Record<string, unknown>>(sql`
    select
      (select count(*) from disputes where created_at >= ${ts(d30)})::int as d30,
      (select count(*) from disputes where created_at >= ${ts(d90)})::int as d90,
      (select count(*) from payments where method = 'card' and status in ${COLLECTED} and succeeded_at >= ${ts(d30)})::int as p30,
      (select count(*) from payments where method = 'card' and status in ${COLLECTED} and succeeded_at >= ${ts(d90)})::int as p90,
      (select count(*) from disputes where status = 'won')::int as won,
      (select count(*) from disputes where status in ('won','lost','accepted','warning_closed'))::int as closed,
      (select count(*) from disputes where status in ('inquiry','needs_response','under_review'))::int as open`);
  return {
    disputes30: n(r.d30),
    cardPayments30: n(r.p30),
    rate30: ratio(n(r.d30), n(r.p30)),
    disputes90: n(r.d90),
    cardPayments90: n(r.p90),
    rate90: ratio(n(r.d90), n(r.p90)),
    won: n(r.won),
    closed: n(r.closed),
    winRate: ratio(n(r.won), n(r.closed)),
    open: n(r.open),
  };
}

export async function getCancelBreakdown(
  r: DayRange,
): Promise<{ reason: string; count: number }[]> {
  const rows = await execRows<{ reason: string | null; cnt: number }>(sql`
    select cancel_reason as reason, count(*)::int as cnt from jobs
    where status = 'cancelled' and scheduled_start >= ${ts(r.from)} and scheduled_start < ${ts(r.to)}
    group by 1 order by 2 desc`);
  return rows.map((x) => ({ reason: x.reason ?? "other", count: n(x.cnt) }));
}

/* ------------------------------------------------------------------ lead sources */

export interface SourceRoiRow {
  sourceId: string | null;
  name: string;
  leads: number;
  booked: number;
  revenueCents: number;
  costCents: number;
  cplCents: number | null;
  costPerBookedCents: number | null;
  roas: number | null;
}

/**
 * Per source (SPEC M20): leads created in the period (excl. spam/test), booked, collected
 * revenue from jobs linked to those leads, cost = Σ per-lead cost + monthly spend
 * prorated to the days of the period that fall in each month.
 */
export async function getLeadSourceRoi(r: DayRange): Promise<SourceRoiRow[]> {
  const rows = await execRows<Record<string, unknown>>(sql`
    with l as (
      select * from leads where created_at >= ${ts(r.from)} and created_at < ${ts(r.to)}
        and status <> 'spam' and not is_test
    ),
    per as (
      select l.lead_source_id sid, count(*)::int leads,
        (count(*) filter (where l.status = 'booked'))::int booked,
        coalesce(sum(l.source_cost_cents),0)::bigint lead_cost
      from l group by 1
    ),
    rev as (
      select l.lead_source_id sid, coalesce(sum(p.amount_cents),0)::bigint cents
      from l join jobs j on j.lead_id = l.id or j.id = l.converted_job_id
      join payments p on p.job_id = j.id and p.kind in ('deposit','payment') and p.status in ${COLLECTED}
      group by 1
    ),
    spend as (
      select s.lead_source_id sid,
        sum(s.amount_cents::numeric * (
          greatest(0, (least(${r.toKey}::date, (date_trunc('month', s.month) + interval '1 month - 1 day')::date)
            - greatest(${r.fromKey}::date, date_trunc('month', s.month)::date) + 1))::numeric
          / extract(day from (date_trunc('month', s.month) + interval '1 month - 1 day'))::numeric
        ))::bigint cents
      from source_spend s
      where s.month <= ${r.toKey}::date and (s.month + interval '1 month') > ${r.fromKey}::date
      group by 1
    )
    select coalesce(ls.id, per.sid) sid, coalesce(ls.name, 'No source') name,
      coalesce(per.leads,0) leads, coalesce(per.booked,0) booked,
      coalesce(rev.cents,0) revenue, coalesce(per.lead_cost,0) + coalesce(spend.cents,0) cost
    from per
    full join lead_sources ls on ls.id = per.sid
    left join rev on rev.sid is not distinct from coalesce(ls.id, per.sid)
    left join spend on spend.sid = ls.id
    where coalesce(per.leads,0) > 0 or coalesce(spend.cents,0) > 0
    order by coalesce(rev.cents,0) desc, coalesce(per.leads,0) desc`);
  return rows.map((x) => {
    const leads = n(x.leads);
    const booked = n(x.booked);
    const cost = n(x.cost);
    const revenue = n(x.revenue);
    return {
      sourceId: (x.sid as string | null) ?? null,
      name: String(x.name),
      leads,
      booked,
      revenueCents: revenue,
      costCents: cost,
      cplCents: leads && cost ? Math.round(cost / leads) : null,
      costPerBookedCents: booked && cost ? Math.round(cost / booked) : null,
      roas: ratio(revenue, cost),
    };
  });
}

/* ------------------------------------------------------------------ tech leaderboard */

export interface TechRow {
  userId: string;
  name: string;
  color: string | null;
  completed: number;
  revenueCents: number;
  avgTicketCents: number | null;
  closeRate: number | null;
  callbacks: number;
  callbackRate: number | null;
  reviewClicks: number;
  reviewsSent: number;
  readinessAvg: number | null;
  cashCollectedCents: number;
  collectedCents: number;
  cashShare: number | null;
}

/** Per active tech, attributed to the job's primary assignee (SPEC M20 leaderboard). */
export async function getTechLeaderboard(r: DayRange): Promise<TechRow[]> {
  const [rows, reviews] = await Promise.all([
    execRows<Record<string, unknown>>(sql`
      with techs as (
        select u.id, u.name, u.color from users u join roles ro on ro.key = u.role
        where ro.base_role = 'tech' and u.status = 'active'
      ),
      prim as (
        select a.job_id, a.user_id from job_assignments a where a.role = 'primary'
      ),
      done as (
        select j.id, p.user_id, j.readiness_score, j.callback_of_job_id from jobs j join prim p on p.job_id = j.id
        where j.completed_at >= ${ts(r.from)} and j.completed_at < ${ts(r.to)} and j.status <> 'cancelled'
      ),
      inv as (
        select d.user_id, sum(i.subtotal_cents - i.discount_cents) cents,
          count(distinct d.id) filter (where i.total_cents > 0) jobs
        from done d join invoices i on i.job_id = d.id and i.status <> 'void'
        group by 1
      ),
      cb as (
        select p.user_id, count(*) n from jobs c join prim p on p.job_id = c.callback_of_job_id
        where c.callback_of_job_id is not null and c.completed_at >= ${ts(r.from)} and c.completed_at < ${ts(r.to)}
          and c.status <> 'cancelled'
        group by 1
      ),
      est as (
        select coalesce(p.user_id, e.created_by) uid,
          count(*) filter (where e.status = 'approved') appr,
          count(*) filter (where e.status in ('approved','declined','expired')) decided
        from estimates e left join prim p on p.job_id = e.job_id
        where e.sent_at >= ${ts(r.from)} and e.sent_at < ${ts(r.to)}
        group by 1
      ),
      pay as (
        select p2.user_id, sum(pm.amount_cents) total,
          coalesce(sum(pm.amount_cents) filter (where pm.method = 'cash'),0) cash
        from payments pm join prim p2 on p2.job_id = pm.job_id
        where pm.kind in ('deposit','payment') and pm.status in ${COLLECTED}
          and pm.succeeded_at >= ${ts(r.from)} and pm.succeeded_at < ${ts(r.to)}
        group by 1
      )
      select t.id, t.name, t.color,
        (select count(*) from done d where d.user_id = t.id)::int completed,
        (select avg(d.readiness_score) from done d where d.user_id = t.id and d.readiness_score is not null)::float readiness,
        coalesce(inv.cents,0)::bigint revenue, coalesce(inv.jobs,0)::int ticket_jobs,
        coalesce(cb.n,0)::int callbacks,
        coalesce(est.appr,0)::int est_appr, coalesce(est.decided,0)::int est_decided,
        coalesce(pay.total,0)::bigint collected, coalesce(pay.cash,0)::bigint cash
      from techs t
      left join inv on inv.user_id = t.id
      left join cb on cb.user_id = t.id
      left join est on est.uid = t.id
      left join pay on pay.user_id = t.id
      order by coalesce(inv.cents,0) desc, t.name`),
    getReviewStatsByTech(r.from, r.to).catch(
      () => ({}) as Record<string, never>,
    ),
  ]);
  return rows.map((x) => {
    const id = String(x.id);
    const completed = n(x.completed);
    const revenue = n(x.revenue);
    const ticketJobs = n(x.ticket_jobs);
    const rv = (reviews as Record<string, { sent: number; clicked: number }>)[
      id
    ];
    return {
      userId: id,
      name: String(x.name),
      color: (x.color as string | null) ?? null,
      completed,
      revenueCents: revenue,
      avgTicketCents: ticketJobs ? Math.round(revenue / ticketJobs) : null,
      closeRate: ratio(n(x.est_appr), n(x.est_decided)),
      callbacks: n(x.callbacks),
      callbackRate: ratio(n(x.callbacks), completed),
      reviewClicks: rv?.clicked ?? 0,
      reviewsSent: rv?.sent ?? 0,
      readinessAvg: nn(x.readiness),
      cashCollectedCents: n(x.cash),
      collectedCents: n(x.collected),
      cashShare: ratio(n(x.cash), n(x.collected)),
    };
  });
}

/* ------------------------------------------------------------------ anomaly report */

export interface Anomaly {
  key: string;
  label: string;
  detail: string;
  count: number;
  href: string | null;
  severity: "info" | "warning" | "critical";
}

/**
 * Weekly anomaly card (SPEC M20): every listed fraud/leakage signal over the trailing
 * window (settings.insights.anomaly_window_days, default 7). Signals with zero hits
 * are returned too (count 0) so the card can say "all clear" per line.
 */
export async function getAnomalies(
  now: Date,
  tz: string,
): Promise<{
  windowDays: number;
  fromKey: string;
  toKey: string;
  items: Anomaly[];
}> {
  const s = await getSettings();
  const days = s.insights.anomaly_window_days;
  const discountPct = s.insights.anomaly_discount_pct;
  const radius =
    (s as { jobs?: { arrival_radius_m?: number } }).jobs?.arrival_radius_m ??
    300;
  const from = new Date(now.getTime() - days * 86_400_000);
  const fromKey = dateKey(from, tz);
  const toKey = dateKey(now, tz);
  const range = `from=${fromKey}&to=${toKey}`;
  const c = await one<Record<string, unknown>>(sql`
    select
      (select count(*) from jobs where status = 'cancelled' and arrived_at is not null
        and cancelled_at >= ${ts(from)})::int as caa,
      (select count(*) from invoices where status <> 'void' and issued_at >= ${ts(from)}
        and (total_cents = 0 or (subtotal_cents > 0 and discount_cents * 100 > subtotal_cents * ${discountPct})))::int as disc,
      (select count(distinct r.invoice_id) from invoice_revisions r join invoices i on i.id = r.invoice_id
        left join jobs j on j.id = i.job_id
        where r.created_at >= ${ts(from)} and r.version > 1 and (
          (j.completed_at is not null and r.created_at > j.completed_at)
          or exists (select 1 from payments p where p.invoice_id = i.id and p.status in ${COLLECTED} and p.succeeded_at < r.created_at)
        ))::int as revised,
      (select count(distinct e.job_id) from job_status_events e join jobs j on j.id = e.job_id
        where e.to_status = 'arrived' and e.distance_m is not null and e.distance_m <= ${radius}
          and j.status = 'cancelled' and j.cancelled_at >= ${ts(from)})::int as geo_cancel,
      (select count(*) from part_purchases pp where pp.status = 'approved' and pp.job_id is not null
        and (pp.paid_by = 'tech' or pp.instrument = 'company_card')
        and pp.created_at >= ${ts(new Date(now.getTime() - 60 * 86_400_000))}
        and not exists (select 1 from line_items li where li.part_purchase_id = pp.id))::int as unbilled,
      (select count(*) from payments where method in ${MANUAL_METHODS} and status = 'succeeded'
        and verified_at is null and created_at < ${ts(new Date(now.getTime() - 3 * 86_400_000))})::int as unverified,
      (select count(*) from jobs j where j.status in ('completed','closed')
        and j.completed_at < ${ts(new Date(now.getTime() - 48 * 3_600_000))}
        and j.completed_at >= ${ts(new Date(now.getTime() - 30 * 86_400_000))}
        and not exists (select 1 from payments p where p.job_id = j.id and p.status in ${COLLECTED})
        and not exists (select 1 from invoices i where i.job_id = j.id and i.issued_at is not null and i.status <> 'void'))::int as no_pay,
      (select count(*) from events where type = 'payment.customer_flagged' and created_at >= ${ts(from)})::int as flagged,
      (select count(*) from events where type = 'cash.discrepancy_declared' and created_at >= ${ts(from)})::int as cash_disc,
      (select count(*) from users where bank_changed_at >= ${ts(from)})::int as bank`);

  // Invoice number gaps (issued numbers must be contiguous per prefix).
  const nums = await execRows<{ number: string }>(sql`
    select number from invoices where issued_at is not null and number is not null`);
  const byPrefix = new Map<string, number[]>();
  for (const { number } of nums) {
    const m = /^(.*?)(\d+)$/.exec(number);
    if (!m) continue;
    const list = byPrefix.get(m[1] ?? "") ?? [];
    list.push(Number(m[2]));
    byPrefix.set(m[1] ?? "", list);
  }
  let gaps = 0;
  for (const list of byPrefix.values()) {
    const sorted = [...new Set(list)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      gaps += Math.max(
        0,
        (sorted[i] as number) - (sorted[i - 1] as number) - 1,
      );
  }

  // Tech cash share outliers over the same window.
  const window: DayRange = {
    fromKey,
    toKey,
    from,
    to: now,
    days,
  };
  const board = await getTechLeaderboard(window);
  const shares = board
    .filter((t) => t.collectedCents > 0)
    .map((t) => ({ t, share: t.cashShare ?? 0 }));
  const outliers = shares.filter((x) =>
    isCashShareOutlier(
      x.share,
      shares.map((y) => y.share),
    ),
  );

  const item = (
    key: string,
    label: string,
    count: number,
    detail: string,
    href: string | null,
    severity: Anomaly["severity"] = count ? "warning" : "info",
  ): Anomaly => ({ key, label, count, detail, href, severity });
  return {
    windowDays: days,
    fromKey,
    toKey,
    items: [
      item(
        "cancelled_after_arrival",
        "Cancelled after arrival",
        n(c.caa),
        "Tech arrived, then the job was cancelled",
        `/jobs?cancelledAfterArrival=1&${range}`,
      ),
      item(
        "geo_cancel",
        "Arrived on site, then cancelled",
        n(c.geo_cancel),
        `Arrival geostamp within ${radius} m of the address`,
        `/jobs?cancelledAfterArrival=1&${range}`,
      ),
      item(
        "discounts",
        `$0 or > ${discountPct}% discount`,
        n(c.disc),
        "Invoices issued with no charge or a big discount",
        `/invoices?${range}`,
      ),
      item(
        "revised",
        "Invoices revised after completion or payment",
        n(c.revised),
        "Changed after the customer saw or paid it",
        `/invoices?revisedAfterPayment=1&${range}`,
      ),
      item(
        "no_payment",
        "Completed, no payment, no invoice after 48 h",
        n(c.no_pay),
        "Possible side deal (cash or personal card)",
        "/jobs?noInvoiceAfter48h=1",
        n(c.no_pay) ? "critical" : "info",
      ),
      item(
        "cash_share",
        "Tech cash share far above average",
        outliers.length,
        outliers.length
          ? outliers
              .map((o) => `${o.t.name} ${Math.round(o.share * 100)}%`)
              .join(", ")
          : "No tech collects unusually much cash",
        "/insights?period=last30#leaderboard",
      ),
      item(
        "flagged",
        "Customer-flagged receipts",
        n(c.flagged),
        "“Wrong amount? / I didn’t pay this”",
        "/tasks?scope=all&kind=callback_customer",
        n(c.flagged) ? "critical" : "info",
      ),
      item(
        "unverified",
        "Manual payments unverified > 3 days",
        n(c.unverified),
        "Cash, check, Zelle or Venmo not yet confirmed",
        "/payments?tab=unverified",
      ),
      item(
        "unbilled",
        "Unbilled tech or company-card receipts",
        n(c.unbilled),
        "Approved part receipts not on any invoice",
        "/parts?tab=unbilled",
      ),
      item(
        "cash_discrepancy",
        "Cash count discrepancies",
        n(c.cash_disc),
        "Declared at end of day",
        "/pay/settlements",
      ),
      item(
        "invoice_gaps",
        "Invoice number gaps",
        gaps,
        "Issued numbers should be continuous",
        "/invoices",
        gaps ? "critical" : "info",
      ),
      item(
        "bank_changes",
        "Bank details changed",
        n(c.bank),
        "Payouts are held after a change",
        "/pay/settlements",
      ),
    ],
  };
}

/* ------------------------------------------------------------------ CSV */

export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0] as object);
  const esc = (v: unknown) => {
    const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    // Neutralize spreadsheet formulas (CSV injection) and quote when needed.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
  ].join("\r\n");
}
