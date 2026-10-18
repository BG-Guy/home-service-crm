import {
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  MapIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getMapConfig } from "@/adapters/maps";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  ParamSegmented,
  ParamSelect,
} from "@/features/jobs/components/ParamControls";
import { BoardJobRow } from "@/features/jobs/components/schedule/BoardJobRow";
import { ConfirmJobButton } from "@/features/jobs/components/schedule/ConfirmJobButton";
import { DesktopBoard } from "@/features/jobs/components/schedule/DesktopBoard";
import { LazyScheduleMap } from "@/features/jobs/components/schedule/LazyScheduleMap";
import { type BoardJob, loadBoard } from "@/features/jobs/schedule-queries";
import { AssignJobButton } from "@/features/jobs/slots.client";
import { requireUser } from "@/lib/auth/current";
import { addDaysToKey, formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { buttonClass } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Schedule" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

function hrefWith(sp: SP, patch: Record<string, string | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (one(v)) p.set(k, one(v));
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `/schedule?${qs}` : "/schedule";
}

/**
 * /schedule (SPEC M05 calendar): day / 3-day / week, tech columns, queues, conflicts.
 * `?layout=map` shows the same range as routes on a map (one day at a time).
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser("schedule.view_all");
  const sp = await searchParams;
  const data = await loadBoard({
    view: one(sp.view),
    date: one(sp.date),
    tech: one(sp.tech),
  });
  const colorBy = one(sp.color) === "tech" ? "tech" : "status";
  const mapLayout = one(sp.layout) === "map";
  // Free tiles: OSM in dev, NEXT_PUBLIC_TILE_URL in production (else pins on a plain map).
  const tiles = getMapConfig();
  const canAssign =
    user.perms.has("jobs.assign") || user.perms.has("jobs.reschedule");
  const step = data.view === "day" ? 1 : data.view === "3day" ? 3 : 7;
  const label =
    data.days.length === 1
      ? formatDateKey(data.days[0] as string, "en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
      : `${formatDateKey(data.days[0] as string, "en-US", { month: "short", day: "numeric" })} – ${formatDateKey(
          data.days[data.days.length - 1] as string,
          "en-US",
          { month: "short", day: "numeric" },
        )}`;
  // Icon-only on the mobile rows so titles keep their width (QA T4-06).
  const assign = (j: BoardJob, labelText = "Reassign") =>
    canAssign ? (
      <AssignJobButton
        jobId={j.id}
        label={`${labelText} ${j.number}`}
        iconOnly
      />
    ) : undefined;

  const navBtn = buttonClass({
    variant: "gray",
    size: "sm",
    className: "px-2.5",
  });
  const sections =
    data.view === "day"
      ? data.techs.map((t) => ({
          key: t.id,
          header: (
            <span className="flex items-center gap-2 normal-case">
              <Avatar
                name={t.name}
                seed={t.id}
                size={20}
                status={t.clockedIn ? "online" : "offline"}
              />
              {t.name}
            </span>
          ),
          jobs: data.jobs.filter((j) => j.techIds.includes(t.id)),
          techs: false,
        }))
      : data.days.map((d) => ({
          key: d,
          header: formatDateKey(d, "en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
          jobs: data.jobs.filter((j) => j.dayKey === d),
          techs: true,
        }));
  const unassignedInRange =
    data.view === "day" ? data.jobs.filter((j) => j.techIds.length === 0) : [];
  const emptyDays =
    data.view === "day"
      ? []
      : data.days.filter((d) => !data.jobs.some((j) => j.dayKey === d));

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Schedule"
        subtitle={label}
        trailing={<HeaderActions />}
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="flex items-center gap-2">
            <ParamSegmented
              param="view"
              label="Calendar view"
              value={data.view}
              className="min-w-0 flex-1 lg:w-56 lg:flex-none"
              segments={[
                { value: "day", label: "Day" },
                { value: "3day", label: "3 days" },
                { value: "week", label: "Week" },
              ]}
            />
            {/* Icons (named for screen readers, tooltips on hover) keep the header on one line. */}
            <ParamSegmented
              param="layout"
              label="Show as"
              value={mapLayout ? "map" : ""}
              className="w-24 shrink-0"
              segments={[
                {
                  value: "",
                  label: (
                    <span
                      title="Calendar"
                      className="flex items-center justify-center"
                    >
                      <CalendarDays
                        size={16}
                        aria-hidden
                        className="shrink-0"
                      />
                      <span className="sr-only">Calendar</span>
                    </span>
                  ),
                },
                {
                  value: "map",
                  label: (
                    <span
                      title="Map"
                      className="flex items-center justify-center"
                    >
                      <MapIcon size={16} aria-hidden className="shrink-0" />
                      <span className="sr-only">Map</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <Link
              className={navBtn}
              aria-label="Previous"
              href={hrefWith(sp, { date: addDaysToKey(data.date, -step) })}
              replace
            >
              <ChevronLeft size={18} />
            </Link>
            <Link
              className={navBtn}
              href={hrefWith(sp, { date: null })}
              replace
            >
              Today
            </Link>
            <Link
              className={navBtn}
              aria-label="Next"
              href={hrefWith(sp, { date: addDaysToKey(data.date, step) })}
              replace
            >
              <ChevronRight size={18} />
            </Link>
            <ParamSelect
              param="tech"
              label="Technician"
              value={one(sp.tech)}
              placeholder="All techs"
              options={
                data.techs.length || one(sp.tech)
                  ? data.techs.map((t) => ({ value: t.id, label: t.name }))
                  : []
              }
              className="min-w-0 flex-1 lg:w-48 lg:flex-none"
            />
          </div>
          <div className={mapLayout ? "hidden" : "hidden lg:ml-auto lg:block"}>
            <ParamSegmented
              param="color"
              label="Color by"
              value={colorBy}
              className="w-56"
              segments={[
                { value: "status", label: "By status" },
                { value: "tech", label: "By tech" },
              ]}
            />
          </div>
        </div>
      </LargeTitleHeader>
      <Page wide>
        {mapLayout ? (
          <LazyScheduleMap
            data={{
              date: data.date,
              days: data.days,
              tz: data.tz,
              techs: data.techs,
              jobs: data.jobs,
            }}
            canAssign={canAssign}
            tileUrl={tiles.tileUrl}
            attribution={tiles.attribution}
            canSetup={user.perms.has("settings.manage")}
            techFilter={one(sp.tech) || null}
            allTechsHref={one(sp.tech) ? hrefWith(sp, { tech: null }) : null}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <DesktopBoard data={data} colorBy={colorBy} />
            </div>

            <div className="flex flex-col gap-[var(--section-gap)] lg:hidden">
              {data.jobs.length === 0 && (
                <div className="list-card">
                  <EmptyState
                    compact
                    icon={<CalendarX2 size={36} />}
                    title="Nothing scheduled"
                    message={
                      data.unscheduled.length
                        ? "Assign a job from the queue below."
                        : "Booked jobs show up here."
                    }
                  />
                </div>
              )}
              {unassignedInRange.length > 0 && (
                <ListSection header="Needs a technician">
                  {unassignedInRange.map((j) => (
                    <BoardJobRow
                      key={j.id}
                      job={j}
                      tz={data.tz}
                      trailing={assign(j, "Assign")}
                    />
                  ))}
                </ListSection>
              )}
              {sections
                .filter((s) => s.jobs.length > 0)
                .map((s) => (
                  <ListSection
                    key={s.key}
                    header={s.header}
                    trailing={
                      <span className="num text-footnote text-label-2">
                        {s.jobs.length}
                      </span>
                    }
                  >
                    {s.jobs.map((j) => (
                      <BoardJobRow
                        key={`${s.key}-${j.id}`}
                        job={j}
                        tz={data.tz}
                        techs={data.techs}
                        showTechs={s.techs}
                        trailing={assign(j)}
                      />
                    ))}
                  </ListSection>
                ))}
              {/* Empty days collapse into one row instead of a card each (QA T4-31). */}
              {data.view !== "day" &&
                emptyDays.length > 0 &&
                data.jobs.length > 0 && (
                  <ListSection header="No jobs">
                    <p className="px-4 py-3 text-subhead text-label-2">
                      {emptyDays
                        .map((d) =>
                          formatDateKey(d, "en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          }),
                        )
                        .join(" · ")}
                    </p>
                  </ListSection>
                )}
              {data.view === "day" &&
                data.techs.some(
                  (t) => !data.jobs.some((j) => j.techIds.includes(t.id)),
                ) && (
                  <p className="px-1 text-footnote text-label-2">
                    Free:{" "}
                    {data.techs
                      .filter(
                        (t) => !data.jobs.some((j) => j.techIds.includes(t.id)),
                      )
                      .map((t) => t.name.split(" ")[0])
                      .join(", ")}
                  </p>
                )}
              <ListSection
                header="Unscheduled"
                trailing={
                  <span className="num text-footnote text-label-2">
                    {data.unscheduled.length}
                  </span>
                }
              >
                {data.unscheduled.length === 0 ? (
                  <p className="px-4 py-3 text-subhead text-label-3">
                    Every job has a time. Nice.
                  </p>
                ) : (
                  data.unscheduled.map((j) => (
                    <BoardJobRow
                      key={j.id}
                      job={j}
                      tz={data.tz}
                      trailing={assign(j, "Assign")}
                    />
                  ))
                )}
              </ListSection>
              {data.onHold.length > 0 && (
                <ListSection header="On hold">
                  {data.onHold.map((j) => (
                    <BoardJobRow
                      key={j.id}
                      job={j}
                      tz={data.tz}
                      techs={data.techs}
                      showTechs
                      showDay
                    />
                  ))}
                </ListSection>
              )}
            </div>

            {data.unconfirmedTomorrow.length > 0 && (
              <div className="mt-[var(--section-gap)] lg:hidden">
                <ListSection
                  header="Unconfirmed tomorrow"
                  footer="Customers who haven't confirmed yet. Mark a phone confirmation here."
                >
                  {data.unconfirmedTomorrow.map((j) => (
                    <BoardJobRow
                      key={j.id}
                      job={j}
                      tz={data.tz}
                      techs={data.techs}
                      showTechs
                      trailing={
                        user.perms.has("jobs.edit") ? (
                          <ConfirmJobButton jobId={j.id} />
                        ) : undefined
                      }
                    />
                  ))}
                </ListSection>
              </div>
            )}
          </>
        )}
      </Page>
    </PageTransition>
  );
}
