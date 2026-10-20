import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { execRows } from "@/db";
import { countPendingApprovals } from "@/features/approvals/api";
import { overdueCutoff } from "@/features/invoices/math";
import { getOutboxCount } from "@/features/messaging/api";
import { getCustodyBalances, getPeriodEarnings } from "@/features/payroll/api";
import { getReviewStatsByTech } from "@/features/reviews/api";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { ratio } from "./math";
import type { DayRange } from "./period";

// Office "Today / Ops" and tech "My Stats" data (SPEC M20). Row scope: the office
// board is for insights.view_ops holders; tasks are mine unless tasks.view_all; the
// tech view only ever reads the viewer's own rows.

const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;
const n = (v: unknown) => Number(v ?? 0);

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error("[insights] source failed", e);
    return fallback;
  }
}

export interface LeadWaiting {
  id: string;
  name: string;
  source: string | null;
  service: string | null;
  createdAt: Date;
}

export interface JobBrief {
  id: string;
  number: string;
  title: string | null;
  customer: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  tech: string | null;
  status: string;
}

export interface OpsData {
  tz: string;
  now: Date;
  slaMinutes: number;
  newLeads: LeadWaiting[];
  newLeadCount: number;
  leadsBreached: number;
  unassigned: JobBrief[];
  unconfirmedTomorrow: JobBrief[];
  depositsUnpaid: { count: number; cents: number };
  outbox: { mine: number; all: number };
  overdueInvoices: { count: number; cents: number };
  estimatesFollowUp: number;
  approvals: number;
  runningLate: JobBrief[];
  tasks: { dueToday: number; overdue: number; scopeAll: boolean };
  callbacks: number;
  todayJobs: { total: number; done: number; inProgress: number };
}

function jobBrief(r: Record<string, unknown>): JobBrief {
  return {
    id: String(r.id),
    number: String(r.number ?? ""),
    title: (r.title as string | null) ?? null,
    customer: (r.customer as string | null) ?? null,
    windowStart: r.window_start ? new Date(r.window_start as string) : null,
    windowEnd: r.window_end ? new Date(r.window_end as string) : null,
    tech: (r.tech as string | null) ?? null,
    status: String(r.status),
  };
}

const JOB_COLS = sql`j.id, j.number, j.title, j.status, coalesce(j.window_start, j.scheduled_start) as window_start,
  coalesce(j.window_end, j.scheduled_end) as window_end, c.display_name as customer,
  (select u.name from job_assignments a join users u on u.id = a.user_id
    where a.job_id = j.id order by (a.role = 'primary') desc limit 1) as tech`;

