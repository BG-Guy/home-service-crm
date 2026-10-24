import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, execRows } from "@/db";
import { lineItems } from "@/db/schema";
import { headlineTotal, optionTotals } from "@/features/estimates/logic";
import { defaultTaxBps } from "@/features/invoices/api";
import type { InvoiceSummary } from "@/features/invoices/contracts";
import {
  isLeadQuoteLine,
  LEAD_QUOTE_LINE_DESCRIPTION,
} from "@/features/invoices/lead-quote";
import { getJobMoney } from "@/features/payments/api";
import type { DepositBrief } from "@/features/payments/contracts";
import {
  type MoneyDeposit,
  type MoneyEstimate,
  type MoneyFacts,
  type MoneyStage,
  moneyStage,
} from "./money-stage";

// Reads for the job's money card and the job cards' stage badge (Quote to Paid,
// part J). Light on purpose: the estimates come from one query plus the default
// tax rate (not the per-estimate briefs), the payments and deposits from the
// payments module's getJobMoney. No permission checks here: callers pass a job
// they already read through the viewer's scope (getJobDetail / listJobs).

type EstimateLineRow = {
  id: string;
  number: string;
  status: string;
  approved_option_id: string | null;
  sent_at: string | Date | null;
  viewed_at: string | Date | null;
  approved_at: string | Date | null;
  created_at: string | Date;
  tax_exempt: boolean;
  option_id: string | null;
  label: string | null;
  recommended: boolean | null;
  line_id: string | null;
  type: string | null;
  total_cents: string | number | null;
  taxable: boolean | null;
  tax_rate_bps: number | null;
  is_optional: boolean | null;
  is_selected: boolean | null;
};

/** The job's estimates with their totals (tax included), newest first. */
export async function jobEstimatesForMoney(
  jobId: string,
): Promise<MoneyEstimate[]> {
  const [rows, bps] = await Promise.all([
    execRows<EstimateLineRow>(sql`
      select e.id, e.number, e.status, e.approved_option_id, e.sent_at, e.viewed_at,
             e.approved_at, e.created_at, c.tax_exempt,
             o.id as option_id, o.label, o.recommended,
             li.id as line_id, li.type, li.total_cents, li.taxable, li.tax_rate_bps,
             li.is_optional, li.is_selected
      from estimates e
      join customers c on c.id = e.customer_id
      left join estimate_options o on o.estimate_id = e.id
      left join line_items li
        on li.parent_type = 'estimate_option' and li.parent_id = o.id
      where e.job_id = ${jobId}
      order by e.created_at desc, o.sort, o.created_at`),
    defaultTaxBps(),
  ]);
  type Option = {
    id: string;
    label: string;
    recommended: boolean;
    lines: Parameters<typeof optionTotals>[0][number][];
  };
  const byEstimate = new Map<
    string,
    { row: EstimateLineRow; options: Map<string, Option> }
  >();
  for (const r of rows) {
    const e = byEstimate.get(r.id) ?? { row: r, options: new Map() };
    byEstimate.set(r.id, e);
    if (!r.option_id) continue;
    const o = e.options.get(r.option_id) ?? {
      id: r.option_id,
      label: r.label ?? "",
      recommended: !!r.recommended,
      lines: [],
    };
    e.options.set(r.option_id, o);
    if (r.line_id)
      o.lines.push({
        id: r.line_id,
        type: (r.type ?? "service") as never,
        totalCents: Number(r.total_cents ?? 0),
        taxable: !!r.taxable,
        taxRateBps: r.tax_rate_bps,
        isOptional: !!r.is_optional,
        isSelected: r.is_selected !== false,
      });
  }
  return [...byEstimate.values()].map(({ row, options }) => {
    const opts = [...options.values()].map((o) => ({
      ...o,
      totalCents: optionTotals(o.lines, bps, { taxExempt: row.tax_exempt })
        .totalCents,
      approved: o.id === row.approved_option_id,
    }));
    const priced = opts.filter((o) => o.lines.length > 0);
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      hasLines: priced.length > 0,
      optionCount: opts.length,
      totalCents: headlineTotal(opts),
      fromCents: priced.length
        ? Math.min(...priced.map((o) => o.totalCents))
        : 0,
      approvedLabel: opts.find((o) => o.approved)?.label || null,
      recommendedLabel: opts.find((o) => o.recommended)?.label || null,
      sentAt: row.sent_at,
      viewedAt: row.viewed_at,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    };
  });
}

/** Does the invoice have real lines (not only the lead's quoted-price placeholder)? */
export async function invoiceHasRealLines(invoiceId: string): Promise<boolean> {
  const rows = await db
    .select({
      description: lineItems.description,
      pricebookItemId: lineItems.pricebookItemId,
      type: lineItems.type,
    })
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "invoice"),
        eq(lineItems.parentId, invoiceId),
      ),
    );
  return rows.some((l) => !isLeadQuoteLine(l));
}

/** The deposit request that counts: an open one first, else the newest settled one. */
export function pickDeposit(
  deposits: readonly Pick<DepositBrief, "amountCents" | "status">[],
): MoneyDeposit | null {
  const open = deposits.find(
    (d) => d.status === "required" || d.status === "requested",
  );
  const d =
    open ??
    deposits.find((x) => ["paid", "held", "applied"].includes(x.status));
  return d ? { amountCents: d.amountCents, status: d.status } : null;
}

