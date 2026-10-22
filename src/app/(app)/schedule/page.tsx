import { CalendarX2, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { AssignJobButton } from "@/features/jobs/components/AssignJobButton";
import {
  ParamSegmented,
  ParamSelect,
} from "@/features/jobs/components/ParamControls";
import { BoardJobRow } from "@/features/jobs/components/schedule/BoardJobRow";
import { ConfirmJobButton } from "@/features/jobs/components/schedule/ConfirmJobButton";
import { techColor } from "@/features/jobs/components/schedule/colors";
import { ScheduleBoard } from "@/features/jobs/components/schedule/ScheduleBoard";
import { LazyScheduleMap } from "@/features/jobs/schedule-map/components/LazyScheduleMap";
import { loadScheduleMap } from "@/features/jobs/schedule-map/queries";
import { type BoardJob, loadBoard } from "@/features/jobs/schedule-queries";
import { requireUser } from "@/lib/auth/current";
import { addDaysToKey, formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { buttonClass } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { FullscreenButton } from "@/ui/components/FullscreenButton";
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

/** Calendar | Map switch (push: back returns to the other view). */
function ViewSwitch({ value }: { value: "day" | "3day" | "week" | "map" }) {
  return (
    <ParamSegmented
      param="view"
      label="Schedule view"
      value={value}
      push
      extra={{ job: null }}
      className="w-40 shrink-0"
      segments={[
        { value: value === "map" ? "day" : value, label: "Calendar" },
        { value: "map", label: "Map" },
      ]}
    />
  );
}

/** /schedule?view=map: one day of routes on a map, timeline and details. */
async function ScheduleMap({ sp }: { sp: SP }) {
  const data = await loadScheduleMap({
    date: one(sp.date),
    userAgent: (await headers()).get("user-agent"),
  });
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Schedule"
        subtitle={formatDateKey(data.date, "en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })}
        trailing={<HeaderActions />}
      >
        <ViewSwitch value="map" />
      </LargeTitleHeader>
      <Page wide className="pt-1">
        <LazyScheduleMap data={data} />
      </Page>
    </PageTransition>
  );
}

/** /schedule (SPEC M05 calendar): day / 3-day / week, tech columns, queues, conflicts. */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser("schedule.view_all");
  const sp = await searchParams;
  if (one(sp.view) === "map") return <ScheduleMap sp={sp} />;
  const data = await loadBoard({
    view: one(sp.view),
    date: one(sp.date),
    tech: one(sp.tech),
  });
  const colorBy = one(sp.color) === "tech" ? "tech" : "status";
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
    variant: "secondary",
    size: "md",
    className: "hit-44 w-11 shrink-0 px-0",
  });
  const sections =
    data.view === "day"
      ? data.techs.map((t) => ({
          key: t.id,
          header: (
            <span className="flex items-center gap-2.5">
              <Avatar
                name={t.name}
                seed={t.id}
                size={32}
                presence={t.clockedIn}
              />
              <span className="min-w-0 truncate">{t.name}</span>
            </span>
          ),
          jobs: data.jobs.filter((j) => j.techIds.includes(t.id)),
          techs: false,
          edge: techColor(t, t.id) as string | undefined,
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
          edge: undefined as string | undefined,
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
        {/* Wraps from 1024 px: beside the 256 px sidebar one row needs ~1080 px. */}
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="flex gap-2">
            <ViewSwitch value={data.view} />
            <ParamSegmented
              param="view"
              label="Calendar view"
              value={data.view}
              className="min-w-0 flex-1 lg:w-72 lg:flex-none"
              segments={[
                { value: "day", label: "Day" },
                { value: "3day", label: "3 days" },
                { value: "week", label: "Week" },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <Link
              className={navBtn}
              aria-label="Previous"
              href={hrefWith(sp, { date: addDaysToKey(data.date, -step) })}
              replace
              transitionTypes={["nav-back"]}
            >
              <ChevronLeft size={18} />
            </Link>
            <Link
              className={buttonClass({
                variant: "secondary",
                size: "md",
                className: "shrink-0 px-4",
              })}
              href={hrefWith(sp, { date: null })}
              replace
              transitionTypes={
                data.date < data.todayKey
                  ? ["nav-forward"]
                  : data.date > data.todayKey
                    ? ["nav-back"]
                    : undefined
              }
            >
              Today
            </Link>
            <Link
              className={navBtn}
              aria-label="Next"
              href={hrefWith(sp, { date: addDaysToKey(data.date, step) })}
              replace
              transitionTypes={["nav-forward"]}
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
            {/* The board, full screen, where the page shows the list (< 1024 px). */}
            <FullscreenButton
              hub="board"
              label="Full screen board"
              icon={<Maximize2 size={18} aria-hidden />}
              className="lg:hidden"
            />
          </div>
          <div className="hidden lg:ml-auto lg:block">
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
        {/* The board from 1024 px; full screen on touch (FullscreenHub "board"). */}
        <ScheduleBoard data={data} colorBy={colorBy} />

        <div className="enter-stagger flex flex-col gap-[var(--section-gap)] lg:hidden">
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
            <ListSection variant="title" header="Needs a technician">
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
                variant="title"
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
                    edge={s.edge}
                    trailing={assign(j)}
                  />
                ))}
              </ListSection>
            ))}
          {/* Empty days collapse into one row instead of a card each (QA T4-31). */}
          {data.view !== "day" &&
            emptyDays.length > 0 &&
            data.jobs.length > 0 && (
              <ListSection variant="title" header="No jobs">
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
            variant="title"
            header="Unscheduled"
            trailing={
              <span className="num text-footnote text-label-2">
                {data.unscheduled.length}
              </span>
            }
          >
            {data.unscheduled.length === 0 ? (
              <p className="px-4 py-3 text-subhead text-label-2">
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
            <ListSection variant="title" header="On hold">
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
              variant="title"
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
      </Page>
    </PageTransition>
  );
}
