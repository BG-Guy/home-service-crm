// Event handlers for `disputes` (BUILD_PLAN §4, §7). Owner: B4.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'disputes.<what>'. Slow work → enqueueJob().
//
// Risk (§11.1) is recomputed on estimate / change-order / draft-invoice line / payment /
// schedule / customer changes; readiness (§11.2) on arrival, completion, photos, signatures, messages and
// payments. Both are pure engines + an idempotent persist (no-op when unchanged).
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { depositRequests, estimates, jobs, reviewRequests } from "@/db/schema";
import type { DomainEvent, HandlerReg, IgnoreReg } from "@/lib/events";
import { isEnabled } from "@/lib/settings";
import { computeJobRisk, computeReadiness } from "./api";

type Trigger =
  | "estimate_changed"
  | "payer_changed"
  | "payment_method"
  | "schedule"
  | "manual";

const CLOSED = ["completed", "closed", "cancelled"];

async function on(): Promise<boolean> {
  return isEnabled("chargeback_protection");
}

async function jobOfEstimate(tx: Tx, estimateId: string) {
  const [e] = await tx
    .select({ jobId: estimates.jobId })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  return e?.jobId ?? null;
}

async function jobIdOf(
  // biome-ignore lint/suspicious/noExplicitAny: generic event payloads
  e: DomainEvent<any>,
  tx: Tx,
): Promise<string | null> {
  const p = e.payload as Record<string, unknown>;
  if (typeof p.job_id === "string") return p.job_id;
  if (typeof p.estimate_id === "string")
    return jobOfEstimate(tx, p.estimate_id);
  if (typeof p.deposit_request_id === "string") {
    const [d] = await tx
      .select({ jobId: depositRequests.jobId })
      .from(depositRequests)
      .where(eq(depositRequests.id, p.deposit_request_id))
      .limit(1);
    return d?.jobId ?? null;
  }
  return null;
}

function riskOn(
  event: HandlerReg["event"],
  trigger: Trigger,
  name: string,
): HandlerReg {
  return {
    event,
    name: `disputes.risk_${name}`,
    async run(e, { tx }) {
      if (!(await on())) return;
      const jobId = await jobIdOf(e, tx);
      if (jobId) await computeJobRisk(tx, jobId, trigger);
    },
  };
}

function readinessOn(event: HandlerReg["event"], name: string): HandlerReg {
  return {
    event,
    name: `disputes.readiness_${name}`,
    async run(e, { tx }) {
      if (!(await on())) return;
      const jobId = await jobIdOf(e, tx);
      if (jobId) await computeReadiness(tx, jobId);
    },
  };
}

export const handlers: HandlerReg[] = [
  // ---- risk (§11.1)
  riskOn("job.created", "schedule", "job_created"),
  riskOn("job.scheduled", "schedule", "job_scheduled"),
  riskOn("job.rescheduled", "schedule", "job_rescheduled"),
  riskOn("estimate.sent", "estimate_changed", "estimate_sent"),
  riskOn("estimate.approved", "estimate_changed", "estimate_approved"),
  riskOn("change_order.approved", "estimate_changed", "change_order"),
  // A draft invoice line added, edited or removed moves the ticket (QA2 re-check:
  // removing the part that made J-1071 Medium left it Medium). Up or down.
  riskOn("invoice.lines_changed", "estimate_changed", "lines_changed"),
  riskOn("payment.succeeded", "payment_method", "payment"),
  riskOn("deposit.paid", "payment_method", "deposit_paid"),
  riskOn("signature.captured", "estimate_changed", "signature"),
  {
    event: "customer.updated",
    name: "disputes.risk_customer_updated",
    async run(e, { tx }) {
      if (!(await on())) return;
      const rows = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.customerId, e.payload.customer_id as string),
            notInArray(jobs.status, CLOSED),
          ),
        )
        .limit(50);
      for (const r of rows) await computeJobRisk(tx, r.id, "payer_changed");
    },
  },
  {
    event: "review.rated",
    name: "disputes.risk_complaint",
    async run(e, { tx }) {
      if (!(await on())) return;
      if (Number(e.payload.rating) > 2) return;
      const [rr] = await tx
        .select({
          jobId: reviewRequests.jobId,
          customerId: reviewRequests.customerId,
        })
        .from(reviewRequests)
        .where(eq(reviewRequests.id, e.payload.review_request_id as string))
        .limit(1);
      if (!rr) return;
      // The complaint raises risk on the customer's open and upcoming jobs.
      const rows = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.customerId, rr.customerId),
            inArray(jobs.status, [
              "unscheduled",
              "scheduled",
              "confirmed",
              "en_route",
              "arrived",
              "in_progress",
              "on_hold",
            ]),
          ),
        )
        .limit(20);
      for (const r of rows) await computeJobRisk(tx, r.id, "payer_changed");
    },
  },
  // ---- readiness (§11.2)
  readinessOn("job.arrived", "arrived"),
  readinessOn("job.completed", "completed"),
  readinessOn("photo.uploaded", "photo"),
  readinessOn("signature.captured", "signature"),
  readinessOn("message.sent", "message"),
  readinessOn("change_order.approved", "change_order"),
  readinessOn("payment.succeeded", "payment"),
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
