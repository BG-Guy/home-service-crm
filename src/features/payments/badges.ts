// Nav badge counters for `payments` (BUILD_PLAN §4, Appendix D). Owner: B4.
// Appendix D assigns payments no badge; the unverified-manual count shows on /payments.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {};
