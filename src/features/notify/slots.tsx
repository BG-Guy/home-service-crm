import "server-only";
import { eq } from "drizzle-orm";
import { Bell } from "lucide-react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompany } from "@/lib/settings";
import { safeTimeZone } from "@/lib/time";
import { Badge } from "@/ui/components/Badge";
import { IconButton } from "@/ui/components/IconButton";
import type { NotificationPref } from "./catalog";
import { ActivityFeed } from "./components/ActivityFeed";
import { PrefsForm } from "./components/PrefsForm";
import type {
  ActivityTimelineProps,
  NotificationPreferencesProps,
} from "./contracts";
import { unreadCount } from "./deliver";
import { canViewTimeline, fetchActivity } from "./queries";

// Server UI slots produced by B5 (BUILD_PLAN §5.1). Each takes ids, calls
// getCurrentUser() itself and returns null when the viewer may not see it.

/** S33 — Activity timeline grouped by day with filter chips (Appendix C). */
export async function ActivityTimeline({
  customerId,
  jobId,
  entity,
  filter = "all",
  showFilterChips = true,
  limit = 25,
}: ActivityTimelineProps) {
  const user = await getCurrentUser();
  if (!user) return null;
  const scope = { customerId, jobId, entity };
  if (!(await canViewTimeline(user, scope))) return null;
  const [initial, company] = await Promise.all([
    fetchActivity(user, scope, filter, { limit }),
    getCompany(),
  ]);
  return (
    <ActivityFeed
      scope={scope}
      initial={initial}
      initialFilter={filter}
      showFilterChips={showFilterChips}
      limit={limit}
      timeZone={safeTimeZone(company.timezone)}
    />
  );
}

/** S34 — Notification bell props. */
export type NotificationBellProps = { className?: string };

/** S34 — Unread count linking to /notifications. */
export async function NotificationBell({ className }: NotificationBellProps) {
  const user = await getCurrentUser();
  if (!user) return null;
  const n = await unreadCount(user.id).catch(() => 0);
  return (
    <IconButton
      href="/notifications"
      label={n > 0 ? `Notifications, ${n} unread` : "Notifications"}
      className={className}
      badge={n > 0 ? <Badge count={n} max={99} /> : undefined}
    >
      <Bell aria-hidden size={22} />
    </IconButton>
  );
}

/** S35 — Push / email / off per notification type. */
export async function NotificationPreferences({
  userId,
}: NotificationPreferencesProps) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (userId !== user.id && !user.perms.has("users.manage")) return null;
  const [u] = await db
    .select({ prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;
  return (
    <PrefsForm
      userId={userId}
      initial={(u.prefs ?? {}) as Record<string, NotificationPref>}
    />
  );
}
