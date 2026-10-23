// Nav badge counters for `jobs` (BUILD_PLAN §4, Appendix D). Owner: B2.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";
import { countNeedsTech } from "./dispatch/needs-tech";
import { NEEDS_TECH_BADGE } from "./nav";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  // Needs a tech (leads flow item 9): the same count as the Assign hub's queue.
  [NEEDS_TECH_BADGE]: async (u) =>
    u.perms.has("jobs.assign") ? countNeedsTech() : 0,
};
