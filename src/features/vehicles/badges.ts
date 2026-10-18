// Nav badge counters for `vehicles` (BUILD_PLAN §4, Appendix D). Owner: B7.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {};
