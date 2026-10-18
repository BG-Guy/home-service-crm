// Nav badge counters for `tasks` (BUILD_PLAN §4, Appendix D). Owner: B2.
import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import type { BadgeKey } from "@/features/registry";
import { getCompanyTimezone } from "@/lib/settings";
import { endOfDayInTz } from "@/lib/time";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  /** My open tasks due by the end of today (company TZ). */
  "tasks.due": async (u) => {
    const end = endOfDayInTz(new Date(), await getCompanyTimezone());
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeUserId, u.id),
          eq(tasks.status, "open"),
          lt(tasks.dueAt, end),
        ),
      );
    return Number(r?.n ?? 0);
  },
};
