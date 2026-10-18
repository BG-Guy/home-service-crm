// B2 time slots (BUILD_PLAN §5.1 S6). Returns null when the viewer may not see
// the user's time (own entries with time.clock_self; anyone's with time.manage).
import "server-only";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { TimeEntryList } from "./components/TimeEntryList";
import type { TimeEntriesSectionProps } from "./contracts";
import { canSeeTime, listTimeEntries } from "./queries";

/** S6: recent time entries for a user; editable (with a reason) for time.manage. */
export async function TimeEntriesSection({
  userId,
  days = 14,
}: TimeEntriesSectionProps) {
  const viewer = await getCurrentUser();
  if (!viewer || !canSeeTime(viewer, userId)) return null;
  const tz = await getCompanyTimezone();
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const entries = await listTimeEntries(
    userId,
    from,
    new Date(now.getTime() + 86_400_000),
    viewer,
  );
  return (
    <section aria-label="Time entries" className="flex flex-col gap-2">
      <TimeEntryList
        entries={entries}
        tz={tz}
        canManage={viewer.perms.has("time.manage")}
        userId={userId}
        showAdd
        emptyText={`No time entries in the last ${days} days.`}
      />
    </section>
  );
}
