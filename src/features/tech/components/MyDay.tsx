import "server-only";
import { CircleCheck, ClipboardCheck, Flag, Receipt } from "lucide-react";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { listMyDay } from "@/features/jobs/queries";
import type { JobListItem } from "@/features/jobs/types";
import { MyEarningsCard } from "@/features/payroll/slots";
import { listTasks } from "@/features/tasks/queries";
import { getOpenEntry } from "@/features/time/queries";
import { TodayToolCard } from "@/features/tools/slots";
import {
  getAssignedVehicle,
  odometerApprovalHint,
} from "@/features/vehicles/api";
import { TodayVehicleCard } from "@/features/vehicles/slots";
import { legMiles } from "@/lib/geo";
import { getSettings, isEnabled } from "@/lib/settings";
import { formatInTz } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Card } from "@/ui/components/Card";
import { ListRow, ListSection, SectionHeader } from "@/ui/components/List";
import { SkeletonCard } from "@/ui/components/Skeleton";
import { StatusPill } from "@/ui/components/StatusPill";
import { type TripStep, TripTimeline } from "@/ui/components/Timeline";
import { ClockCard, TaskList } from "./islands";
import { NextJobHero } from "./NextJobHero";
import { OutboxRow } from "./OutboxRow";
import { TodayStrip } from "./TodayStrip";

// Tech "My Day" (SPEC M06; BUILD_PLAN §5.3 /today; DESIGN.md §7.1): a slim clock
// status (or the Clock in hero), the Uber-style current/next job hero, a summary
// strip (jobs done, earned, cash held), today's route as a trip timeline, own
// tasks, shortcuts (outbox, receipts, Finish my day) and the vehicle/tool/pay cards.

const ACTIVE = new Set(["en_route", "arrived", "in_progress"]);
const DONE = new Set(["completed", "closed", "cancelled"]);

/** Route steps: done / the hero's job (current) / upcoming. No morph names here. */
function routeSteps(
  jobs: JobListItem[],
  currentId: string | undefined,
  tz: string,
  withDate = false,
): TripStep[] {
  const steps = jobs.map((j): TripStep => {
    const done = DONE.has(j.status);
    const current = j.id === currentId;
    return {
      id: j.id,
      state: done ? "done" : current ? "current" : "upcoming",
      href: `/jobs/${j.id}`,
      time: j.windowStart
        ? formatInTz(
            j.windowStart,
            tz,
            withDate
              ? { month: "short", day: "numeric" }
              : { hour: "numeric", minute: "2-digit" },
          )
        : "—",
      title: j.title,
      body: (
        <span className="block truncate">
          {j.customerName} · {j.addressShort}
        </span>
      ),
      // The hero already shows the current job's live status; the route only flags
      // holds and unpaid finished jobs.
      aside:
        j.status === "on_hold" ? (
          <StatusPill kind="job" status={j.status} size="sm" live={false} />
        ) : done && j.paymentStatus !== "paid" && j.paymentStatus !== "none" ? (
          <StatusPill kind="jobPayment" status={j.paymentStatus} size="sm" />
        ) : undefined,
    };
  });
  // Miles between the day's stops on the route line (not across the days of
  // "Still open from earlier").
  if (!withDate)
    legMiles(
      jobs.map((j) =>
        j.lat != null && j.lng != null ? { lat: j.lat, lng: j.lng } : null,
      ),
    ).forEach((mi, i) => {
      const s = steps[i + 1];
      if (s) s.miles = mi;
    });
  return steps;
}

function Slot({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SkeletonCard lines={2} />}>{children}</Suspense>;
}

