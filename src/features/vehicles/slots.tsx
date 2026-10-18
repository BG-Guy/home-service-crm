import "server-only";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import {
  ClipboardCheck,
  Gauge,
  TriangleAlert,
  Truck,
  Wrench,
} from "lucide-react";
import { db } from "@/db";
import {
  odometerReadings,
  users,
  vehicleIssues,
  vehicleReminderRules,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import {
  addDaysToKey,
  formatTime,
  parseDateKey,
  startOfDayInTz,
  zonedTimeToUtc,
} from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import { getAssignedVehicle, getFleetSummary } from "./api";
import { FleetSummaryView } from "./components/FleetSummary";
import type {
  AssignedVehicleRowProps,
  EndOdometerSectionProps,
  FleetSummaryCardProps,
  TodayVehicleCardProps,
} from "./contracts";
import { aiEnabled, inspectionDue } from "./engine";
import {
  approvalHint,
  odometerHintCopy,
  taskLabel,
  type VehiclePolicies,
} from "./rules";
import { OdometerCaptureButton } from "./slots.client";

// Server UI slots produced by B7 (BUILD_PLAN §5.1). Each takes ids, checks the
// viewer, the row scope and the `vehicles` flag, and returns null otherwise.

const num = new Intl.NumberFormat("en-US");

/** The viewer may see `userId`'s vehicle: themselves (view_own) or fleet (view_all). */
async function viewerFor(userId: string): Promise<SessionUser | null> {
  const viewer = await getCurrentUser();
  if (!viewer || !(await isEnabled("vehicles"))) return null;
  if (viewer.perms.has("vehicles.view_all")) return viewer;
  if (viewer.id === userId && viewer.perms.has("vehicles.view_own"))
    return viewer;
  return null;
}

async function dueItems(vehicleId: string) {
  const [rules, issues] = await Promise.all([
    db
      .select({
        task: vehicleReminderRules.task,
        status: vehicleReminderRules.status,
      })
      .from(vehicleReminderRules)
      .where(
        and(
          eq(vehicleReminderRules.vehicleId, vehicleId),
          eq(vehicleReminderRules.active, true),
          inArray(vehicleReminderRules.status, ["overdue", "due_soon"]),
        ),
      )
      .orderBy(
        sql`case ${vehicleReminderRules.status} when 'overdue' then 0 else 1 end`,
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(vehicleIssues)
      .where(
        and(
          eq(vehicleIssues.vehicleId, vehicleId),
          ne(vehicleIssues.status, "resolved"),
        ),
      ),
  ]);
  return { rules, openIssues: Number(issues[0]?.n ?? 0) };
}

/** S46 — Assigned vehicle, odometer shortcut, inspection due, reminders and issues. */
export async function TodayVehicleCard({ userId }: TodayVehicleCardProps) {
  const viewer = await viewerFor(userId);
  if (!viewer) return null;
  const v = await getAssignedVehicle(userId);
  if (!v) return null;
  const [due, inspect] = await Promise.all([
    dueItems(v.id),
    inspectionDue(db, v.id),
  ]);
  const href = `/vehicles/${v.id}`;
  return (
    <ListSection header="My vehicle">
      <ListRow
        href={href}
        icon={<Truck size={18} />}
        iconTone="blue"
        title={v.nickname}
        subtitle={
          v.odometer != null ? `${num.format(v.odometer)} mi` : "No reading yet"
        }
      />
      <ListRow
        href={`${href}?log=odometer`}
        icon={<Gauge size={18} />}
        iconTone="indigo"
        title="Log odometer"
      />
      {inspect && (
        <ListRow
          href={`${href}?log=inspection`}
          icon={<ClipboardCheck size={18} />}
          iconTone="orange"
          title="Inspection due"
          subtitle="Tires, lights, fluids, brakes — two minutes"
        />
      )}
      {due.rules.slice(0, 3).map((r) => (
        <ListRow
          key={r.task}
          href={href}
          icon={<Wrench size={18} />}
          iconTone={r.status === "overdue" ? "red" : "orange"}
          title={taskLabel(r.task)}
          detail={
            <Pill tone={r.status === "overdue" ? "red" : "orange"} size="sm">
              {r.status === "overdue" ? "Overdue" : "Due soon"}
            </Pill>
          }
        />
      ))}
      {due.openIssues > 0 && (
        <ListRow
          href={`${href}?tab=issues`}
          icon={<TriangleAlert size={18} />}
          iconTone="red"
          title={`${due.openIssues} open issue${due.openIssues === 1 ? "" : "s"}`}
        />
      )}
    </ListSection>
  );
}

/** S49 — End-of-day odometer prompt (wraps S48). */
export async function EndOdometerSection({ userId }: EndOdometerSectionProps) {
  const viewer = await viewerFor(userId);
  if (!viewer || !viewer.perms.has("vehicles.log")) return null;
  const v = await getAssignedVehicle(userId);
  if (!v) return null;
  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const hint = approvalHint(
    viewer,
    "odometer",
    settings.vehicles.policies as VehiclePolicies,
    aiEnabled(),
  );
  const since = startOfDayInTz(new Date(), tz);
  const [last] = await db
    .select({ value: odometerReadings.value, at: odometerReadings.recordedAt })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, v.id),
        eq(odometerReadings.recordedBy, userId),
        gte(odometerReadings.recordedAt, since),
        ne(odometerReadings.approvalStatus, "rejected"),
      ),
    )
    .orderBy(desc(odometerReadings.recordedAt))
    .limit(1);
  return (
    <ListSection header="End-of-day odometer" footer={odometerHintCopy(hint)}>
      <div className="list-row flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-body">{v.nickname}</p>
          <p className="text-footnote text-label-2">
            {last
              ? `Last today: ${num.format(last.value)} mi at ${formatTime(last.at, tz)}`
              : "No reading yet today"}
          </p>
        </div>
        <OdometerCaptureButton
          vehicleId={v.id}
          vehicleName={v.nickname}
          lastOdometer={v.odometer}
          source="manual"
          label={last ? "Log again" : "Log odometer"}
          variant={last ? "gray" : "filled"}
          approvalHint={hint}
        />
      </div>
    </ListSection>
  );
}

