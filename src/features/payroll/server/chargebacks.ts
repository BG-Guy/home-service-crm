import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  disputes,
  invoices,
  jobEarnings,
  jobs,
  ledgerEntries,
  payments,
} from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import { addDaysToKey, dateKey } from "@/lib/time";
import type { Actor } from "@/lib/types";
import {
  type ChargebackExisting,
  chargebackPostings,
  recallClawbackPostings,
} from "../engine";
import { insertPostings } from "./ledger";
import { techPlans } from "./plans";
import { companyTz, todayKey } from "./util";

export function disputePhase(status: string): "open" | "won" | "lost" | null {
  if (["won", "warning_closed"].includes(status)) return "won";
  if (["lost", "accepted"].includes(status)) return "lost";
  if (["inquiry", "needs_response", "under_review"].includes(status))
    return "open";
  return null;
}

/** Chargeback hold / release / clawback for a dispute (§10.2). Idempotent per dispute+tech. */
export async function applyDispute(
  tx: Tx,
  disputeId: string,
  actor: Actor,
): Promise<number> {
  const [d] = await tx
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);
  if (!d) return 0;
  const phase = disputePhase(d.status);
  if (!phase) return 0;
  const [p] = await tx
    .select({ jobId: payments.jobId, invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.id, d.paymentId))
    .limit(1);
  let jobId = p?.jobId ?? null;
  if (!jobId && p?.invoiceId) {
    const [inv] = await tx
      .select({ jobId: invoices.jobId })
      .from(invoices)
      .where(eq(invoices.id, p.invoiceId))
      .limit(1);
    jobId = inv?.jobId ?? null;
  }
  if (!jobId) return 0;
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return 0;
  const earnings = await tx
    .select()
    .from(jobEarnings)
    .where(eq(jobEarnings.jobId, jobId));
  if (earnings.length === 0) return 0;
  const tz = await companyTz(tx);
  const today = todayKey(tz);
  const plans = await techPlans(
    tx,
    earnings.map((e) => e.userId),
    today,
  );
  const primary = plans.get(earnings[0]?.userId ?? "");
  if (!primary) return 0;
  const plan = primary.plan;
  if (job.completedAt && phase === "open") {
    const limit = addDaysToKey(
      dateKey(job.completedAt, tz),
      plan.chargebacks.window_days,
    );
    if (dateKey(d.createdAt, tz) > limit) return 0;
  }
  const existing = await tx
    .select({
      userId: ledgerEntries.userId,
      type: ledgerEntries.type,
      amountCents: ledgerEntries.amountCents,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.refTable, "disputes"),
        eq(ledgerEntries.refId, disputeId),
        inArray(ledgerEntries.type, [
          "chargeback_hold",
          "chargeback_release",
          "chargeback_clawback",
        ]),
      ),
    );
  const postings = chargebackPostings(
    plan,
    phase,
    earnings.map((e) => ({
      userId: e.userId,
      commissionCents: e.commissionCents,
      spiffsCents: e.spiffsCents,
      workerType: plans.get(e.userId)?.workerType ?? "1099",
    })),
    existing as ChargebackExisting[],
    `job ${job.number}`,
  );
  if (postings.length === 0) return 0;
  await insertPostings(tx, postings, {
    effectiveDate: today,
    jobId,
    refTable: "disputes",
    refId: disputeId,
    actorUserId: actor.userId,
    today,
  });
  await writeActivity(tx, {
    entity: { type: "job", id: jobId },
    customerId: job.customerId,
    kind: "payroll.chargeback",
    summary:
      phase === "open"
        ? `Commission held for dispute on ${job.number}`
        : phase === "won"
          ? `Dispute won: commission hold released on ${job.number}`
          : `Dispute lost: commission adjusted on ${job.number}`,
    data: { dispute_id: disputeId, postings: postings.length },
    actorUserId: actor.userId,
  });
  return postings.length;
}

/** Recall policy clawback_pct: claw back the ORIGINAL job's commission (§10.2 step 5). */
export async function applyRecallClawback(
  tx: Tx,
  callbackJobId: string,
  originalJobId: string,
  actor: Actor,
): Promise<number> {
  const [orig] = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.id, originalJobId))
    .limit(1);
  const [cb] = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.id, callbackJobId))
    .limit(1);
  if (!orig || !cb) return 0;
  const earnings = await tx
    .select()
    .from(jobEarnings)
    .where(eq(jobEarnings.jobId, originalJobId));
  if (earnings.length === 0) return 0;
  const tz = await companyTz(tx);
  const today = todayKey(tz);
  const plans = await techPlans(
    tx,
    earnings.map((e) => e.userId),
    today,
  );
  const plan = plans.get(earnings[0]?.userId ?? "")?.plan;
  if (!plan || plan.recalls.policy !== "clawback_pct") return 0;
  if (
    orig.completedAt &&
    dateKey(cb.createdAt, tz) >
      addDaysToKey(dateKey(orig.completedAt, tz), plan.recalls.window_days)
  )
    return 0;
  const [done] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.refTable, "jobs"),
        eq(ledgerEntries.refId, callbackJobId),
        eq(ledgerEntries.type, "recall_clawback"),
      ),
    )
    .limit(1);
  if (done) return 0;
  const postings = recallClawbackPostings(
    plan,
    earnings.map((e) => ({
      userId: e.userId,
      commissionCents: e.commissionCents,
      spiffsCents: e.spiffsCents,
      workerType: plans.get(e.userId)?.workerType ?? "1099",
    })),
    `callback ${cb.number} of ${orig.number}`,
  );
  if (postings.length === 0) return 0;
  await insertPostings(tx, postings, {
    effectiveDate: today,
    jobId: originalJobId,
    refTable: "jobs",
    refId: callbackJobId,
    actorUserId: actor.userId,
    today,
  });
  return postings.length;
}
