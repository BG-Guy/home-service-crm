// Nav badge counters for `portal` (BUILD_PLAN §4, Appendix D). Owner: B3.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {};
