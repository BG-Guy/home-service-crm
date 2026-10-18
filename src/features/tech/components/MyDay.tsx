import "server-only";
import {
  CircleCheck,
  ClipboardCheck,
  Flag,
  ListTodo,
  Receipt,
  Route,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { getMapConfig } from "@/adapters/maps";
import { CustomerCard, PropertyCard } from "@/features/customers/slots";
import { JobRow } from "@/features/jobs/components/JobRow";
import { RouteMapCard } from "@/features/jobs/components/schedule/RouteMapCard";
import { StopBadge } from "@/features/jobs/components/schedule/StopBadge";
import { listMyDay } from "@/features/jobs/queries";
import {
  isDoneStatus,
  isLocated,
  routeLayers,
  singleRoute,
  techColor,
} from "@/features/jobs/route-plan";
import type { JobListItem } from "@/features/jobs/types";
import { OutboxCountBadge } from "@/features/messaging/slots";
import { CashOnHandPill, MyEarningsCard } from "@/features/payroll/slots";
import { TaskList } from "@/features/tasks/components/TaskList";
import { listTasks } from "@/features/tasks/queries";
import { getOpenEntry } from "@/features/time/queries";
import { TodayToolCard } from "@/features/tools/slots";
import {
  getAssignedVehicle,
  odometerApprovalHint,
} from "@/features/vehicles/api";
import { TodayVehicleCard } from "@/features/vehicles/slots";
import { getSettings, isEnabled } from "@/lib/settings";
import { formatInTz, formatTimeRange } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { ListRow, ListSection } from "@/ui/components/List";
import { SkeletonCard } from "@/ui/components/Skeleton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { ClockCard } from "./ClockCard";
import { HeroActions } from "./HeroActions";

// Tech "My Day" (SPEC M06; BUILD_PLAN §5.3 /today): clock card, cash pill, the
// next-job hero, the rest of today's route in order, own tasks, shortcuts
// (vehicle, tools, outbox, receipts) and "Finish my day".

const ACTIVE = new Set(["en_route", "arrived", "in_progress"]);
const DONE = new Set(["completed", "closed", "cancelled"]);

function Slot({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SkeletonCard lines={2} />}>{children}</Suspense>;
}

/** "Stop 3" / "Stops 3 and 4" / "Stops 2, 3 and 5". */
function stopList(ns: number[]): string {
  if (ns.length === 1) return `Stop ${ns[0]}`;
  return `Stops ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

/**
 * Today's stops as map layers, numbered in route order. Only jobs whose address the
 * tech may see right now get a pin (`lat`/`lng` are null outside the contact window).
 */
function todaysRoute(user: SessionUser, today: JobListItem[]) {
  const mine = today
    .flatMap((j) => j.assignees)
    .find((a) => a.userId === user.id);
  const color = techColor(mine?.color, user.id);
  const plan = singleRoute(
    user.id,
    today.map((j) => ({
      id: j.id,
      number: j.number,
      title: j.title,
      status: j.status,
      start: j.windowStart,
      techIds: [user.id],
      lat: j.lat ?? null,
      lng: j.lng ?? null,
    })),
  );
  const { pins, lines } = routeLayers(plan, {
    color: () => color,
    name: () => "",
  });
  const masked = today.flatMap((j, i) =>
    !isLocated(j) && j.addressMasked ? [i + 1] : [],
  );
  const unlocated = today.flatMap((j, i) =>
    !isLocated(j) && !j.addressMasked ? [i + 1] : [],
  );
  // No pin yet (early in the day): say why there's no map instead of nothing.
  if (pins.length === 0)
    return {
      color,
      pins,
      lines,
      note: masked.length ? "Stops show on the map 2 h before each visit." : "",
    };
  const notes: string[] = [];
  if (masked.length)
    notes.push(
      `${stopList(masked)} ${masked.length === 1 ? "shows" : "show"} on the map 2 h before the visit.`,
    );
  if (unlocated.length)
    notes.push(
      `${stopList(unlocated)} ${unlocated.length === 1 ? "isn’t" : "aren’t"} on the map: the address couldn’t be located.`,
    );
  return { color, pins, lines, note: notes.join(" ") };
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
  const route = todaysRoute(user, today);
  const tiles = getMapConfig();

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex flex-col gap-2">
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
          canClock={user.perms.has("time.clock_self")}
        />
        <Suspense fallback={null}>
          <CashOnHandPill userId={user.id} />
        </Suspense>
      </div>

      {next ? (
        // The job card, then the customer and address cards as siblings (no card
        // inside a card; the address card carries the one Navigate button).
        <section aria-label="Next job" className="flex flex-col gap-2">
          <h2 className="px-1 text-footnote font-semibold uppercase tracking-wide text-label-2">
            {ACTIVE.has(next.status) ? "Current job" : "Next up"}
          </h2>
          <div className="list-card flex flex-col gap-3 p-4">
            <Link
              href={`/jobs/${next.id}`}
              transitionTypes={["nav-forward"]}
              className="flex flex-col gap-1"
            >
              <span className="flex items-center gap-2">
                <span className="num text-footnote text-label-2">
                  {next.number}
                </span>
                <StatusPill kind="job" status={next.status} size="sm" />
                {next.priority !== "normal" && (
                  <Pill
                    tone={next.priority === "emergency" ? "red" : "orange"}
                    size="sm"
                  >
                    {next.priority === "emergency" ? "Emergency" : "Urgent"}
                  </Pill>
                )}
              </span>
              <span className="text-title3 font-semibold leading-snug">
                {next.title}
              </span>
              {next.windowStart && (
                <span className="num text-subhead text-label-2">
                  {next.windowEnd
                    ? formatTimeRange(next.windowStart, next.windowEnd, tz)
                    : formatInTz(next.windowStart, tz, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                </span>
              )}
            </Link>
            <HeroActions
              jobId={next.id}
              status={next.status}
              customerFirstName={next.customerName.split(" ")[0] ?? null}
            />
          </div>
          <Slot>
            <CustomerCard
              customerId={next.customerId}
              jobId={next.id}
              variant="compact"
              showActions
            />
          </Slot>
          <Slot>
            <PropertyCard
              propertyId={next.propertyId}
              jobId={next.id}
              variant="compact"
            />
          </Slot>
        </section>
      ) : (
        <section className="list-card flex items-center gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sys-green)_15%,transparent)] text-[var(--sys-green)]">
            <CircleCheck size={22} aria-hidden />
          </span>
          <div>
            <p className="text-headline font-semibold">
              {counted ? "All done for today" : "No jobs today"}
            </p>
            <p className="text-footnote text-label-2">
              {counted
                ? "Wrap up with Finish my day."
                : "New assignments show up here."}
            </p>
          </div>
        </section>
      )}

      {today.length > 0 && (
        // The route map (lazy, numbered pins + a dashed line in visit order) sits
        // between the header and the list; the list rows carry the same numbers.
        <section aria-labelledby="todays-route-h">
          <div className="flex items-end justify-between gap-3 px-4 pb-1.5">
            <h2
              id="todays-route-h"
              className="flex items-center gap-1.5 text-footnote uppercase text-label-2"
            >
              <Route size={13} aria-hidden /> Today's route
            </h2>
            <span className="num text-footnote text-label-2">
              {doneCount} of {counted} done
            </span>
          </div>
          {route.pins.length > 0 && (
            <RouteMapCard
              pins={route.pins}
              lines={route.lines}
              tileUrl={tiles.tileUrl}
              attribution={tiles.attribution}
              canSetup={user.perms.has("settings.manage")}
              label={`Map of today's route: ${route.pins.length} ${route.pins.length === 1 ? "stop" : "stops"}, numbered as in the list below`}
              className="mb-2 h-48"
            />
          )}
          <ul className="list-card">
            {today.map((j, i) => (
              <li key={j.id}>
                <JobRow
                  job={j}
                  tz={tz}
                  showDate={false}
                  marker={
                    route.pins.length > 0 ? (
                      <StopBadge
                        label={String(i + 1)}
                        color={route.color}
                        offMap={!isLocated(j)}
                        done={isDoneStatus(j.status)}
                        size={24}
                      />
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
          {route.note && (
            <p className="px-4 pt-1.5 text-footnote text-label-2">
              {route.note}
            </p>
          )}
        </section>
      )}
      {carryOver.length > 0 && (
        <ListSection
          header="Still open from earlier"
          footer="Finish or put these on hold before you clock out."
        >
          {carryOver.map((j) => (
            <JobRow key={j.id} job={j} tz={tz} />
          ))}
        </ListSection>
      )}

      <ListSection
        header={
          <span className="flex items-center gap-1.5">
            <ListTodo size={13} aria-hidden /> My tasks
          </span>
        }
        trailing={
          <Link href="/tasks" className="text-footnote text-accent">
            See all
          </Link>
        }
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

      <div className="flex flex-col gap-2">
        <Slot>
          <TodayVehicleCard userId={user.id} />
        </Slot>
        <Slot>
          <TodayToolCard userId={user.id} />
        </Slot>
        <Suspense fallback={null}>
          <MyEarningsCard userId={user.id} />
        </Suspense>
      </div>

      <ListSection header="Shortcuts">
        <Suspense fallback={null}>
          <OutboxCountBadge scope="mine" />
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
        <ListRow
          href="/today/finish"
          icon={<Flag size={17} />}
          iconTone="orange"
          title="Finish my day"
          subtitle="Sync, cash, receipts, odometer, clock out"
        />
      </ListSection>
    </div>
  );
}
