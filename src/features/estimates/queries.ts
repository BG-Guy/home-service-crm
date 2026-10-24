import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { cache } from "react";
import { execRows } from "@/db";
import { defaultTaxBps } from "@/features/invoices/api";
import { requireUser } from "@/lib/auth/current";
import type { SessionUser } from "@/lib/types";
import { estimateScopeSql } from "./access";
import { closeRate, headlineTotal, optionTotals } from "./logic";

// Estimate read DAL (SPEC M07; Appendix A `/estimates` params). Every list calls
// requireUser('estimates.view') and applies the row scope (access.ts).

export interface EstimateListParams {
  status?: string;
  tech?: string;
  from?: string;
  to?: string;
  unsold?: boolean;
  q?: string;
  customerId?: string;
  jobId?: string;
}

export interface EstimateListRow {
  id: string;
  number: string;
  status: string;
  title: string | null;
  customerId: string;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  createdByName: string | null;
  totalCents: number;
  optionCount: number;
  sentAt: Date | null;
  viewedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = [
  "draft",
  "sent",
  "viewed",
  "approved",
  "declined",
  "expired",
  "superseded",
];
const d = (v: string | Date | null) => (v == null ? null : new Date(v));

function filterSql(p: EstimateListParams): SQL[] {
  const w: SQL[] = [];
  if (p.unsold) w.push(sql`e.status in ('sent','viewed')`);
  const st = (p.status ?? "").split(",").filter((s) => STATUSES.includes(s));
  if (st.length)
    w.push(
      sql`e.status in (${sql.join(
        st.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  if (p.tech && UUID.test(p.tech))
    w.push(
      sql`(e.created_by = ${p.tech} or exists (select 1 from job_assignments ta where ta.job_id = e.job_id and ta.user_id = ${p.tech}))`,
    );
  if (p.customerId && UUID.test(p.customerId))
    w.push(sql`e.customer_id = ${p.customerId}`);
  if (p.jobId && UUID.test(p.jobId)) w.push(sql`e.job_id = ${p.jobId}`);
  if (p.from && DAY.test(p.from)) w.push(sql`e.created_at >= ${p.from}::date`);
  if (p.to && DAY.test(p.to)) w.push(sql`e.created_at < (${p.to}::date + 1)`);
  const q = p.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    w.push(
      sql`(e.number ilike ${like} or c.display_name ilike ${like} or e.title ilike ${like})`,
    );
  }
  return w;
}

/** Headline totals (approved option, else recommended, else max; tax incl.) for a set of estimates. */
export async function headlineTotals(
  rows: { id: string; taxExempt: boolean }[],
): Promise<Map<string, { totalCents: number; optionCount: number }>> {
  const out = new Map<string, { totalCents: number; optionCount: number }>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => sql`${r.id}::uuid`);
  const [lines, bps] = await Promise.all([
    execRows<{
      estimate_id: string;
      option_id: string;
      recommended: boolean;
      approved: boolean;
      line_id: string | null;
      type: string | null;
      total_cents: string | number | null;
      taxable: boolean | null;
      tax_rate_bps: number | null;
      is_optional: boolean | null;
      is_selected: boolean | null;
    }>(sql`
      select o.estimate_id, o.id as option_id, o.recommended,
             (o.id = e.approved_option_id) is true as approved,
             li.id as line_id, li.type,
             li.total_cents, li.taxable, li.tax_rate_bps, li.is_optional, li.is_selected
      from estimate_options o
      join estimates e on e.id = o.estimate_id
      left join line_items li on li.parent_type = 'estimate_option' and li.parent_id = o.id
      where o.estimate_id in (${sql.join(ids, sql`, `)})`),
    defaultTaxBps(),
  ]);
  const exempt = new Map(rows.map((r) => [r.id, r.taxExempt]));
  const byOption = new Map<
    string,
    {
      estimateId: string;
      recommended: boolean;
      approved: boolean;
      lines: Parameters<typeof optionTotals>[0][number][];
    }
  >();
  for (const l of lines) {
    const o = byOption.get(l.option_id) ?? {
      estimateId: l.estimate_id,
      recommended: l.recommended,
      approved: !!l.approved,
      lines: [],
    };
    if (l.line_id)
      o.lines.push({
        id: l.line_id,
        type: (l.type ?? "service") as never,
        totalCents: Number(l.total_cents ?? 0),
        taxable: !!l.taxable,
        taxRateBps: l.tax_rate_bps,
        isOptional: !!l.is_optional,
        isSelected: l.is_selected !== false,
      });
    byOption.set(l.option_id, o);
  }
  const perEstimate = new Map<
    string,
    { recommended: boolean; approved: boolean; totalCents: number }[]
  >();
  for (const o of byOption.values()) {
    const t = optionTotals(o.lines, bps, {
      taxExempt: exempt.get(o.estimateId) ?? false,
    });
    const list = perEstimate.get(o.estimateId) ?? [];
    list.push({
      recommended: o.recommended,
      approved: o.approved,
      totalCents: t.totalCents,
    });
    perEstimate.set(o.estimateId, list);
  }
  for (const [id, opts] of perEstimate)
    out.set(id, { totalCents: headlineTotal(opts), optionCount: opts.length });
  return out;
}

async function listFor(
  user: SessionUser,
  p: EstimateListParams,
  limit: number,
): Promise<EstimateListRow[]> {
  const where = [estimateScopeSql(user), ...filterSql(p)];
  const rows = await execRows<{
    id: string;
    number: string;
    status: string;
    title: string | null;
    customer_id: string;
    customer_name: string;
    tax_exempt: boolean;
    job_id: string | null;
    job_number: string | null;
    created_by_name: string | null;
    sent_at: string | Date | null;
    viewed_at: string | Date | null;
    expires_at: string | Date | null;
    created_at: string | Date;
  }>(sql`
    select e.id, e.number, e.status, e.title, e.customer_id, c.display_name as customer_name,
           c.tax_exempt, e.job_id, j.number as job_number, u.name as created_by_name,
           e.sent_at, e.viewed_at, e.expires_at, e.created_at
    from estimates e
    join customers c on c.id = e.customer_id
    left join jobs j on j.id = e.job_id
    left join users u on u.id = e.created_by
    where ${sql.join(where, sql` and `)}
    order by e.created_at desc
    limit ${limit}`);
  const totals = await headlineTotals(
    rows.map((r) => ({ id: r.id, taxExempt: r.tax_exempt })),
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    title: r.title,
    customerId: r.customer_id,
    customerName: r.customer_name,
    jobId: r.job_id,
    jobNumber: r.job_number,
    createdByName: r.created_by_name,
    totalCents: totals.get(r.id)?.totalCents ?? 0,
    optionCount: totals.get(r.id)?.optionCount ?? 0,
    sentAt: d(r.sent_at),
    viewedAt: d(r.viewed_at),
    expiresAt: d(r.expires_at),
    createdAt: new Date(r.created_at),
  }));
}

/** List (newest first), or the unsold board (sent/viewed, by value, high first). */
export const listEstimates = cache(
  async (p: EstimateListParams): Promise<EstimateListRow[]> => {
    const user = await requireUser("estimates.view");
    const rows = await listFor(user, p, p.unsold ? 300 : 100);
    if (p.unsold) rows.sort((a, b) => b.totalCents - a.totalCents);
    return rows;
  },
);

/** Customer panel (S12): no requireUser — the slot checked the viewer. */
export async function listEstimatesForViewer(
  user: SessionUser,
  p: EstimateListParams,
  limit = 20,
): Promise<EstimateListRow[]> {
  return listFor(user, p, limit);
}

export interface CloseRateRow {
  userId: string;
  name: string;
  approved: number;
  declined: number;
  expired: number;
  open: number;
  approvedCents: number;
  openCents: number;
  rate: number | null;
}

/** Close rate per tech (estimate author), last 90 days unless a range is given. */
export const getCloseRates = cache(
  async (p: { from?: string; to?: string }): Promise<CloseRateRow[]> => {
    const user = await requireUser("estimates.view");
    if (!user.perms.has("jobs.view_all")) return [];
    const range: SQL[] = [];
    if (p.from && DAY.test(p.from))
      range.push(sql`e.created_at >= ${p.from}::date`);
    else range.push(sql`e.created_at >= now() - interval '90 days'`);
    if (p.to && DAY.test(p.to))
      range.push(sql`e.created_at < (${p.to}::date + 1)`);
    const rows = await execRows<{
      id: string;
      status: string;
      created_by: string | null;
      name: string | null;
      tax_exempt: boolean;
    }>(sql`
      select e.id, e.status, e.created_by, u.name, c.tax_exempt
      from estimates e
      join customers c on c.id = e.customer_id
      left join users u on u.id = e.created_by
      where e.created_by is not null and ${sql.join(range, sql` and `)}`);
    const totals = await headlineTotals(
      rows.map((r) => ({ id: r.id, taxExempt: r.tax_exempt })),
    );
    const by = new Map<string, CloseRateRow>();
    for (const r of rows) {
      const k = r.created_by as string;
      const row =
        by.get(k) ??
        ({
          userId: k,
          name: r.name ?? "Unknown",
          approved: 0,
          declined: 0,
          expired: 0,
          open: 0,
          approvedCents: 0,
          openCents: 0,
          rate: null,
        } satisfies CloseRateRow);
      const t = totals.get(r.id)?.totalCents ?? 0;
      if (r.status === "approved") {
        row.approved++;
        row.approvedCents += t;
      } else if (r.status === "declined") row.declined++;
      else if (r.status === "expired") row.expired++;
      else if (r.status === "sent" || r.status === "viewed") {
        row.open++;
        row.openCents += t;
      }
      by.set(k, row);
    }
    return [...by.values()]
      .map((r) => ({ ...r, rate: closeRate(r) }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  },
);

export const getEstimateTechOptions = cache(async () => {
  const user = await requireUser("estimates.view");
  if (!user.perms.has("jobs.view_all")) return [];
  return execRows<{ id: string; name: string }>(sql`
    select u.id, u.name from users u join roles r on r.key = u.role
    where u.status = 'active' and r.base_role in ('tech','office','admin') order by u.name`);
});