/** S50 — Assigned vehicle and due items (team profile). */
export async function AssignedVehicleRow({ userId }: AssignedVehicleRowProps) {
  const viewer = await viewerFor(userId);
  if (!viewer) return null;
  const v = await getAssignedVehicle(userId);
  if (!v) {
    const [u] = await db
      .select({ uses: users.usesCompanyVehicle })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u?.uses) return null;
    return (
      <ListRow
        icon={<Truck size={18} />}
        iconTone="gray"
        title="No vehicle assigned"
        href={viewer.perms.has("vehicles.manage") ? "/vehicles" : undefined}
      />
    );
  }
  const due = await dueItems(v.id);
  const overdue = due.rules.filter((r) => r.status === "overdue").length;
  const soon = due.rules.length - overdue;
  return (
    <ListRow
      href={`/vehicles/${v.id}`}
      icon={<Truck size={18} />}
      iconTone="blue"
      title={v.nickname}
      subtitle={[
        v.odometer != null ? `${num.format(v.odometer)} mi` : null,
        v.ownership === "tech_owned" ? "Own vehicle" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      detail={
        overdue || soon || due.openIssues ? (
          <span className="flex gap-1">
            {overdue > 0 && (
              <Pill tone="red" size="sm">
                {overdue} overdue
              </Pill>
            )}
            {soon > 0 && (
              <Pill tone="orange" size="sm">
                {soon} soon
              </Pill>
            )}
            {due.openIssues > 0 && (
              <Pill tone="orange" size="sm">
                {due.openIssues} issue{due.openIssues === 1 ? "" : "s"}
              </Pill>
            )}
          </span>
        ) : undefined
      }
    />
  );
}

/** S52 — Cost per mile, fuel spend, overdue, open issues. */
export async function FleetSummaryCard({ from, to }: FleetSummaryCardProps) {
  const viewer = await getCurrentUser();
  if (!viewer?.perms.has("vehicles.view_all") || !(await isEnabled("vehicles")))
    return null;
  const tz = await getCompanyTimezone();
  const valid = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k);
  if (!valid(from) || !valid(to)) return null;
  const start = zonedTimeToUtc(parseDateKey(from), tz);
  // `to` is inclusive (a YYYY-MM-DD day): end at the next local midnight.
  const end = zonedTimeToUtc(parseDateKey(addDaysToKey(to, 1)), tz);
  const data = await getFleetSummary(start, end);
  return (
    <FleetSummaryView data={data} periodLabel="Open fleet" href="/vehicles" />
  );
}
