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
import { CustomerCard, PropertyCard } from "@/features/customers/slots";
import { JobRow } from "@/features/jobs/components/JobRow";
import { listMyDay } from "@/features/jobs/queries";
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
        <ListSection
          header={
            <span className="flex items-center gap-1.5">
              <Route size={13} aria-hidden /> Today's route
            </span>
          }
          trailing={
            <span className="num text-footnote text-label-2">
              {doneCount} of {counted} done
            </span>
          }
        >
          {today.map((j) => (
            <JobRow key={j.id} job={j} tz={tz} showDate={false} />
          ))}
        </ListSection>
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
