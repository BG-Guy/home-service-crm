import "server-only";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  automations,
  jobs,
  reviewRequests,
  scheduledMessages,
  tasks,
} from "@/db/schema";
import { enqueueCore } from "@/features/messaging/enqueue";
import { createTask } from "@/features/tasks/api";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import type { PublicTokenRow } from "@/lib/tokens";
import { type Actor, SYSTEM_ACTOR } from "@/lib/types";
import { checkReviewEligibility } from "./eligibility";

// Review requests (SPEC M14). Sentiment-neutral by construction: who gets asked depends
// only on eligibility (eligibility.ts), never on a rating. Every rating sees the
// Google button; ≤ 3 additionally sees the "owner call" offer.

type RR = typeof reviewRequests.$inferSelect;

async function requestForToken(
  tx: Tx,
  tok: PublicTokenRow,
): Promise<RR | null> {
  const jobId = tok.jobId ?? (tok.entityType === "job" ? tok.entityId : null);
  if (!jobId) return null;
  const [rr] = await tx
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.jobId, jobId))
    .limit(1);
  return rr ?? null;
}

/** Log a click on /r/<token> (first click emits review.clicked → cancels reminders). */
export async function recordReviewClick(
  tx: Tx,
  tok: PublicTokenRow,
  at: Date = new Date(),
): Promise<RR | null> {
  const rr = await requestForToken(tx, tok);
  if (!rr) return null;
  const first = !rr.clickedAt;
  const [updated] = await tx
    .update(reviewRequests)
    .set({
      clickCount: sql`${reviewRequests.clickCount} + 1`,
      clickedAt: rr.clickedAt ?? at,
    })
    .where(eq(reviewRequests.id, rr.id))
    .returning();
  if (first) {
    const actor: Actor = {
      kind: "public_token",
      userId: null,
      tokenId: tok.id,
    };
    await emit(
      tx,
      "review.clicked",
      { type: "review_request", id: rr.id },
      { review_request_id: rr.id, actor_user_id: null },
      { actor },
    );
    await writeActivity(tx, {
      entity: { type: "job", id: rr.jobId },
      customerId: rr.customerId,
      jobId: rr.jobId,
      kind: "review.clicked",
      summary: "Customer opened the review link",
      actorUserId: null,
    });
  }
  return updated ?? rr;
}

/** Internal 1–5 rating (first answer wins; feedback/callback may be added later). */
export async function recordReviewRating(
  tx: Tx,
  tok: PublicTokenRow,
  input: { rating: number; feedback?: string | null; wantsCallback?: boolean },
): Promise<{ ok: boolean; rating: number | null }> {
  const rr = await requestForToken(tx, tok);
  if (!rr) return { ok: false, rating: null };
  const firstRating = rr.rating === null;
  const rating = firstRating ? input.rating : (rr.rating as number);
  await tx
    .update(reviewRequests)
    .set({
      rating,
      feedback: input.feedback?.trim()
        ? input.feedback.trim().slice(0, 2000)
        : rr.feedback,
      wantsCallback:
        rating <= 3
          ? (input.wantsCallback ?? rr.wantsCallback ?? false)
          : false,
    })
    .where(eq(reviewRequests.id, rr.id));
  if (firstRating) {
    const actor: Actor = {
      kind: "public_token",
      userId: null,
      tokenId: tok.id,
    };
    await emit(
      tx,
      "review.rated",
      { type: "review_request", id: rr.id },
      { review_request_id: rr.id, rating, actor_user_id: null },
      { actor },
    );
    await writeActivity(tx, {
      entity: { type: "job", id: rr.jobId },
      customerId: rr.customerId,
      jobId: rr.jobId,
      kind: "review.rated",
      summary: `Customer rated the visit ${rating} of 5`,
      data: { rating },
      actorUserId: null,
    });
  }
  // Asked for a call after already rating: the rated handler has run → task now.
  if (!firstRating && input.wantsCallback && rating <= 3 && !rr.wantsCallback)
    await ensureCallbackTask(tx, rr.id);
  return { ok: true, rating };
}

/** review.rated handler: a low rating that asked for a call → office callback task. */
export async function ensureCallbackTask(
  tx: Tx,
  reviewRequestId: string,
): Promise<string | null> {
  const [rr] = await tx
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.id, reviewRequestId))
    .limit(1);
  if (!rr || !rr.wantsCallback || (rr.rating ?? 5) > 3) return null;
  const [existing] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, "callback_customer"),
        eq(tasks.entityType, "review_request"),
        eq(tasks.entityId, rr.id),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const { taskId } = await createTask(
    tx,
    {
      kind: "callback_customer",
      title: `Call back: rated ${rr.rating}/5`,
      body: rr.feedback ?? null,
      assigneeUserId: null,
      entity: { type: "review_request", id: rr.id },
      customerId: rr.customerId,
      jobId: rr.jobId,
      dueAt: new Date(Date.now() + 4 * 3600_000),
    },
    SYSTEM_ACTOR,
  );
  return taskId;
}

