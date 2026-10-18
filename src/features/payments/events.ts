// Event handlers for `payments` (BUILD_PLAN §4, §7). Owner: B4.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'payments.<what>'. Slow work → enqueueJob().
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  checkoutSessions,
  depositRequests,
  invoices,
  jobs,
  payments,
  tasks,
} from "@/db/schema";
import { closeTasksFor, createTask } from "@/features/tasks/api";
import { writeActivity } from "@/lib/activity";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { formatMoney, roundHalfAway } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { revokePublicTokens } from "@/lib/tokens";
import { SYSTEM_ACTOR } from "@/lib/types";
import {
  cancelUnneededDeposit,
  ensureDepositRequest,
  settleCoveredDeposits,
} from "./api";
import { flagHolds } from "./background";
import {
  OPEN_DEPOSIT_STATUSES,
  PAID_STATUSES,
  refundedByPayment,
} from "./internal";

async function hasTask(
  tx: Tx,
  kind: string,
  entity: { type: string; id: string },
): Promise<boolean> {
  const [t] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, kind),
        eq(tasks.entityType, entity.type),
        eq(tasks.entityId, entity.id),
      ),
    )
    .limit(1);
  return !!t;
}

/**
 * Job cancelled (SPEC M09 deposit policy): open requests expire (pay links revoked),
 * auth holds are released, paid deposits are either suggested for refund (cancelled in
 * time, part not ordered) or forfeited per the snapshotted policy.
 */
async function onJobCancelled(jobId: string, tx: Tx): Promise<void> {
  const [job] = await tx
    .select({
      customerId: jobs.customerId,
      windowStart: jobs.windowStart,
      scheduledStart: jobs.scheduledStart,
      cancelledAt: jobs.cancelledAt,
      number: jobs.number,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return;
  const s = await getSettings();
  const deps = await tx
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.jobId, jobId));
  for (const d of deps) {
    if ((OPEN_DEPOSIT_STATUSES as readonly string[]).includes(d.status)) {
      await tx
        .update(depositRequests)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(depositRequests.id, d.id));
      await revokePublicTokens(tx, {
        kind: "pay",
        entity: { type: "deposit_request", id: d.id },
      });
      await tx
        .update(checkoutSessions)
        .set({ status: "expired" })
        .where(
          and(
            eq(checkoutSessions.depositRequestId, d.id),
            eq(checkoutSessions.status, "open"),
          ),
        );
      continue;
    }
    if (d.status === "held") {
      await flagHolds(tx, jobId, "cancel");
      continue;
    }
    if (d.status !== "paid" && d.status !== "applied") continue;
    if (!d.paymentId) continue;
    const [p] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, d.paymentId))
      .limit(1);
    if (!p || !(PAID_STATUSES as readonly string[]).includes(p.status))
      continue;
    const refunded = (await refundedByPayment([p.id], tx)).get(p.id) ?? 0;
    const left = p.amountCents - refunded;
    if (left <= 0) continue;
    const start = job.windowStart ?? job.scheduledStart;
    const cancelledAt = job.cancelledAt ?? new Date();
    const inTime =
      !start ||
      start.getTime() - cancelledAt.getTime() >=
        s.deposits.refundable_until_hours * 3_600_000;
    const poLocked = !!d.specialOrderPoAt && s.deposits.nonrefundable_after_po;
    if (inTime && !poLocked) {
      const keep = d.specialOrderPoAt
        ? roundHalfAway((left * s.deposits.restocking_pct) / 100)
        : 0;
      const refund = left - keep;
      if (
        refund > 0 &&
        !(await hasTask(tx, "refund_due", {
          type: "deposit_request",
          id: d.id,
        }))
      )
        await createTask(
          tx,
          {
            kind: "refund_due",
            title: `Refund deposit ${formatMoney(refund)} (job ${job.number} cancelled)`,
            body:
              keep > 0
                ? `Cancelled in time. A ${s.deposits.restocking_pct}% restocking fee (${formatMoney(keep)}) is kept.`
                : "Cancelled within the refund window. Refund to the original payment method.",
            payload: { payment_id: p.id, amount_cents: refund },
            assigneeUserId: null,
            entity: { type: "deposit_request", id: d.id },
            customerId: job.customerId,
            jobId,
            dueAt: new Date(Date.now() + 2 * 86_400_000),
          },
          SYSTEM_ACTOR,
        );
    } else {
      await tx
        .update(depositRequests)
        .set({
          status: "forfeited",
          forfeitedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(depositRequests.id, d.id),
            inArray(depositRequests.status, ["paid", "applied"]),
          ),
        );
      await writeActivity(tx, {
        entity: { type: "job", id: jobId },
        customerId: job.customerId,
        jobId,
        kind: "deposit.forfeited",
        summary: `Deposit ${formatMoney(left)} kept per the deposit policy (${poLocked ? "special-order part already ordered" : "cancelled late"})`,
        data: { deposit_request_id: d.id },
        actorUserId: null,
      });
    }
  }
}