export async function getOpsData(user: SessionUser): Promise<OpsData> {
  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const now = new Date();
  const today = dateKey(now, tz);
  const dayStart = (k: string) => zonedTimeToUtc(parseDateKey(k), tz);
  const tomorrow = addDaysToKey(today, 1);
  const startToday = dayStart(today);
  const startTomorrow = dayStart(tomorrow);
  const startDayAfter = dayStart(addDaysToKey(today, 2));
  // Invoices: overdue from the local day after the due date (invoices/math, QA2).
  const overdueBefore = overdueCutoff(now, tz);
  const sla = settings.company.lead_response_minutes;
  const scopeAll = user.perms.has("tasks.view_all");

  const [
    counts,
    leads,
    unassigned,
    unconfirmed,
    late,
    outboxMine,
    outboxAll,
    approvals,
  ] = await Promise.all([
    execRows<Record<string, unknown>>(sql`
        select
          (select count(*) from leads where status = 'new' and not is_test)::int as new_leads,
          (select count(*) from leads where status = 'new' and not is_test and first_response_at is null
            and created_at < ${ts(new Date(now.getTime() - sla * 60_000))})::int as breached,
          (select count(*) from deposit_requests where status in ('required','requested'))::int as dep_n,
          coalesce((select sum(amount_cents) from deposit_requests where status in ('required','requested')),0)::bigint as dep_c,
          (select count(*) from invoices i join invoice_balances b on b.invoice_id = i.id
            where i.status in ('issued','partially_paid') and i.due_at < ${ts(overdueBefore)}
              and (i.total_cents - b.paid_cents + b.refunded_cents - b.credited_cents) > 0)::int as od_n,
          coalesce((select sum(i.total_cents - b.paid_cents + b.refunded_cents - b.credited_cents)
            from invoices i join invoice_balances b on b.invoice_id = i.id
            where i.status in ('issued','partially_paid') and i.due_at < ${ts(overdueBefore)}
              and (i.total_cents - b.paid_cents + b.refunded_cents - b.credited_cents) > 0),0)::bigint as od_c,
          (select count(*) from estimates where status in ('sent','viewed')
            and (expires_at is null or expires_at > ${ts(now)})
            and (sent_at < ${ts(new Date(now.getTime() - 2 * 86_400_000))}
              or expires_at < ${ts(new Date(now.getTime() + 2 * 86_400_000))}))::int as est_fu,
          (select count(*) from tasks where status = 'open' and due_at >= ${ts(startToday)} and due_at < ${ts(startTomorrow)}
            ${scopeAll ? sql`` : sql`and assignee_user_id = ${user.id}::uuid`})::int as tasks_today,
          (select count(*) from tasks where status = 'open' and due_at < ${ts(startToday)}
            ${scopeAll ? sql`` : sql`and assignee_user_id = ${user.id}::uuid`})::int as tasks_overdue,
          (select count(*) from tasks where status = 'open' and kind = 'callback_customer')::int as callbacks,
          (select count(*) from jobs where scheduled_start >= ${ts(startToday)} and scheduled_start < ${ts(startTomorrow)}
            and status <> 'cancelled')::int as today_total,
          (select count(*) from jobs where scheduled_start >= ${ts(startToday)} and scheduled_start < ${ts(startTomorrow)}
            and status in ('completed','closed'))::int as today_done,
          (select count(*) from jobs where status in ('en_route','arrived','in_progress'))::int as in_progress`),
    execRows<Record<string, unknown>>(sql`
        select l.id, l.name, l.created_at, ls.name as source,
          coalesce(st.name, l.service_text) as service
        from leads l left join lead_sources ls on ls.id = l.lead_source_id
        left join service_types st on st.id = l.service_type_id
        where l.status = 'new' and not l.is_test
        order by l.created_at asc limit 5`),
    execRows<Record<string, unknown>>(sql`
        select ${JOB_COLS} from jobs j left join customers c on c.id = j.customer_id
        where j.status not in ('cancelled','completed','closed')
          and j.scheduled_start >= ${ts(startToday)} and j.scheduled_start < ${ts(startDayAfter)}
          and not exists (select 1 from job_assignments a where a.job_id = j.id)
        order by j.scheduled_start limit 8`),
    execRows<Record<string, unknown>>(sql`
        select ${JOB_COLS} from jobs j left join customers c on c.id = j.customer_id
        where j.status = 'scheduled' and j.confirmed_at is null
          and j.scheduled_start >= ${ts(startTomorrow)} and j.scheduled_start < ${ts(startDayAfter)}
        order by j.scheduled_start limit 8`),
    execRows<Record<string, unknown>>(sql`
        select ${JOB_COLS} from jobs j left join customers c on c.id = j.customer_id
        where j.status in ('scheduled','confirmed','en_route')
          and coalesce(j.window_end, j.scheduled_end) < ${ts(now)}
          and coalesce(j.window_end, j.scheduled_end) >= ${ts(startToday)}
        order by coalesce(j.window_end, j.scheduled_end) limit 8`),
    safe(getOutboxCount(user.id, "mine"), 0),
    user.perms.has("messages.outbox_all")
      ? safe(getOutboxCount(user.id, "all"), 0)
      : Promise.resolve(0),
    safe(countPendingApprovals(user), 0),
  ]);
  const c = counts[0] ?? {};
  return {
    tz,
    now,
    slaMinutes: sla,
    newLeads: leads.map((l) => ({
      id: String(l.id),
      name: String(l.name ?? "New lead"),
      source: (l.source as string | null) ?? null,
      service: (l.service as string | null) ?? null,
      createdAt: new Date(l.created_at as string),
    })),
    newLeadCount: n(c.new_leads),
    leadsBreached: n(c.breached),
    unassigned: unassigned.map(jobBrief),
    unconfirmedTomorrow: unconfirmed.map(jobBrief),
    depositsUnpaid: { count: n(c.dep_n), cents: n(c.dep_c) },
    outbox: { mine: outboxMine, all: outboxAll },
    overdueInvoices: { count: n(c.od_n), cents: n(c.od_c) },
    estimatesFollowUp: n(c.est_fu),
    approvals,
    runningLate: late.map(jobBrief),
    tasks: {
      dueToday: n(c.tasks_today),
      overdue: n(c.tasks_overdue),
      scopeAll,
    },
    callbacks: n(c.callbacks),
    todayJobs: {
      total: n(c.today_total),
      done: n(c.today_done),
      inProgress: n(c.in_progress),
    },
  };
}

