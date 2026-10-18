import "server-only";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  customers,
  disputes,
  invoices,
  jobs,
  payments,
  reviewRequests,
} from "@/db/schema";
import { getSettings, isEnabled } from "@/lib/settings";

// Review-request eligibility (SPEC M14). Checked when a request is scheduled, again at
// send time (sender), and by the manual "Request review" button. Sentiment never
// matters here: who gets asked depends only on these facts.
//   - job completed (or closed) AND paid — closing a job is not payment (QA T6-06);
//     an explicit no-charge invoice ($0, issued) counts as settled; else wait for payment
//   - never while the job's payment is disputed or has a chargeback on file (T6-06)
//   - automated asks only for jobs completed within `max_days_after_completion` days
//     (a settlement lock closing a months-old job must not ask for a review)
//   - at most two asks per job (request + one reminder; manual sends count)
//   - not asked in the last `min_days_between` days for another job
//   - not opted out / do_not_contact / test customer
//   - not a no-charge callback (configurable)

export type ReviewEligibility =
  | { ok: true; sentCount: number }
  | { ok: false; reason: string; wait?: boolean; sentCount?: number };

export const REVIEW_REASON_LABELS: Record<string, string> = {
  reviews_off: "Review requests are turned off.",
  reminder_off: "Review reminders are turned off.",
  no_job: "Job not found.",
  not_completed: "The job isn't completed yet.",
  awaiting_payment: "Waits until the invoice is paid.",
  disputed: "The customer disputed a payment for this job.",
  too_old: "The job was finished too long ago to ask.",
  max_asks: "Already asked twice for this job.",
  asked_recently: "This customer was asked recently.",
  already_clicked: "The customer already opened the review link.",
  do_not_contact: "Customer is marked do-not-contact.",
  test_customer: "Test customer.",
  opted_out: "Customer opted out of texts and has no email.",
  no_charge_callback: "No-charge callback visit.",
  no_contact: "No phone or email on file.",
};

export async function checkReviewEligibility(
  exec: Tx = db,
  jobId: string,
  opts: {
    now?: Date;
    channel?: string;
    manual?: boolean;
    templateKey?: string;
  } = {},
): Promise<ReviewEligibility> {
  const now = opts.now ?? new Date();
  if (!(await isEnabled("reviews")))
    return { ok: false, reason: "reviews_off" };
  const settings = await getSettings();
  if (
    opts.templateKey === "review.reminder" &&
    !settings.reviews.reminder_enabled
  )
    return { ok: false, reason: "reminder_off" };
  const [job] = await exec
    .select({
      id: jobs.id,
      status: jobs.status,
      paymentStatus: jobs.paymentStatus,
      isCallback: jobs.isCallback,
      customerId: jobs.customerId,
      completedAt: jobs.completedAt,
      closedAt: jobs.closedAt,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { ok: false, reason: "no_job" };
  const [rr] = await exec
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.jobId, jobId))
    .limit(1);
  const sentCount = rr?.sentCount ?? 0;
  if (!["completed", "closed"].includes(job.status))
    return { ok: false, reason: "not_completed", sentCount };
  if (sentCount >= 2) return { ok: false, reason: "max_asks", sentCount };
  // A disputed charge (open, won or lost) is never followed by a review ask.
  if (job.paymentStatus === "disputed" || (await hasDispute(exec, jobId)))
    return { ok: false, reason: "disputed", sentCount };
  // Recent work only (automated asks; a person asking by hand decides for themselves).
  const finishedAt = job.completedAt ?? job.closedAt;
  if (
    !opts.manual &&
    finishedAt &&
    now.getTime() - finishedAt.getTime() >
      settings.reviews.max_days_after_completion * 86_400_000
  )
    return { ok: false, reason: "too_old", sentCount };
  if (rr?.clickedAt && !opts.manual)
    return { ok: false, reason: "already_clicked", sentCount };

  const [c] = await exec
    .select({
      doNotContact: customers.doNotContact,
      isTest: customers.isTest,
      smsStatus: customers.smsStatus,
      doNotText: customers.doNotText,
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(customers.id, job.customerId))
    .limit(1);
  if (!c) return { ok: false, reason: "no_contact", sentCount };
  if (c.doNotContact) return { ok: false, reason: "do_not_contact", sentCount };
  if (c.isTest) return { ok: false, reason: "test_customer", sentCount };
  const canText = !!c.phone && c.smsStatus !== "opted_out" && !c.doNotText;
  if (!canText && !c.email)
    return {
      ok: false,
      reason: c.phone ? "opted_out" : "no_contact",
      sentCount,
    };

  // No-charge callback (configurable): a callback whose invoice is $0 or missing.
  if (job.isCallback && settings.reviews.skip_no_charge_callbacks) {
    const [inv] = await exec
      .select({ total: invoices.totalCents })
      .from(invoices)
      .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    if (!inv || inv.total === 0)
      return { ok: false, reason: "no_charge_callback", sentCount };
  }

  // Closed ≠ paid: a settlement lock closes unpaid jobs too.
  const paid =
    job.paymentStatus === "paid" || (await invoiceSettled(exec, jobId));
  if (!paid)
    return { ok: false, reason: "awaiting_payment", wait: true, sentCount };

  // First ask only: not asked for another job within min_days_between.
  if (sentCount === 0) {
    const since = new Date(
      now.getTime() - settings.reviews.min_days_between * 86_400_000,
    );
    const [recent] = await exec
      .select({ id: reviewRequests.id })
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.customerId, job.customerId),
          ne(reviewRequests.jobId, jobId),
          gt(reviewRequests.lastSentAt, since),
        ),
      )
      .limit(1);
    if (recent) return { ok: false, reason: "asked_recently", sentCount };
  }
  return { ok: true, sentCount };
}

/** Any dispute on a payment of this job (whatever its status). */
async function hasDispute(exec: Tx, jobId: string): Promise<boolean> {
  const [d] = await exec
    .select({ id: disputes.id })
    .from(disputes)
    .innerJoin(payments, eq(payments.id, disputes.paymentId))
    .where(eq(payments.jobId, jobId))
    .limit(1);
  return !!d;
}

/**
 * The job's latest invoice is paid, or an issued $0 invoice (nothing to pay). Covers a
 * lagging `jobs.payment_status` cache; a draft or open invoice is not settled.
 */
async function invoiceSettled(exec: Tx, jobId: string): Promise<boolean> {
  const [inv] = await exec
    .select({ total: invoices.totalCents, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  if (!inv) return false;
  return inv.status === "paid" || (inv.total === 0 && inv.status !== "draft");
}
