// Nav badge counters for `notify` (BUILD_PLAN §4, Appendix D). Owner: B5.
import type { BadgeKey } from "@/features/registry";
import type { SessionUser } from "@/lib/types";
import { unreadCount } from "./deliver";

export const badges: Partial<
  Record<BadgeKey, (u: SessionUser) => Promise<number>>
> = {
  /** Unread notifications (the bell). */
  "notifications.unread": (u) => unreadCount(u.id),
};
