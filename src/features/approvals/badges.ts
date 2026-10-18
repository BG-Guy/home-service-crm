// Nav badge counters for `approvals` (BUILD_PLAN §4, Appendix D). Owner: B6.
import "server-only";
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";
import { countPendingApprovals } from "./api";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  "approvals.pending": (u) => countPendingApprovals(u),
};
