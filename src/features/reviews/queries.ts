import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, jobs, reviewRequests, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getReviewStatsByTech } from "./api";

// Reviews read DAL (SPEC M14 stats). Techs (reviews.view without messages.view_all)
// see only their own requests and numbers; office/admin see everyone.

export interface ReviewPeriod {
  from: Date;
  to: Date;
}

export interface ReviewOverview {
  sent: number;
  clicked: number;
  rated: number;
  avgRating: number | null;
  received: number;
  distribution: number[]; // index 0 → 1 star … 4 → 5 stars
}

export interface ReviewRow {
  id: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  techName: string | null;
  sentCount: number;
  firstSentAt: string | null;
  clickedAt: string | null;
  rating: number | null;
  wantsCallback: boolean;
  feedback: string | null;
  receivedAt: string | null;
}

export interface LeaderRow {
  userId: string;
  name: string;
  sent: number;
  clicked: number;
  ratings: number;
  avgRating: number | null;
}

export async function getReviewsPage(
  period: ReviewPeriod,
  techId?: string | null,
) {
  const user = await requireUser("reviews.view");
  const own = !user.perms.has("reviews.send_manual");
  const tech = own ? user.id : (techId ?? null);
  const scope = and(
    isNotNull(reviewRequests.firstSentAt),
    gte(reviewRequests.firstSentAt, period.from),
    lt(reviewRequests.firstSentAt, period.to),
    tech ? eq(reviewRequests.techUserId, tech) : undefined,
  );
  const [agg] = await db
    .select({
      sent: sql<number>`count(*)::int`,
      clicked: sql<number>`count(${reviewRequests.clickedAt})::int`,
      rated: sql<number>`count(${reviewRequests.rating})::int`,
      avg: sql<number | null>`avg(${reviewRequests.rating})::float`,
      received: sql<number>`count(${reviewRequests.reviewReceivedAt})::int`,
      r1: sql<number>`count(*) filter (where ${reviewRequests.rating} = 1)::int`,
      r2: sql<number>`count(*) filter (where ${reviewRequests.rating} = 2)::int`,
      r3: sql<number>`count(*) filter (where ${reviewRequests.rating} = 3)::int`,
      r4: sql<number>`count(*) filter (where ${reviewRequests.rating} = 4)::int`,
      r5: sql<number>`count(*) filter (where ${reviewRequests.rating} = 5)::int`,
    })
    .from(reviewRequests)
    .where(scope);
  const rows = await db
    .select({
      id: reviewRequests.id,
      jobId: reviewRequests.jobId,
      jobNumber: jobs.number,
      customerName: customers.displayName,
      techName: users.name,
      sentCount: reviewRequests.sentCount,
      firstSentAt: reviewRequests.firstSentAt,
      clickedAt: reviewRequests.clickedAt,
      rating: reviewRequests.rating,
      wantsCallback: reviewRequests.wantsCallback,
      feedback: reviewRequests.feedback,
      receivedAt: reviewRequests.reviewReceivedAt,
    })
    .from(reviewRequests)
    .innerJoin(jobs, eq(jobs.id, reviewRequests.jobId))
    .innerJoin(customers, eq(customers.id, reviewRequests.customerId))
    .leftJoin(users, eq(users.id, reviewRequests.techUserId))
    .where(scope)
    .orderBy(desc(reviewRequests.firstSentAt))
    .limit(60);

  let leaders: LeaderRow[] = [];
  if (!own) {
    const stats = await getReviewStatsByTech(period.from, period.to);
    const ids = Object.keys(stats);
    const names = ids.length
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    leaders = ids
      .map((id) => ({
        userId: id,
        name: names.find((n) => n.id === id)?.name ?? "Former tech",
        ...(stats[id] as NonNullable<(typeof stats)[string]>),
      }))
      .sort((a, b) => b.clicked - a.clicked || b.sent - a.sent);
  }

  const overview: ReviewOverview = {
    sent: Number(agg?.sent ?? 0),
    clicked: Number(agg?.clicked ?? 0),
    rated: Number(agg?.rated ?? 0),
    avgRating: agg?.avg == null ? null : Number(agg.avg),
    received: Number(agg?.received ?? 0),
    distribution: [agg?.r1, agg?.r2, agg?.r3, agg?.r4, agg?.r5].map((n) =>
      Number(n ?? 0),
    ),
  };
  const list: ReviewRow[] = rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    customerName: r.customerName,
    techName: r.techName,
    sentCount: r.sentCount,
    firstSentAt: r.firstSentAt?.toISOString() ?? null,
    clickedAt: r.clickedAt?.toISOString() ?? null,
    rating: r.rating,
    wantsCallback: !!r.wantsCallback,
    feedback: r.feedback,
    receivedAt: r.receivedAt?.toISOString() ?? null,
  }));
  return {
    overview,
    list,
    leaders,
    own,
    canLog: user.perms.has("reviews.send_manual"),
  };
}
