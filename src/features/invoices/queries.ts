import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { cache } from "react";
import { execRows } from "@/db";
import { canSeeCustomer, contactRevealedFor } from "@/features/customers/api";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError } from "@/lib/errors";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { addressLines } from "./doc";
import { areaLine, maskContact } from "./masking";
import {
  type AgingBucket,
  agingBucket,
  isOverdue,
  overdueCutoff,
} from "./math";

// Invoice read DAL (SPEC M08; BUILD_PLAN Appendix A `/invoices` params). Every query
// calls requireUser('invoices.view') first and applies the row scope: techs without
// jobs.view_all see only invoices for jobs they're assigned to (DAL-enforced).

export type InvoiceListFilter =
  | "all"
  | "open"
  | "overdue"
  | "draft"
  | "paid"
  | "closed";

export interface InvoiceListParams {
  status?: string;
  aging?: string;
  tech?: string;
  source?: string;
  revisedAfterPayment?: boolean;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
}

export interface InvoiceListRow {
  id: string;
  number: string;
  status: string;
  overdue: boolean;
  customerId: string;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  techName: string | null;
  totalCents: number;
  balanceCents: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  createdAt: Date;
  version: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 50;

/** Row-scope predicate on alias `i` (invoices). */
export function invoiceScopeSql(user: SessionUser): SQL {
  if (user.perms.has("jobs.view_all")) return sql`true`;
  return sql`exists (select 1 from job_assignments ja where ja.job_id = i.job_id and ja.user_id = ${user.id})`;
}

const BALANCE = sql`(i.total_cents - coalesce(b.paid_cents,0) + coalesce(b.refunded_cents,0) - coalesce(b.credited_cents,0))`;

/** The company clock for overdue decisions (math.ts isOverdue / overdueCutoff). */
interface Clock {
  now: Date;
  tz: string;
  /** Local midnight starting today: `due_at < cutoff` = overdue. */
  cutoff: Date;
}
async function companyClock(): Promise<Clock> {
  const tz = await getCompanyTimezone();
  const now = new Date();
  return { now, tz, cutoff: overdueCutoff(now, tz) };
}

function filterSql(p: InvoiceListParams, clock: Clock): SQL[] {
  const w: SQL[] = [];
  const statuses = (p.status ?? "").split(",").filter(Boolean);
  for (const s of statuses.length > 1 ? [] : statuses) {
    if (s === "open") w.push(sql`i.status in ('issued','partially_paid')`);
    else if (s === "overdue")
      w.push(
        sql`i.status in ('issued','partially_paid') and i.due_at < ${clock.cutoff}`,
      );
    else if (s === "closed") w.push(sql`i.status in ('void','uncollectible')`);
    else if (
      [
        "draft",
        "issued",
        "partially_paid",
        "paid",
        "void",
        "uncollectible",
      ].includes(s)
    )
      w.push(sql`i.status = ${s}`);
  }
  if (statuses.length > 1) {
    const ok = statuses.filter((s) =>
      [
        "draft",
        "issued",
        "partially_paid",
        "paid",
        "void",
        "uncollectible",
      ].includes(s),
    );
    if (ok.length)
      w.push(
        sql`i.status in (${sql.join(
          ok.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
  }
  if (p.aging) {
    const open = sql`i.status in ('issued','partially_paid')`;
    // Calendar days past due in the company time zone (math.ts daysPastDue).
    const days = sql`greatest(0, ${dateKey(clock.now, clock.tz)}::date - (coalesce(i.due_at, i.issued_at, i.created_at) at time zone ${clock.tz})::date)`;
    if (p.aging === "0-30") w.push(sql`${open} and ${days} <= 30`);
    else if (p.aging === "31-60")
      w.push(sql`${open} and ${days} between 31 and 60`);
    else if (p.aging === "61-90")
      w.push(sql`${open} and ${days} between 61 and 90`);
    else if (p.aging === "90+") w.push(sql`${open} and ${days} > 90`);
  }
  if (p.tech && UUID.test(p.tech))
    w.push(
      sql`exists (select 1 from job_assignments ta where ta.job_id = i.job_id and ta.user_id = ${p.tech})`,
    );
  if (p.source && UUID.test(p.source))
    w.push(sql`coalesce(l.lead_source_id, c.lead_source_id) = ${p.source}`);
  if (p.revisedAfterPayment)
    w.push(sql`exists (
      select 1 from invoice_revisions r
      where r.invoice_id = i.id and r.version > 1
        and r.created_at > (select min(pp.succeeded_at) from payments pp
          where pp.invoice_id = i.id and pp.status in ('succeeded','partially_refunded','refunded','disputed')))`);
  if (p.from && DAY.test(p.from))
    w.push(sql`coalesce(i.issued_at, i.created_at) >= ${p.from}::date`);
  if (p.to && DAY.test(p.to))
    w.push(sql`coalesce(i.issued_at, i.created_at) < (${p.to}::date + 1)`);
  const q = p.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    w.push(
      sql`(i.number ilike ${like} or c.display_name ilike ${like} or j.number ilike ${like})`,
    );
  }
  if (p.cursor) {
    const [iso, id] = p.cursor.split("_");
    if (iso && id && UUID.test(id) && !Number.isNaN(Date.parse(iso)))
      w.push(sql`(i.created_at, i.id) < (${iso}::timestamptz, ${id}::uuid)`);
  }
  return w;
}

type RawRow = {
  id: string;
  number: string;
  status: string;
  customer_id: string;
  customer_name: string;
  job_id: string | null;
  job_number: string | null;
  tech_name: string | null;
  total_cents: string | number;
  balance_cents: string | number;
  issued_at: string | Date | null;
  due_at: string | Date | null;
  created_at: string | Date;
  version: number;
};

const d = (v: string | Date | null) => (v == null ? null : new Date(v));

export const listInvoices = cache(
  async (
    p: InvoiceListParams,
  ): Promise<{ rows: InvoiceListRow[]; nextCursor: string | null }> => {
    const user = await requireUser("invoices.view");
    const clock = await companyClock();
    const where = [invoiceScopeSql(user), ...filterSql(p, clock)];
    const rows = await execRows<RawRow>(sql`
      select i.id, i.number, i.status, i.customer_id, c.display_name as customer_name,
             i.job_id, j.number as job_number, t.name as tech_name,
             i.total_cents, ${BALANCE} as balance_cents,
             i.issued_at, i.due_at, i.created_at, i.version
      from invoices i
      join customers c on c.id = i.customer_id
      left join jobs j on j.id = i.job_id
      left join leads l on l.id = j.lead_id
      left join invoice_balances b on b.invoice_id = i.id
      left join lateral (
        select u.name from job_assignments a join users u on u.id = a.user_id
        where a.job_id = i.job_id order by (a.role = 'primary') desc, a.assigned_at limit 1
      ) t on true
      where ${sql.join(where, sql` and `)}
      order by i.created_at desc, i.id desc
      limit ${PAGE + 1}`);
    const out = rows.slice(0, PAGE).map((r) => {
      const dueAt = d(r.due_at);
      const balance = Number(r.balance_cents);
      return {
        id: r.id,
        number: r.number,
        status: r.status,
        overdue:
          (r.status === "issued" || r.status === "partially_paid") &&
          isOverdue(dueAt, clock.now, clock.tz) &&
          balance > 0,
        customerId: r.customer_id,
        customerName: r.customer_name,
        jobId: r.job_id,
        jobNumber: r.job_number,
        techName: r.tech_name,
        totalCents: Number(r.total_cents),
        balanceCents: r.status === "void" ? 0 : balance,
        issuedAt: d(r.issued_at),
        dueAt,
        createdAt: new Date(r.created_at),
        version: r.version,
      };
    });
    const last = out[out.length - 1];
    return {
      rows: out,
      nextCursor:
        rows.length > PAGE && last
          ? `${last.createdAt.toISOString()}_${last.id}`
          : null,
    };
  },
);

/** Aging totals for open invoices in scope (respects tech/source filters). */
export const getAgingSummary = cache(
  async (p: Pick<InvoiceListParams, "tech" | "source">) => {
    const user = await requireUser("invoices.view");
    const clock = await companyClock();
    const where = [
      invoiceScopeSql(user),
      sql`i.status in ('issued','partially_paid')`,
      ...filterSql({ tech: p.tech, source: p.source }, clock),
    ];
    const rows = await execRows<{
      due_at: string | Date | null;
      issued_at: string | Date | null;
      balance: string | number;
    }>(sql`
      select i.due_at, i.issued_at, ${BALANCE} as balance
      from invoices i
      join customers c on c.id = i.customer_id
      left join jobs j on j.id = i.job_id
      left join leads l on l.id = j.lead_id
      left join invoice_balances b on b.invoice_id = i.id
      where ${sql.join(where, sql` and `)}`);
    const buckets: Record<AgingBucket, { count: number; cents: number }> = {
      "0-30": { count: 0, cents: 0 },
      "31-60": { count: 0, cents: 0 },
      "61-90": { count: 0, cents: 0 },
      "90+": { count: 0, cents: 0 },
    };
    let overdueCents = 0;
    let overdueCount = 0;
    for (const r of rows) {
      const bal = Number(r.balance);
      if (bal <= 0) continue;
      const due = d(r.due_at) ?? d(r.issued_at);
      const b = buckets[agingBucket(due, clock.now, clock.tz)];
      b.count++;
      b.cents += bal;
      if (isOverdue(due, clock.now, clock.tz)) {
        overdueCents += bal;
        overdueCount++;
      }
    }
    const totalCents = Object.values(buckets).reduce((a, b) => a + b.cents, 0);
    return { buckets, totalCents, overdueCents, overdueCount };
  },
);

/** Filter options: techs and lead sources. */
export const getInvoiceFilterOptions = cache(async () => {
  const user = await requireUser("invoices.view");
  const [techs, sources] = await Promise.all([
    user.perms.has("jobs.view_all")
      ? execRows<{ id: string; name: string }>(sql`
          select u.id, u.name from users u join roles r on r.key = u.role
          where r.base_role = 'tech' and u.status = 'active' order by u.name`)
      : Promise.resolve([]),
    execRows<{ id: string; name: string }>(
      sql`select id, name from lead_sources order by name`,
    ),
  ]);
  return { techs, sources };
});

export interface StatementData {
  customer: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    addressLines: string[];
  };
  invoices: {
    id: string;
    number: string;
    status: string;
    issuedAt: Date | null;
    dueAt: Date | null;
    jobNumber: string | null;
    totalCents: number;
    paidCents: number;
    balanceCents: number;
    overdue: boolean;
  }[];
  totalDueCents: number;
  overdueCents: number;
}

/**
 * May the viewer open this customer's statement? The customer must be in their
 * customer scope (customers/api `canSeeCustomer`), or they must have at least one
 * invoice for that customer in their invoice scope (the same rows the list shows).
 */
async function canViewStatement(
  user: SessionUser,
  customerId: string,
): Promise<boolean> {
  if (await canSeeCustomer(user, customerId)) return true;
  const rows = await execRows(sql`
    select 1 from invoices i
    where i.customer_id = ${customerId} and ${invoiceScopeSql(user)}
    limit 1`);
  return rows.length > 0;
}

/**
 * Customer statement: all open invoices (scoped like the list). Throws
 * ForbiddenError for a customer outside the viewer's scope; contact details are
 * masked outside the contact window (SPEC §4.2).
 */
export const getStatement = cache(
  async (customerId: string): Promise<StatementData | null> => {
    const user = await requireUser("invoices.view");
    if (!UUID.test(customerId)) return null;
    if (!(await canViewStatement(user, customerId))) throw new ForbiddenError();
    const [c] = await execRows<{
      id: string;
      display_name: string;
      company_name: string | null;
      email: string | null;
      phone: string | null;
      street: string | null;
      unit: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
    }>(sql`
      select c.id, c.display_name, c.company_name, c.email, c.phone,
             p.street, p.unit, p.city, p.state, p.zip
      from customers c
      left join lateral (
        select * from properties p where p.customer_id = c.id and p.deleted_at is null
        order by p.is_primary desc, p.created_at limit 1
      ) p on true
      where c.id = ${customerId}`);
    if (!c) return null;
    const { revealed } = await contactRevealedFor(user, customerId);
    const rows = await execRows<{
      id: string;
      number: string;
      status: string;
      issued_at: string | Date | null;
      due_at: string | Date | null;
      job_number: string | null;
      total_cents: string | number;
      paid: string | number;
      balance: string | number;
    }>(sql`
      select i.id, i.number, i.status, i.issued_at, i.due_at, j.number as job_number,
             i.total_cents,
             (coalesce(b.paid_cents,0) - coalesce(b.refunded_cents,0) + coalesce(b.credited_cents,0)) as paid,
             ${BALANCE} as balance
      from invoices i
      left join jobs j on j.id = i.job_id
      left join invoice_balances b on b.invoice_id = i.id
      where i.customer_id = ${customerId}
        and i.status in ('issued','partially_paid')
        and ${invoiceScopeSql(user)}
      order by i.issued_at asc nulls last`);
    const clock = await companyClock();
    const list = rows
      .map((r) => {
        const due = d(r.due_at);
        const balance = Number(r.balance);
        return {
          id: r.id,
          number: r.number,
          status: r.status,
          issuedAt: d(r.issued_at),
          dueAt: due,
          jobNumber: r.job_number,
          totalCents: Number(r.total_cents),
          paidCents: Number(r.paid),
          balanceCents: balance,
          overdue: isOverdue(due, clock.now, clock.tz) && balance > 0,
        };
      })
      .filter((r) => r.balanceCents > 0);
    const contact = { email: c.email, phone: c.phone };
    const area = areaLine(c);
    return {
      customer: {
        id: c.id,
        displayName: c.display_name,
        companyName: c.company_name,
        ...(revealed ? contact : maskContact(contact)),
        addressLines: revealed ? addressLines(c) : area ? [area] : [],
      },
      invoices: list,
      totalDueCents: list.reduce((a, r) => a + r.balanceCents, 0),
      overdueCents: list
        .filter((r) => r.overdue)
        .reduce((a, r) => a + r.balanceCents, 0),
    };
  },
);

/** Overdue invoice count for the nav badge (open, past due, in scope). */
export async function countOverdueInvoices(user: SessionUser): Promise<number> {
  if (!user.perms.has("invoices.view") || user.baseRole === "tech") return 0;
  const { cutoff } = await companyClock();
  const [r] = await execRows<{ n: number }>(sql`
    select count(*)::int as n from invoices i
    left join invoice_balances b on b.invoice_id = i.id
    where i.status in ('issued','partially_paid') and i.due_at < ${cutoff}
      and ${BALANCE} > 0 and ${invoiceScopeSql(user)}`);
  return Number(r?.n ?? 0);
}

export interface CustomerInvoiceRow {
  id: string;
  number: string;
  status: string;
  overdue: boolean;
  jobNumber: string | null;
  totalCents: number;
  balanceCents: number;
  issuedAt: Date | null;
  dueAt: Date | null;
}

/** S13: a customer's invoices in the viewer's scope (open first, then recent). */
export async function listCustomerInvoices(
  customerId: string,
  user: SessionUser,
  limit = 20,
): Promise<CustomerInvoiceRow[]> {
  if (!UUID.test(customerId)) return [];
  const rows = await execRows<{
    id: string;
    number: string;
    status: string;
    job_number: string | null;
    total_cents: string | number;
    balance: string | number;
    issued_at: string | Date | null;
    due_at: string | Date | null;
  }>(sql`
    select i.id, i.number, i.status, j.number as job_number, i.total_cents,
           ${BALANCE} as balance, i.issued_at, i.due_at
    from invoices i
    left join jobs j on j.id = i.job_id
    left join invoice_balances b on b.invoice_id = i.id
    where i.customer_id = ${customerId} and i.status <> 'void' and ${invoiceScopeSql(user)}
    order by (i.status in ('issued','partially_paid')) desc, i.created_at desc
    limit ${limit}`);
  const clock = await companyClock();
  return rows.map((r) => {
    const due = d(r.due_at);
    const balance = Number(r.balance);
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      overdue:
        (r.status === "issued" || r.status === "partially_paid") &&
        isOverdue(due, clock.now, clock.tz) &&
        balance > 0,
      jobNumber: r.job_number,
      totalCents: Number(r.total_cents),
      balanceCents: r.status === "draft" ? 0 : balance,
      issuedAt: d(r.issued_at),
      dueAt: due,
    };
  });
}
