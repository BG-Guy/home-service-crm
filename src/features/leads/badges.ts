// Nav badge counters for `leads` (BUILD_PLAN §4, Appendix D). Owner: B1.
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import type { BadgeKey } from "@/features/registry";
import { getSettings, isEnabled } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  /** Leads `new`, not spam/"Check", unclaimed or mine. */
  "leads.new": async (u) => {
    if (!u.perms.has("leads.view") || !(await isEnabled("leads"))) return 0;
    const s = await getSettings();
    const [r] = await execRows<{ n: number }>(sql`
      select count(*)::int as n from leads
      where status = 'new' and spam_score < ${s.leads.spam_review_threshold}
        and (assigned_user_id is null or assigned_user_id = ${u.id})`);
    return Number(r?.n ?? 0);
  },
};
