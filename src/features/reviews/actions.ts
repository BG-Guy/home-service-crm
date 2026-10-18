"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { automations, jobs, reviewRequests } from "@/db/schema";
import { kickSender } from "@/features/messaging/sender";
import { action } from "@/lib/action";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isEnabled, updateSettings } from "@/lib/settings";
import { checkReviewEligibility, REVIEW_REASON_LABELS } from "./eligibility";
import { lintReviewTemplate } from "./lint";
import { logReviewReceived, queueManualReview } from "./service";

// Review mutations (SPEC M14). Manual asks: office/admin only (never techs on site),
// at most two asks per job, same eligibility as the automation.

const id = z.string().uuid();

/** S37 state: visible? eligible? (resolves customerId → latest completed job). */
export const reviewButtonState = action({
  name: "reviews.button_state",
  input: z.object({ jobId: id.optional(), customerId: id.optional() }),
  async run({ input, user, tx }) {
    const hidden = { visible: false as const };
    if (
      user.baseRole === "tech" ||
      !user.perms.has("reviews.send_manual") ||
      !(await isEnabled("reviews"))
    )
      return hidden;
    let jobId = input.jobId ?? null;
    if (!jobId && input.customerId) {
      const [j] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.customerId, input.customerId),
            inArray(jobs.status, ["completed", "closed"]),
          ),
        )
        .orderBy(desc(jobs.completedAt))
        .limit(1);
      jobId = j?.id ?? null;
    }
    if (!jobId)
      return {
        visible: true as const,
        jobId: null,
        eligible: false,
        reason: "No completed job yet.",
        sentCount: 0,
      };
    const e = await checkReviewEligibility(tx, jobId, { manual: true });
    return {
      visible: true as const,
      jobId,
      eligible: e.ok,
      reason: e.ok ? null : (REVIEW_REASON_LABELS[e.reason] ?? e.reason),
      sentCount: e.sentCount ?? 0,
    };
  },
});

export const requestReview = action({
  name: "reviews.request_manual",
  perm: "reviews.send_manual",
  feature: "reviews",
  input: z.object({ jobId: id }),
  audit: "review.requested_manual",
  async run({ input, user, tx, actor }) {
    if (user.baseRole === "tech")
      throw new ForbiddenError("Review requests are sent by the office.");
    const [job] = await tx
      .select({ id: jobs.id, customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .limit(1);
    if (!job) throw new NotFoundError("Job");
    const e = await checkReviewEligibility(tx, job.id, { manual: true });
    if (!e.ok)
      throw new ValidationError({
        _: [
          REVIEW_REASON_LABELS[e.reason] ??
            "Not eligible for a review request.",
        ],
      });
    const res = await queueManualReview(
      tx,
      { jobId: job.id, customerId: job.customerId, sentCount: e.sentCount },
      actor,
    );
    if (res.status === "scheduled") kickSender();
    return { ...res, customerId: job.customerId };
  },
  auditEntity: ({ input }) => ({ type: "job", id: input.jobId }),
  revalidate: ({ input, data }) => [
    `/jobs/${input.jobId}`,
    `/customers/${data.customerId}`,
    "/messages/outbox",
    "/reviews",
  ],
});

export const markReviewReceived = action({
  name: "reviews.received",
  perm: "reviews.send_manual",
  feature: "reviews",
  input: z.object({ reviewRequestId: id }),
  audit: "review.received_logged",
  async run({ input, tx, actor }) {
    const [rr] = await tx
      .select({ id: reviewRequests.id })
      .from(reviewRequests)
      .where(eq(reviewRequests.id, input.reviewRequestId))
      .limit(1);
    if (!rr) throw new NotFoundError("Review request");
    return logReviewReceived(tx, rr.id, actor);
  },
  auditEntity: ({ input }) => ({
    type: "review_request",
    id: input.reviewRequestId,
  }),
  revalidate: () => ["/reviews"],
});

const GOOGLE_HOSTS =
  /^(g\.page|search\.google\.com|www\.google\.com|google\.com|maps\.app\.goo\.gl|g\.co)$/i;

export const saveReviewSettings = action({
  name: "settings.reviews",
  perm: "settings.manage",
  input: z.object({
    google_url: z
      .string()
      .trim()
      .max(500)
      .transform((v) => v || null)
      .nullable(),
    min_days_between: z.coerce.number().int().min(0).max(3650),
    delay_minutes: z.coerce.number().int().min(60).max(120),
    reminder_enabled: z.boolean(),
    internal_rating_page: z.boolean(),
    consent_basis: z.enum(["transactional", "marketing"]),
    skip_no_charge_callbacks: z.boolean(),
    max_days_after_completion: z.coerce
      .number()
      .int()
      .min(1, "At least 1 day.")
      .max(365, "At most 365 days.")
      .optional(),
  }),
  audit: "settings.reviews",
  async run({ input, tx, actor }) {
    if (input.google_url) {
      let host = "";
      try {
        const u = new URL(input.google_url);
        if (u.protocol !== "https:") throw new Error("https");
        host = u.hostname;
      } catch {
        throw new ValidationError({
          google_url: ["Paste the full https:// link from Google."],
        });
      }
      if (/yelp\./i.test(host))
        throw new ValidationError({
          google_url: [
            "Yelp forbids asking for reviews. Use your Google link.",
          ],
        });
      if (!GOOGLE_HOSTS.test(host))
        throw new ValidationError({
          google_url: [
            "Use your Google Business Profile review link (g.page/r/… or search.google.com).",
          ],
        });
    }
    await updateSettings(tx, { reviews: input }, actor);
    // Keep the built-in automation's first step in sync with the chosen delay.
    const [auto] = await tx
      .select({ id: automations.id, steps: automations.steps })
      .from(automations)
      .where(eq(automations.key, "review_request"))
      .limit(1);
    if (auto && Array.isArray(auto.steps) && auto.steps[0]) {
      const steps = [...auto.steps];
      steps[0] = {
        ...steps[0],
        delay: { minutes: input.delay_minutes },
      } as (typeof steps)[number];
      await tx
        .update(automations)
        .set({ steps, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(automations.id, auto.id));
    }
    return { ok: true };
  },
  revalidate: () => ["/settings/reviews"],
});

/** Live lint for review-purpose template text (editor helper). */
export const lintReviewText = action({
  name: "reviews.lint",
  perm: "templates.manage",
  input: z.object({ text: z.string().max(2000) }),
  async run({ input }) {
    return lintReviewTemplate(input.text, "review");
  },
});
