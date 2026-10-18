// Nav badge counters for `settings` (BUILD_PLAN §4, Appendix D). Owner: B8.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {};
