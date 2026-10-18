// Nav badge counters for `messaging` (BUILD_PLAN §4, Appendix D). Owner: B5.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";
import { getOutboxCount } from "./api";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  /** Outbox cards waiting for me (plus the office pool when I work the shared outbox). */
  "messages.outbox": async (u) =>
    u.perms.has("messages.send") ? getOutboxCount(u.id, "mine") : 0,
};
