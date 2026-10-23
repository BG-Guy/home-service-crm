// Nav badge counters for `leads` (BUILD_PLAN §4, Appendix D). Owner: B1.

import type { BadgeKey } from "@/features/registry";
import { isEnabled } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { newLeadCount } from "./queries";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  /**
   * One count everywhere (leads-flow fix): the Leads tab/sidebar badge is the New
   * chip's number, new leads outside "Check" (queries.ts `newLeadsWhere`).
   */
  "leads.new": async (u) => {
    if (!u.perms.has("leads.view") || !(await isEnabled("leads"))) return 0;
    return newLeadCount();
  },
};
