// Event handlers for `payroll` (BUILD_PLAN §4, §7). Owner: B6.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'payroll.<what>'. Slow work → enqueueJob().
//
// Job financials are recomputed on every money change until the job is locked
// (recompute is a no-op when nothing changed: unchanged ledger keys post nothing).
import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { invoices, payments } from "@/db/schema";
import type { DomainEvent, HandlerReg, IgnoreReg } from "@/lib/events";
import { SYSTEM_ACTOR } from "@/lib/types";
import { checkCashLimits } from "./server/cash";
import { applyDispute, applyRecallClawback } from "./server/chargebacks";
import { recomputeJobFinancials } from "./server/financials";
import { generateSettlements } from "./server/settlements";

async function jobOfInvoice(tx: Tx, invoiceId: string | null | undefined) {
  if (!invoiceId) return null;
  const [r] = await tx
    .select({ jobId: invoices.jobId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return r?.jobId ?? null;
}

async function jobOfPayment(tx: Tx, paymentId: string) {
  const [p] = await tx
    .select({ jobId: payments.jobId, invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  return p?.jobId ?? (await jobOfInvoice(tx, p?.invoiceId));
}

// biome-ignore lint/suspicious/noExplicitAny: handlers receive any event shape
type AnyEvent = DomainEvent<any>;

const recompute =
  (reason: string, pick: (e: AnyEvent, tx: Tx) => Promise<string | null>) =>
  async (e: AnyEvent, { tx }: { tx: Tx }) => {
    const jobId = await pick(e, tx);
    if (jobId) await recomputeJobFinancials(tx, jobId, SYSTEM_ACTOR, reason);
  };

const p = (e: AnyEvent) => e.payload as Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export const handlers: HandlerReg[] = [
  {
    event: "job.completed",
    name: "payroll.recompute_on_completed",
    run: recompute("job.completed", async (e) => str(p(e).job_id)),
  },
  {
    event: "job.cancelled",
    name: "payroll.recompute_on_cancelled",
    run: recompute("job.cancelled", async (e) => str(p(e).job_id)),
  },
  {
    event: "invoice.issued",
    name: "payroll.recompute_on_invoice_issued",
    run: recompute("invoice.issued", (e, tx) =>
      jobOfInvoice(tx, str(p(e).invoice_id)),
    ),
  },
  {
    event: "invoice.revised",
    name: "payroll.recompute_on_invoice_revised",
    run: recompute("invoice.revised", (e, tx) =>
      jobOfInvoice(tx, str(p(e).invoice_id)),
    ),
  },
  {
    event: "invoice.paid",
    name: "payroll.post_on_invoice_paid",
    run: recompute("invoice.paid", (e, tx) =>
      jobOfInvoice(tx, str(p(e).invoice_id)),
    ),
  },
  {
    event: "invoice.voided",
    name: "payroll.recompute_on_invoice_voided",
    run: recompute("invoice.voided", (e, tx) =>
      jobOfInvoice(tx, str(p(e).invoice_id)),
    ),
  },
  {
    event: "payment.succeeded",
    name: "payroll.recompute_on_payment",
    async run(e, { tx }) {
      const pl = p(e);
      const jobId =
        str(pl.job_id) ??
        (await jobOfInvoice(tx, str(pl.invoice_id))) ??
        (await jobOfPayment(tx, String(pl.payment_id)));
      if (jobId)
        await recomputeJobFinancials(
          tx,
          jobId,
          SYSTEM_ACTOR,
          "payment.succeeded",
        );
      const by = str(pl.collected_by);
      if (by && (pl.method === "cash" || pl.method === "check"))
        await checkCashLimits(tx, [by], SYSTEM_ACTOR);
    },
  },
  {
    // QA2: the card fee estimate was replaced by the processor's actual fee.
    event: "payment.fee_updated",
    name: "payroll.recompute_on_fee",
    run: recompute(
      "payment.fee_updated",
      async (e, tx) =>
        str(p(e).job_id) ??
        (await jobOfInvoice(tx, str(p(e).invoice_id))) ??
        jobOfPayment(tx, String(p(e).payment_id)),
    ),
  },
  {
    event: "refund.created",
    name: "payroll.recompute_on_refund_created",
    run: recompute(
      "refund.created",
      async (e, tx) =>
        str(p(e).job_id) ?? jobOfPayment(tx, String(p(e).payment_id)),
    ),
  },
  {
    event: "refund.succeeded",
    name: "payroll.recompute_on_refund",
    run: recompute(
      "refund.succeeded",
      async (e, tx) =>
        str(p(e).job_id) ?? jobOfPayment(tx, String(p(e).payment_id)),
    ),
  },
  {
    event: "dispute.created",
    name: "payroll.chargeback_hold",
    async run(e, { tx }) {
      await applyDispute(tx, String(p(e).dispute_id), SYSTEM_ACTOR);
    },
  },
  {
    event: "dispute.updated",
    name: "payroll.chargeback_update",
    async run(e, { tx }) {
      await applyDispute(tx, String(p(e).dispute_id), SYSTEM_ACTOR);
    },
  },
  {
    event: "dispute.closed",
    name: "payroll.chargeback_close",
    async run(e, { tx }) {
      await applyDispute(tx, String(p(e).dispute_id), SYSTEM_ACTOR);
    },
  },
  {
    event: "job.callback_created",
    name: "payroll.recall_policy",
    async run(e, { tx }) {
      const pl = p(e);
      const cb = str(pl.job_id);
      const orig = str(pl.original_job_id);
      if (cb && orig) await applyRecallClawback(tx, cb, orig, SYSTEM_ACTOR);
    },
  },
  {
    event: "review.received_logged",
    name: "payroll.review_bonus",
    run: recompute("review.received_logged", async (e) => str(p(e).job_id)),
  },
  {
    event: "part_purchase.approved",
    name: "payroll.recompute_on_part_approved",
    run: recompute("part_purchase.approved", async (e) => str(p(e).job_id)),
  },
  {
    event: "part_purchase.rejected",
    name: "payroll.recompute_on_part_rejected",
    run: recompute("part_purchase.rejected", async (e) => str(p(e).job_id)),
  },
  {
    event: "pay_period.closed",
    name: "payroll.draft_settlements",
    async run(e, { tx, now }) {
      // The pass's clock (tick `now`), so review deadlines follow the cron (T6-14).
      await generateSettlements(
        tx,
        String(p(e).pay_period_id),
        SYSTEM_ACTOR,
        now,
      );
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
