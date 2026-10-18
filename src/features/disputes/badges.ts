// Nav badge counters for `disputes` (BUILD_PLAN §4, Appendix D). Owner: B4.
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { disputes } from "@/db/schema";
import type { BadgeKey } from "@/features/registry";
import { isEnabled } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  /** Disputes that need a response (critical: red badge in the shell). */
  "disputes.open": async (u) => {
    if (!u.perms.has("disputes.view")) return 0;
    if (!(await isEnabled("chargeback_protection"))) return 0;
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(disputes)
      .where(inArray(disputes.status, ["needs_response", "inquiry"]));
    return Number(r?.n ?? 0);
  },
};