export async function MyDay({
  user,
  day,
  tz,
}: {
  user: SessionUser;
  day: string;
  tz: string;
}) {
  const vehiclesOn = await isEnabled("vehicles");
  const [{ today, carryOver }, open, settings, vehicle, tasks, partsOn] =
    await Promise.all([
      listMyDay(user, day),
      getOpenEntry(user.id),
      getSettings(),
      vehiclesOn ? getAssignedVehicle(user.id).catch(() => null) : null,
      listTasks({ scope: "mine", limit: 6 }),
      isEnabled("parts"),
    ]);
  const all = [...carryOver, ...today];
  const next =
    all.find((j) => ACTIVE.has(j.status)) ??
    all.find(
      (j) =>
        !DONE.has(j.status) &&
        j.status !== "on_hold" &&
        j.status !== "unscheduled",
    );
  const doneCount = today.filter(
    (j) => j.status === "completed" || j.status === "closed",
  ).length;
  const counted = today.filter((j) => j.status !== "cancelled").length;
  const requireOdo =
    !!settings.vehicles.require_odometer_on_clock &&
    !!vehicle &&
    (user.usesCompanyVehicle || vehicle.ownership === "tech_owned");
  const odometerHint = requireOdo
    ? await odometerApprovalHint(user)
    : undefined;

  const clockedIn = !!open;
  const canClock = user.perms.has("time.clock_self");

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex flex-col gap-3">
        <ClockCard
          mode="in"
          open={
            open
              ? {
                  id: open.id,
                  clockInAt: open.clockInAt,
                  breakMinutes: open.breakMinutes,
                }
              : null
          }
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
          canClock={canClock}
        />

        {next ? (
          <NextJobHero
            job={next}
            user={user}
            tz={tz}
            active={ACTIVE.has(next.status)}
            muted={canClock && !clockedIn}
          />
        ) : (
          <Card as="section" className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sys-green)_15%,transparent)] text-[var(--sys-green)]">
              <CircleCheck size={22} aria-hidden />
            </span>
            <div>
              <p className="text-headline">
                {counted ? "All done for today" : "No jobs today"}
              </p>
              <p className="text-subhead text-label-2">
                {counted
                  ? "Wrap up with Finish my day."
                  : "New assignments show up here."}
              </p>
            </div>
          </Card>
        )}

        <Suspense fallback={<div className="h-[86px]" aria-hidden />}>
          <TodayStrip user={user} done={doneCount} total={counted} />
        </Suspense>
      </div>

      {today.length > 0 && (
        <section aria-labelledby="route-h">
          <SectionHeader
            id="route-h"
            title="Today's route"
            subtitle={`${doneCount} of ${counted} done`}
            actionHref="/jobs?mine=1"
            actionLabel="My jobs"
          />
          <Card>
            {/* The hero's pill and the clock carry the two live pulses (M12). */}
            <TripTimeline
              label="Today's route"
              live={false}
              steps={routeSteps(today, next?.id, tz)}
            />
          </Card>
        </section>
      )}
      {carryOver.length > 0 && (
        <section aria-labelledby="carry-h">
          <SectionHeader
            id="carry-h"
            title="Still open from earlier"
            subtitle="Finish or put these on hold before you clock out."
          />
          <Card>
            <TripTimeline
              label="Still open from earlier"
              live={false}
              steps={routeSteps(carryOver, next?.id, tz, true)}
            />
          </Card>
        </section>
      )}

      <ListSection
        variant="title"
        header="My tasks"
        action={<SectionLink href="/tasks">See all</SectionLink>}
      >
        <TaskList
          tasks={tasks}
          tz={tz}
          viewerId={user.id}
          users={[]}
          canAssign={false}
          allowCreate
          compact
          emptyText="No open tasks."
        />
      </ListSection>

      <ListSection variant="title" header="Shortcuts">
        <ListRow
          href="/today/finish"
          icon={<Flag size={17} />}
          iconTone="orange"
          title="Finish my day"
          subtitle="Sync, cash, receipts, odometer, clock out"
        />
        <Suspense fallback={null}>
          <OutboxRow user={user} />
        </Suspense>
        {partsOn && user.perms.has("parts.submit_receipt") && (
          <ListRow
            href="/parts?new=receipt"
            icon={<Receipt size={17} />}
            iconTone="green"
            title="Upload a receipt"
          />
        )}
        <ListRow
          href="/jobs?mine=1"
          icon={<ClipboardCheck size={17} />}
          iconTone="blue"
          title="My jobs"
        />
      </ListSection>

      <section aria-labelledby="gear-h" className="flex flex-col gap-3">
        <SectionHeader
          id="gear-h"
          title="Van, tools and pay"
          className="pb-0"
        />
        <Slot>
          <TodayVehicleCard userId={user.id} />
        </Slot>
        <Slot>
          <TodayToolCard userId={user.id} />
        </Slot>
        <Suspense fallback={null}>
          <MyEarningsCard userId={user.id} />
        </Suspense>
      </section>
    </div>
  );
}

function SectionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className="hit-44 shrink-0 rounded-pill text-subhead font-semibold text-accent-text"
    >
      {children}
    </Link>
  );
}