/**
 * Everything the job's money card needs. Pass the invoice summary when the page
 * already read it (getInvoiceForJob), so it isn't read twice.
 */
export async function loadJobMoneyFacts(
  job: { id: string; status: string; customerFirstName: string | null },
  opts: { estimatesOn: boolean; invoice: InvoiceSummary | null },
): Promise<MoneyFacts> {
  const inv =
    opts.invoice && opts.invoice.status !== "void" ? opts.invoice : null;
  const [money, estimates, hasLines] = await Promise.all([
    getJobMoney(job.id),
    opts.estimatesOn ? jobEstimatesForMoney(job.id) : [],
    inv ? invoiceHasRealLines(inv.id) : false,
  ]);
  const tipCents = money.payments
    .filter(
      (p) => p.status === "succeeded" || p.status === "partially_refunded",
    )
    .reduce((s, p) => s + p.tipCents, 0);
  return {
    jobStatus: job.status,
    paymentStatus: money.paymentStatus,
    estimatesOn: opts.estimatesOn,
    customerFirstName: job.customerFirstName,
    estimates,
    deposit: pickDeposit(money.deposits),
    invoice: inv
      ? {
          id: inv.id,
          number: inv.number,
          status: inv.status,
          totalCents: inv.totalCents,
          balanceCents: inv.balanceCents,
          hasLines,
        }
      : null,
    paidCents: money.paidCents,
    depositPaidCents: money.depositPaidCents,
    tipCents,
  };
}

type BadgeRow = {
  job_id: string;
  status: string;
  payment_status: string;
  estimates:
    | { status: string; has_lines: boolean; created_at: string }[]
    | null;
  deposit: { status: string; amount_cents: number } | null;
  invoice: {
    id: string;
    number: string;
    status: string;
    total_cents: number;
    balance_cents: number;
    has_lines: boolean;
  } | null;
  paid_cents: number;
  deposit_paid_cents: number;
};

/**
 * The money stage of many jobs at once (the /jobs cards): one query for the page,
 * like assigneesFor. Totals aren't read; the badge only needs where the money is.
 */
export async function moneyStagesFor(
  jobIds: string[],
  opts: { estimatesOn: boolean; tz: string },
): Promise<Map<string, MoneyStage>> {
  const out = new Map<string, MoneyStage>();
  if (jobIds.length === 0) return out;
  const ids = sql.join(
    jobIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await execRows<BadgeRow>(sql`
    select j.id as job_id, j.status, j.payment_status,
      (select json_agg(json_build_object(
          'status', e.status,
          'created_at', e.created_at,
          'has_lines', exists (
            select 1 from estimate_options o
            join line_items li on li.parent_type = 'estimate_option' and li.parent_id = o.id
            where o.estimate_id = e.id)))
        from estimates e where e.job_id = j.id) as estimates,
      (select json_build_object('status', d.status, 'amount_cents', d.amount_cents)
        from deposit_requests d
        where d.job_id = j.id and d.status in ('required','requested','paid','held','applied')
        order by (d.status in ('required','requested')) desc, d.created_at desc
        limit 1) as deposit,
      (select json_build_object(
          'id', i.id, 'number', i.number, 'status', i.status,
          'total_cents', i.total_cents,
          'balance_cents', coalesce(b.total_cents - b.paid_cents + b.refunded_cents - b.credited_cents, i.total_cents),
          'has_lines', exists (
            select 1 from line_items li
            where li.parent_type = 'invoice' and li.parent_id = i.id
              and not (li.description is not distinct from ${LEAD_QUOTE_LINE_DESCRIPTION}
                       and li.pricebook_item_id is null and li.type = 'service')))
        from invoices i
        left join invoice_balances b on b.invoice_id = i.id
        where i.job_id = j.id and i.status <> 'void'
        order by i.created_at desc
        limit 1) as invoice,
      coalesce((select sum(p.amount_cents) from payments p
        where p.job_id = j.id
          and p.status in ('succeeded','partially_refunded','refunded','disputed')), 0)::int as paid_cents,
      coalesce((select sum(p.amount_cents) from payments p
        where p.job_id = j.id and p.kind = 'deposit'
          and p.status in ('succeeded','partially_refunded','refunded','disputed')), 0)::int as deposit_paid_cents
    from jobs j
    where j.id in (${ids})`);
  for (const r of rows) {
    const inv = r.invoice;
    out.set(
      r.job_id,
      moneyStage(
        {
          jobStatus: r.status,
          paymentStatus: r.payment_status,
          estimatesOn: opts.estimatesOn,
          customerFirstName: null,
          estimates: (r.estimates ?? []).map((e, i) => ({
            id: `${r.job_id}:${i}`,
            number: "",
            status: e.status,
            hasLines: !!e.has_lines,
            optionCount: 0,
            totalCents: 0,
            fromCents: 0,
            approvedLabel: null,
            recommendedLabel: null,
            createdAt: e.created_at,
          })),
          deposit: r.deposit
            ? {
                status: r.deposit.status,
                amountCents: Number(r.deposit.amount_cents),
              }
            : null,
          invoice: inv
            ? {
                id: inv.id,
                number: inv.number,
                status: inv.status,
                totalCents: Number(inv.total_cents),
                balanceCents: Number(inv.balance_cents),
                hasLines: !!inv.has_lines,
              }
            : null,
          paidCents: Number(r.paid_cents),
          depositPaidCents: Number(r.deposit_paid_cents),
        },
        { tz: opts.tz },
      ),
    );
  }
  return out;
}
