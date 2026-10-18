import "server-only";
import { and, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { reviewRequests } from "@/db/schema";
import type { ReviewStats } from "./contracts";

// B5 reviews API (BUILD_PLAN §6.5). Per-tech stats feed B8 insights and the leaderboard.

export type * from "./contracts";

/**
 * Per-tech counts for requests first sent in [from, to): sent, clicked (attributed by
 * the /r/ click, never by asking the customer), internal ratings and their average.
 */
export async function getReviewStatsByTech(
  from: Date,
  to: Date,
): Promise<Record<string, ReviewStats>> {
  const rows = await db
    .select({
      tech: reviewRequests.techUserId,
      sent: sql<number>`count(*)::int`,
      clicked: sql<number>`count(${reviewRequests.clickedAt})::int`,
      ratings: sql<number>`count(${reviewRequests.rating})::int`,
      avg: sql<number | null>`avg(${reviewRequests.rating})::float`,
    })
    .from(reviewRequests)
    .where(
      and(
        isNotNull(reviewRequests.techUserId),
        gte(reviewRequests.firstSentAt, from),
        lt(reviewRequests.firstSentAt, to),
      ),
    )
    .groupBy(reviewRequests.techUserId);
  const out: Record<string, ReviewStats> = {};
  for (const r of rows) {
    if (r.tech)
      out[r.tech] = {
        sent: Number(r.sent),
        clicked: Number(r.clicked),
        ratings: Number(r.ratings),
        avgRating: r.avg === null ? null : Number(r.avg),
      };
  }
  return out;
}