/* ------------------------------------------------------------------ tech: My Stats */

export interface TechStats {
  today: { total: number; done: number; next: JobBrief | null };
  completed: number;
  revenueCents: number;
  avgTicketCents: number | null;
  closeRate: number | null;
  callbacks: number;
  callbackRate: number | null;
  reviewsSent: number;
  reviewClicks: number;
  cashHeldCents: number;
  cashOldestAt: Date | null;
  pendingReimbursementsCents: number;
  pendingReimbursements: number;
  periodEarningsCents: number | null;
  /** 1-based rank by revenue among active techs (null when ranks are hidden). */
  rank: { position: number; of: number } | null;
}

export async function getTechStats(
  user: SessionUser,
  r: DayRange,
): Promise<TechStats> {
  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const now = new Date();
  const today = dateKey(now, tz);
  const startToday = zonedTimeToUtc(parseDateKey(today), tz);
  const startTomorrow = zonedTimeToUtc(
    parseDateKey(addDaysToKey(today, 1)),
    tz,
  );
  const me = sql`${user.id}::uuid`;
  const [rows, next, custody, reviews, earnings, ranks] = await Promise.all([
    execRows<Record<string, unknown>>(sql`
      with mine as (select job_id from job_assignments where user_id = ${me}),
      prim as (select job_id from job_assignments where user_id = ${me} and role = 'primary'),
      done as (
        select j.id from jobs j join prim p on p.job_id = j.id
        where j.completed_at >= ${ts(r.from)} and j.completed_at < ${ts(r.to)} and j.status <> 'cancelled'
      )
      select
        (select count(*) from jobs j join mine m on m.job_id = j.id
          where j.scheduled_start >= ${ts(startToday)} and j.scheduled_start < ${ts(startTomorrow)}
            and j.status <> 'cancelled')::int as today_total,
        (select count(*) from jobs j join mine m on m.job_id = j.id
          where j.completed_at >= ${ts(startToday)} and j.completed_at < ${ts(startTomorrow)})::int as today_done,
        (select count(*) from done)::int as completed,
        coalesce((select sum(i.subtotal_cents - i.discount_cents) from invoices i join done d on d.id = i.job_id
          where i.status <> 'void'), 0)::bigint as revenue,
        (select count(distinct i.job_id) from invoices i join done d on d.id = i.job_id
          where i.status <> 'void' and i.total_cents > 0)::int as ticket_jobs,
        (select count(*) from estimates e where e.sent_at >= ${ts(r.from)} and e.sent_at < ${ts(r.to)}
          and (e.created_by = ${me} or e.job_id in (select job_id from prim)) and e.status = 'approved')::int as est_appr,
        (select count(*) from estimates e where e.sent_at >= ${ts(r.from)} and e.sent_at < ${ts(r.to)}
          and (e.created_by = ${me} or e.job_id in (select job_id from prim))
          and e.status in ('approved','declined','expired'))::int as est_decided,
        (select count(*) from jobs c where c.callback_of_job_id in (select job_id from prim)
          and c.completed_at >= ${ts(r.from)} and c.completed_at < ${ts(r.to)})::int as callbacks,
        (select count(*) from part_purchases where purchaser_user_id = ${me} and paid_by = 'tech'
          and status = 'pending')::int as reimb_n,
        coalesce((select sum(total_cents) from part_purchases where purchaser_user_id = ${me}
          and paid_by = 'tech' and status = 'pending'),0)::bigint as reimb_c`),
    execRows<Record<string, unknown>>(sql`
      select ${JOB_COLS} from jobs j left join customers c on c.id = j.customer_id
      join job_assignments a on a.job_id = j.id and a.user_id = ${me}
      where j.status in ('scheduled','confirmed','en_route','arrived','in_progress')
        and j.scheduled_start < ${ts(startTomorrow)}
      order by (j.status in ('en_route','arrived','in_progress')) desc, j.scheduled_start limit 1`),
    safe(getCustodyBalances([user.id]), {}),
    safe(getReviewStatsByTech(r.from, r.to), {}),
    user.perms.has("payroll.view_own")
      ? safe(getPeriodEarnings(user.id), null)
      : Promise.resolve(null),
    settings.insights.show_tech_rank
      ? execRows<{ id: string; revenue: number }>(sql`
          select u.id, coalesce(sum(i.subtotal_cents - i.discount_cents),0)::bigint as revenue
          from users u join roles ro on ro.key = u.role
          left join job_assignments a on a.user_id = u.id and a.role = 'primary'
          left join jobs j on j.id = a.job_id and j.completed_at >= ${ts(r.from)} and j.completed_at < ${ts(r.to)}
            and j.status <> 'cancelled'
          left join invoices i on i.job_id = j.id and i.status <> 'void'
          where ro.base_role = 'tech' and u.status = 'active'
          group by u.id order by 2 desc`)
      : Promise.resolve(null),
  ]);
  const x = rows[0] ?? {};
  const completed = n(x.completed);
  const ticketJobs = n(x.ticket_jobs);
  const revenue = n(x.revenue);
  const c = (
    custody as Record<string, { heldCents: number; oldestAt: Date | null }>
  )[user.id];
  const rv = (reviews as Record<string, { sent: number; clicked: number }>)[
    user.id
  ];
  const pos = ranks ? ranks.findIndex((r2) => r2.id === user.id) : -1;
  return {
    today: {
      total: n(x.today_total),
      done: n(x.today_done),
      next: next[0] ? jobBrief(next[0]) : null,
    },
    completed,
    revenueCents: revenue,
    avgTicketCents: ticketJobs ? Math.round(revenue / ticketJobs) : null,
    closeRate: ratio(n(x.est_appr), n(x.est_decided)),
    callbacks: n(x.callbacks),
    callbackRate: ratio(n(x.callbacks), completed),
    reviewsSent: rv?.sent ?? 0,
    reviewClicks: rv?.clicked ?? 0,
    cashHeldCents: c?.heldCents ?? 0,
    cashOldestAt: c?.oldestAt ?? null,
    pendingReimbursementsCents: n(x.reimb_c),
    pendingReimbursements: n(x.reimb_n),
    periodEarningsCents: earnings?.netCents ?? null,
    rank: ranks && pos >= 0 ? { position: pos + 1, of: ranks.length } : null,
  };
}

