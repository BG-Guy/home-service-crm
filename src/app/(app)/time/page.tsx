import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  ParamSegmented,
  ParamSelect,
} from "@/features/jobs/components/ParamControls";
import { ClockCard } from "@/features/tech/components/islands";
import { TimeEntryList } from "@/features/time/components/TimeEntryList";
import { formatMinutes } from "@/features/time/format";
import {
  getOpenEntry,
  listTimeEntries,
  timeUsers,
} from "@/features/time/queries";
import {
  getAssignedVehicle,
  odometerApprovalHint,
} from "@/features/vehicles/api";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { StatCard } from "@/ui/components/StatCard";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Time clock" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

/** /time: own entries (time.clock_self); anyone's with time.manage (edit with reason). */
export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const viewer = await requireUser("time.clock_self");
  const sp = await searchParams;
  const manage = viewer.perms.has("time.manage");
  const userId =
    manage && /^[0-9a-f-]{36}$/i.test(one(sp.user)) ? one(sp.user) : viewer.id;
  const range =
    one(sp.range) === "2w"
      ? "2w"
      : one(sp.range) === "month"
        ? "month"
        : "week";
  const tz = await getCompanyTimezone();
  const today = dateKey(new Date(), tz);
  const wd = zonedParts(new Date(), tz).weekday;
  const fromKey =
    range === "month"
      ? `${today.slice(0, 8)}01`
      : addDaysToKey(today, -((wd + 6) % 7) - (range === "2w" ? 7 : 0));
  const from = zonedTimeToUtc(parseDateKey(fromKey), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(today, 1)), tz);
  const self = userId === viewer.id;
  const vehiclesOn = await isEnabled("vehicles");
  const [entries, users, open, settings, vehicle] = await Promise.all([
    listTimeEntries(userId, from, to, viewer),
    manage ? timeUsers() : Promise.resolve([]),
    self ? getOpenEntry(viewer.id) : Promise.resolve(null),
    getSettings(),
    self && vehiclesOn
      ? getAssignedVehicle(viewer.id).catch(() => null)
      : Promise.resolve(null),
  ]);
  const requireOdo =
    !!settings.vehicles.require_odometer_on_clock &&
    !!vehicle &&
    (viewer.usesCompanyVehicle || vehicle.ownership === "tech_owned");
  const odometerHint = requireOdo
    ? await odometerApprovalHint(viewer)
    : undefined;
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const days = new Set(entries.map((e) => dateKey(e.clockInAt, tz))).size;
  const name = users.find((u) => u.id === userId)?.name;

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Time clock"
        subtitle={!self && name ? name : undefined}
        trailing={<HeaderActions />}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ParamSegmented
            param="range"
            label="Period"
            value={range}
            className="sm:w-80"
            segments={[
              { value: "week", label: "This week" },
              { value: "2w", label: "2 weeks" },
              { value: "month", label: "Month" },
            ]}
          />
          {manage && (
            <ParamSelect
              param="user"
              label="Person"
              value={self ? "" : userId}
              placeholder="Me"
              options={users
                .filter((u) => u.id !== viewer.id)
                .map((u) => ({ value: u.id, label: u.name }))}
              className="sm:w-56"
            />
          )}
        </div>
      </LargeTitleHeader>
      <Page>
        <div className="flex flex-col gap-[var(--section-gap)]">
          {self && (
            <ClockCard
              mode="in"
              open={open}
              tz={tz}
              vehicle={
                vehicle
                  ? {
                      id: vehicle.id,
                      nickname: vehicle.nickname,
                      odometer: vehicle.odometer,
                    }
                  : null
              }
              requireOdometer={requireOdo}
              odometerHint={odometerHint}
              canClock
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              size="md"
              label="Hours worked"
              value={formatMinutes(total)}
              footnote={
                days
                  ? `${formatMinutes(Math.round(total / days))} a day`
                  : undefined
              }
            />
            <StatCard
              size="md"
              label="Days worked"
              value={String(days)}
              footnote={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
            />
          </div>
          <TimeEntryList
            entries={entries}
            tz={tz}
            canManage={manage}
            userId={userId}
            showAdd={manage}
          />
        </div>
      </Page>
    </PageTransition>
  );
}