/**
 * invoice.paid / job.closed: the job's review request waited for payment (SPEC §7.3
 * "else waits for invoice.paid + 60 min"). Schedules it once, through the built-in
 * automation (so disabling it, eligibility and caps all still apply at send time).
 */
export async function scheduleReviewAfterPayment(
  tx: Tx,
  jobId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [auto] = await tx
    .select()
    .from(automations)
    .where(eq(automations.key, "review_request"))
    .limit(1);
  if (!auto?.enabled) return false;
  const [job] = await tx
    .select({
      id: jobs.id,
      status: jobs.status,
      customerId: jobs.customerId,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job || !["completed", "closed"].includes(job.status)) return false;
  const [rr] = await tx
    .select({ sent: reviewRequests.sentCount })
    .from(reviewRequests)
    .where(eq(reviewRequests.jobId, jobId))
    .limit(1);
  if ((rr?.sent ?? 0) > 0) return false;
  // Never queue an ask the sender would refuse anyway: disputed, too old, unpaid,
  // opted out… (a job closed by a settlement lock months later, QA T6-06). An unpaid
  // job is asked when invoice.paid calls this again (the invoice is paid by then).
  const elig = await checkReviewEligibility(tx, jobId, { now });
  if (!elig.ok) return false;
  // Already queued (the completion send is still waiting, or a previous paid event).
  const [open] = await tx
    .select({ id: scheduledMessages.id })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.jobId, jobId),
        eq(scheduledMessages.templateKey, "review.request"),
        inArray(scheduledMessages.status, [
          "scheduled",
          "deferred_quiet",
          "pending_tap",
        ]),
      ),
    )
    .limit(1);
  if (open) return false;
  const [already] = await tx
    .select({ id: scheduledMessages.id })
    .from(scheduledMessages)
    .where(
      like(scheduledMessages.dedupeKey, `auto:review_request:${jobId}:paid%`),
    )
    .limit(1);
  if (already) return false;
  await enqueueCore(
    tx,
    {
      templateKey: "review.request",
      channel: "customer_preferred",
      audience: { type: "customer", customerId: job.customerId },
      entity: { type: "job", id: jobId },
      jobId,
      sendAt: new Date(now.getTime() + 60 * 60_000),
      dedupeKey: `auto:review_request:${jobId}:paid`,
      automationId: auto.id,
      stepIndex: 0,
    },
    SYSTEM_ACTOR,
    now,
  );
  return true;
}

/** Manual "Request review" (S37): queue a review ask through enqueueMessage rules. */
export async function queueManualReview(
  tx: Tx,
  input: { jobId: string; customerId: string; sentCount: number },
  actor: Actor,
): Promise<{ scheduledMessageId: string; status: string }> {
  // Channel + consent basis (settings.reviews.consent_basis) resolve at send time.
  return enqueueCore(
    tx,
    {
      templateKey: "review.request",
      channel: "customer_preferred",
      purpose: "review",
      audience: { type: "customer", customerId: input.customerId },
      entity: { type: "job", id: input.jobId },
      jobId: input.jobId,
      dedupeKey: `manual_review:${input.jobId}:${input.sentCount + 1}`,
      outboxAssigneeUserId: actor.userId,
    },
    actor,
  );
}

/** Manual "review received" log for bonuses (⚖️ never conditioned on sentiment). */
export async function logReviewReceived(
  tx: Tx,
  reviewRequestId: string,
  actor: Actor,
): Promise<{ logged: boolean }> {
  const [rr] = await tx
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.id, reviewRequestId))
    .limit(1);
  if (!rr || rr.reviewReceivedAt) return { logged: false };
  await tx
    .update(reviewRequests)
    .set({ reviewReceivedAt: new Date() })
    .where(eq(reviewRequests.id, rr.id));
  if (rr.techUserId)
    await emit(
      tx,
      "review.received_logged",
      { type: "review_request", id: rr.id },
      {
        review_request_id: rr.id,
        job_id: rr.jobId,
        tech_user_id: rr.techUserId,
      },
      { actor },
    );
  await writeActivity(tx, {
    entity: { type: "job", id: rr.jobId },
    customerId: rr.customerId,
    jobId: rr.jobId,
    kind: "review.received_logged",
    summary: "Google review received (logged)",
    actorUserId: actor.userId,
  });
  return { logged: true };
}