/* ------------------------------------------------------------------ office: by-tech strip */

export interface TechDayJob {
  id: string;
  number: string;
  title: string | null;
  status: string;
  windowStart: Date | null;
}

export interface TechDay {
  id: string;
  name: string;
  color: string | null;
  clockedIn: boolean;
  jobs: TechDayJob[];
}

/** Active techs with today's jobs in order (the compact schedule strip on Today). */
export async function getTechDay(): Promise<TechDay[]> {
  const tz = await getCompanyTimezone();
  const today = dateKey(new Date(), tz);
  const from = zonedTimeToUtc(parseDateKey(today), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(today, 1)), tz);
  const rows = await execRows<Record<string, unknown>>(sql`
    select u.id as user_id, u.name, u.color,
      exists (select 1 from time_entries t where t.user_id = u.id and t.clock_out_at is null) as clocked_in,
      j.id, j.number, j.title, j.status, coalesce(j.window_start, j.scheduled_start) as window_start
    from users u join roles ro on ro.key = u.role
    left join lateral (
      select j.* from job_assignments a join jobs j on j.id = a.job_id
      where a.user_id = u.id and j.status <> 'cancelled'
        and j.scheduled_start >= ${ts(from)} and j.scheduled_start < ${ts(to)}
    ) j on true
    where ro.base_role = 'tech' and u.status = 'active'
    order by u.name, coalesce(j.window_start, j.scheduled_start) nulls last
    limit 200`);
  const byTech = new Map<string, TechDay>();
  for (const r of rows) {
    const id = String(r.user_id);
    let t = byTech.get(id);
    if (!t) {
      t = {
        id,
        name: String(r.name ?? ""),
        color: (r.color as string | null) ?? null,
        clockedIn: !!r.clocked_in,
        jobs: [],
      };
      byTech.set(id, t);
    }
    if (r.id)
      t.jobs.push({
        id: String(r.id),
        number: String(r.number ?? ""),
        title: (r.title as string | null) ?? null,
        status: String(r.status),
        windowStart: r.window_start ? new Date(r.window_start as string) : null,
      });
  }
  return [...byTech.values()];
}
