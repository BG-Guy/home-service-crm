// Demo seed fragment for `reviews` (BUILD_PLAN §10.3 #15). Owner: B5.
// review_requests for 30 paid jobs (odd J1…J59): 18 clicked, internal ratings 5, 5, 4
// and 2 (the 2 asked for a call → callback_customer task), 8 logged Google reviews.
// Writes only B5 tables (+ F tokens/activity, B2 createTask); never emits events.
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { jobs, reviewRequests, tasks } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createTask } from "@/features/tasks/api";
import { writeActivity } from "@/lib/activity";
import { mintPublicToken } from "@/lib/tokens";
import { SYSTEM_ACTOR } from "@/lib/types";

const HOUR = 3600_000;
export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  // Internal feedback on the rated jobs (J1, J5, J7) comes from the trade profile.
  const FEEDBACK = ctx.profile.reviews.feedback;
  const wanted = plan.jobs.filter((j) => j.review?.requested);
  if (wanted.length === 0) return;
  const rows = await db
    .select({
      id: jobs.id,
      customerId: jobs.customerId,
      completedAt: jobs.completedAt,
      windowEnd: jobs.windowEnd,
    })
    .from(jobs)
    .where(
      inArray(
        jobs.id,
        wanted.map((j) => j.id),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  let n = 0;
  for (const pj of wanted) {
    const r = byId.get(pj.id);
    const rv = pj.review;
    if (!r || !rv) continue;
    const done =
      r.completedAt ??
      r.windowEnd ??
      new Date(ctx.now.getTime() - 3 * 24 * HOUR);
    const firstSent = new Date(done.getTime() + 1.5 * HOUR);
    const ageDays = (ctx.now.getTime() - firstSent.getTime()) / (24 * HOUR);
    const reminded = !rv.clicked && ageDays > 3;
    const lastSent = reminded
      ? new Date(firstSent.getTime() + 3 * 24 * HOUR)
      : firstSent;
    const clickedAt = rv.clicked
      ? new Date(firstSent.getTime() + (1 + ((pj.n * 7) % 20)) * HOUR)
      : null;
    const techId = pj.tech
      ? (plan.users.find((u) => u.key === pj.tech)?.id ?? null)
      : null;
    const token = await mintPublicToken(db, {
      kind: "review",
      entity: { type: "job", id: r.id },
      customerId: r.customerId,
      jobId: r.id,
    });
    const inserted = await db
      .insert(reviewRequests)
      .values({
        id: seedId("review_request", pj.n),
        jobId: r.id,
        customerId: r.customerId,
        techUserId: techId,
        tokenId: token.tokenId,
        sentCount: reminded ? 2 : 1,
        firstSentAt: firstSent,
        lastSentAt: lastSent,
        clickedAt,
        clickCount: rv.clicked ? 1 + (pj.n % 2) : 0,
        rating: rv.rating,
        feedback: FEEDBACK[pj.n] ?? null,
        wantsCallback: rv.rating !== null ? rv.wantsCallback : null,
        reviewReceivedAt:
          rv.clicked && pj.n <= 15 && clickedAt
            ? new Date(clickedAt.getTime() + 2 * HOUR)
            : null,
        createdAt: firstSent,
      })
      .onConflictDoNothing()
      .returning({ id: reviewRequests.id });
    if (inserted.length === 0) continue;
    n++;
    const rrId = inserted[0]?.id as string;
    await writeActivity(db, {
      entity: { type: "job", id: r.id },
      customerId: r.customerId,
      jobId: r.id,
      kind: "review.requested",
      summary: "Review requested",
      actorUserId: null,
    });
    if (clickedAt)
      await writeActivity(db, {
        entity: { type: "job", id: r.id },
        customerId: r.customerId,
        jobId: r.id,
        kind: "review.clicked",
        summary: "Customer opened the review link",
        actorUserId: null,
      });
    if (rv.rating !== null)
      await writeActivity(db, {
        entity: { type: "job", id: r.id },
        customerId: r.customerId,
        jobId: r.id,
        kind: "review.rated",
        summary: `Customer rated the visit ${rv.rating} of 5`,
        data: { rating: rv.rating },
        actorUserId: null,
      });
    if (rv.wantsCallback && (rv.rating ?? 5) <= 3) {
      const [existing] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.kind, "callback_customer"),
            eq(tasks.entityType, "review_request"),
            eq(tasks.entityId, rrId),
          ),
        )
        .limit(1);
      if (!existing)
        await createTask(
          db,
          {
            kind: "callback_customer",
            title: `Call back: rated ${rv.rating}/5`,
            body: FEEDBACK[pj.n] ?? null,
            assigneeUserId: null,
            entity: { type: "review_request", id: rrId },
            customerId: r.customerId,
            jobId: r.id,
            dueAt: new Date(ctx.now.getTime() + 4 * HOUR),
          },
          SYSTEM_ACTOR,
          { quiet: true },
        );
    }
  }
  ctx.log(`review requests ${n}`);
}
