import "server-only";
import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { ClipboardCheck, PackageCheck, Wrench } from "lucide-react";
import { db } from "@/db";
import { toolAssignments, tools, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey, formatDateKey } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import { getToolAuditStatuses } from "./api";
import type { TodayToolCardProps, ToolCustodyRowProps } from "./contracts";
import { openAuditFor } from "./engine";
import { dueState } from "./rules";

// Server UI slots produced by B7 (BUILD_PLAN §5.1). They check the viewer, the
// `tools` flag and the tech's `uses_company_tools`, and return null otherwise.

async function viewerFor(userId: string): Promise<SessionUser | null> {
  const viewer = await getCurrentUser();
  if (!viewer || !(await isEnabled("tools"))) return null;
  if (viewer.perms.has("tools.view_all")) return viewer;
  if (viewer.id === userId && viewer.perms.has("tools.view_own")) return viewer;
  return null;
}

async function usesTools(userId: string): Promise<boolean> {
  const [u] = await db
    .select({ uses: users.usesCompanyTools })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!u?.uses;
}

const short = (k: string) =>
  formatDateKey(k, "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** S47 — "Tool check" when an audit is due, plus maintenance/calibration due and unacknowledged handoffs. */
export async function TodayToolCard({ userId }: TodayToolCardProps) {
  const viewer = await viewerFor(userId);
  if (!viewer || !(await usesTools(userId))) return null;
  const [audit, settings, tz] = await Promise.all([
    openAuditFor(db, userId),
    getSettings(),
    getCompanyTimezone(),
  ]);
  const today = dateKey(new Date(), tz);
  const warn = settings.tools.maintenance_warning_days;
  const held = await db
    .select({
      id: tools.id,
      name: tools.name,
      task: tools.maintenanceTask,
      next: tools.nextMaintenanceOn,
      cal: tools.calibrationDueOn,
    })
    .from(tools)
    .where(
      and(
        isNull(tools.deletedAt),
        or(eq(tools.currentUserId, userId), eq(tools.ownerUserId, userId)),
        inArray(tools.status, ["assigned", "available", "in_repair"]),
      ),
    );
  const due = held
    .flatMap((t) => [
      {
        t,
        task: t.task ?? "Maintenance",
        on: t.next,
        state: dueState(t.next, today, warn),
      },
      {
        t,
        task: "Calibration",
        on: t.cal,
        state: dueState(t.cal, today, warn),
      },
    ])
    .filter((d) => d.on && d.state !== "ok")
    .sort((a, b) => (a.on ?? "").localeCompare(b.on ?? ""))
    .slice(0, 3);
  const [{ n: unack } = { n: 0 }] = await db
    .select({ n: count() })
    .from(toolAssignments)
    .where(
      and(
        eq(toolAssignments.userId, userId),
        isNull(toolAssignments.checkedInAt),
        isNull(toolAssignments.acknowledgedAt),
      ),
    );
  if (!audit && due.length === 0 && !Number(unack)) return null;
  return (
    <ListSection header="Tools">
      {audit && (
        <ListRow
          href={`/tools/audits/${audit.id}`}
          icon={<ClipboardCheck size={18} />}
          iconTone={audit.dueOn < today ? "red" : "orange"}
          title="Tool check"
          subtitle="A photo of each tool you carry"
          detail={
            <Pill tone={audit.dueOn < today ? "red" : "orange"} size="sm">
              {audit.dueOn < today
                ? "Overdue"
                : audit.dueOn === today
                  ? "Today"
                  : short(audit.dueOn)}
            </Pill>
          }
        />
      )}
      {Number(unack) > 0 && (
        <ListRow
          href="/tools?scope=mine"
          icon={<PackageCheck size={18} />}
          iconTone="blue"
          title={`Confirm ${Number(unack)} new tool${Number(unack) === 1 ? "" : "s"}`}
          subtitle="Tap “I have received these tools”"
        />
      )}
      {due.map((d) => (
        <ListRow
          key={`${d.t.id}:${d.task}`}
          href={`/tools/${d.t.id}`}
          icon={<Wrench size={18} />}
          iconTone={d.state === "overdue" ? "red" : "orange"}
          title={`${d.task}: ${d.t.name}`}
          detail={
            <Pill tone={d.state === "overdue" ? "red" : "orange"} size="sm">
              {d.state === "overdue"
                ? "Overdue"
                : d.state === "due"
                  ? "Today"
                  : short(d.on as string)}
            </Pill>
          }
        />
      ))}
    </ListSection>
  );
}

/** S51 — Tools in custody and audit status (team profile). */
export async function ToolCustodyRow({ userId }: ToolCustodyRowProps) {
  const viewer = await viewerFor(userId);
  if (!viewer || !(await usesTools(userId))) return null;
  const [rows, statuses] = await Promise.all([
    db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.currentUserId, userId), isNull(tools.deletedAt))),
    getToolAuditStatuses([userId]),
  ]);
  const s = statuses[userId];
  const all = viewer.perms.has("tools.view_all");
  return (
    <ListRow
      href={all ? `/tools?scope=all&holder=${userId}` : "/tools?scope=mine"}
      icon={<Wrench size={18} />}
      iconTone="indigo"
      title={`${rows.length} tool${rows.length === 1 ? "" : "s"} in custody`}
      subtitle={
        s?.nextDueOn
          ? `Tool check due ${short(s.nextDueOn)}`
          : s?.lastSubmittedAt
            ? `Last tool check ${s.lastSubmittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : "No tool check yet"
      }
      detail={
        s?.overdue ? (
          <Pill tone="red" size="sm">
            Overdue
          </Pill>
        ) : undefined
      }
    />
  );
}