/** Invoice issued: suggest a refund when paid deposits exceed the final total (M09). */
async function onInvoiceIssued(invoiceId: string, tx: Tx): Promise<void> {
  const [inv] = await tx
    .select({
      id: invoices.id,
      jobId: invoices.jobId,
      customerId: invoices.customerId,
      total: invoices.totalCents,
      number: invoices.number,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv?.jobId) return;
  const [dep] = await tx
    .select({
      n: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.jobId, inv.jobId),
        eq(payments.kind, "deposit"),
        inArray(payments.status, ["succeeded", "partially_refunded"]),
      ),
    );
  const over = Number(dep?.n ?? 0) - Number(inv.total);
  if (over <= 0) return;
  if (await hasTask(tx, "refund_due", { type: "invoice", id: inv.id })) return;
  await createTask(
    tx,
    {
      kind: "refund_due",
      title: `Deposit exceeds invoice ${inv.number}: refund ${formatMoney(over)}`,
      body: "The deposit collected is more than the final total. Refund the difference to avoid a dispute.",
      payload: { invoice_id: inv.id, amount_cents: over },
      assigneeUserId: null,
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      dueAt: new Date(Date.now() + 2 * 86_400_000),
    },
    SYSTEM_ACTOR,
  );
}

/** Jobs that haven't started: a deposit still makes sense. */
const PRE_START = new Set(["unscheduled", "scheduled", "confirmed"]);

/**
 * T6-09: deposit rules first run at scheduling, often before the job has lines, so a
 * "total ≥ $X" rule never matched. Re-evaluate whenever the money picture changes
 * before the visit (lines via change order / invoice issue or revision, confirm,
 * reschedule). ensureDepositRequest is idempotent (an existing or waived request wins)
 * and skips jobs that are already paid. When no rule matches anymore (the line that
 * triggered it was removed), an unpaid rule-made request is canceled (QA2).
 */
async function reevaluateDeposit(
  tx: Tx,
  jobId: string | null | undefined,
): Promise<void> {
  if (!jobId) return;
  const [job] = await tx
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job || !PRE_START.has(job.status)) return;
  // QA2: a rule-made, unpaid request the job no longer qualifies for is dropped.
  if (await cancelUnneededDeposit(tx, jobId, SYSTEM_ACTOR)) return;
  await ensureDepositRequest(
    tx,
    { jobId, context: "lines_changed" },
    SYSTEM_ACTOR,
  );
}

async function jobOfInvoice(tx: Tx, invoiceId: string): Promise<string | null> {
  const [inv] = await tx
    .select({ jobId: invoices.jobId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return inv?.jobId ?? null;
}

export const handlers: HandlerReg[] = [
  {
    event: "invoice.issued",
    name: "payments.deposit_on_invoice_issued",
    async run(e, { tx }) {
      await reevaluateDeposit(
        tx,
        await jobOfInvoice(tx, e.payload.invoice_id as string),
      );
    },
  },
  {
    event: "invoice.revised",
    name: "payments.deposit_on_invoice_revised",
    async run(e, { tx }) {
      await reevaluateDeposit(
        tx,
        await jobOfInvoice(tx, e.payload.invoice_id as string),
      );
    },
  },
  {
    event: "invoice.lines_changed",
    name: "payments.deposit_on_lines_changed",
    async run(e, { tx }) {
      await reevaluateDeposit(tx, e.payload.job_id as string | null);
    },
  },
  {
    event: "change_order.approved",
    name: "payments.deposit_on_change_order",
    async run(e, { tx }) {
      await reevaluateDeposit(tx, e.payload.job_id as string);
    },
  },
  {
    event: "job.confirmed",
    name: "payments.deposit_on_confirmed",
    async run(e, { tx }) {
      await reevaluateDeposit(tx, e.payload.job_id as string);
    },
  },
  {
    event: "job.rescheduled",
    name: "payments.deposit_on_rescheduled",
    async run(e, { tx }) {
      await reevaluateDeposit(tx, e.payload.job_id as string);
    },
  },
  {
    event: "job.scheduled",
    name: "payments.deposit_on_schedule",
    async run(e, { tx }) {
      const jobId = e.payload.job_id as string;
      await ensureDepositRequest(
        tx,
        { jobId, context: "job_scheduled" },
        SYSTEM_ACTOR,
      );
    },
  },
  {
    event: "job.completed",
    name: "payments.capture_holds",
    async run(e, { tx }) {
      await flagHolds(tx, e.payload.job_id as string, "capture");
    },
  },
  {
    event: "job.cancelled",
    name: "payments.deposit_on_cancel",
    async run(e, { tx }) {
      await onJobCancelled(e.payload.job_id as string, tx);
    },
  },
  {
    event: "invoice.issued",
    name: "payments.deposit_overage",
    async run(e, { tx }) {
      await onInvoiceIssued(e.payload.invoice_id as string, tx);
    },
  },
  {
    // QA2 re-check: invoice payments (any channel: card webhook, portal, manual)
    // that cover an open, unpaid deposit request close it as satisfied and cancel
    // its queued deposit.request texts. Idempotent (open requests only).
    event: "payment.succeeded",
    name: "payments.deposit_covered_by_payments",
    async run(e, { tx }) {
      if (e.payload.kind === "tip_only" || !e.payload.invoice_id) return;
      const jobId =
        e.payload.job_id ?? (await jobOfInvoice(tx, e.payload.invoice_id));
      await settleCoveredDeposits(tx, jobId, SYSTEM_ACTOR);
    },
  },
  {
    event: "refund.succeeded",
    name: "payments.close_refund_task",
    async run(e, { tx }) {
      await closeTasksFor(
        tx,
        {
          kind: "refund_due",
          entity: { type: "refund", id: e.payload.refund_id as string },
        },
        "done",
        SYSTEM_ACTOR,
      );
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
