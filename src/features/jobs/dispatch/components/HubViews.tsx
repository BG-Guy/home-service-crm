import { CalendarClock, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { experienceLabel } from "@/lib/tenure";
import { formatDateKey, formatTime } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Card } from "@/ui/components/Card";
import { EmptyState } from "@/ui/components/EmptyState";
import { IconButton } from "@/ui/components/IconButton";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListSection, SectionHeader } from "@/ui/components/List";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { type TripStep, TripTimeline } from "@/ui/components/Timeline";
import { cx } from "@/ui/cx";
import { Morph } from "@/ui/motion/Morph";
import { PushLink } from "@/ui/motion/PageTransition";
import { hubHref } from "../href";
import type { Recommendation } from "../recommend";
import type { HubData, HubJob, HubTech, HubTechState } from "../types";
import { HubDateBar, SelectTech } from "./DispatchHub";
import { HubAssignButton } from "./HubAssignButton";

// Server-rendered pieces of the Assign hub: the left column (day, job being
// assigned, best matches, technicians, jobs that need a tech) and one panel per
// technician (profile facts, the day as a trip timeline, the assign action).

const STATE: Record<
  HubTechState,
  { label: string; tone: "green" | "blue" | "gray" }
> = {
  on_job: { label: "On a job", tone: "green" },
  on_clock: { label: "On the clock", tone: "blue" },
  off: { label: "Off", tone: "gray" },
};
const DONE = new Set(["completed", "closed"]);
const LIVE = new Set(["en_route", "arrived", "in_progress"]);

const hoursLabel = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
export const loadLine = (t: HubTech) =>
  t.jobs.length === 0
    ? "Nothing booked"
    : `${t.jobs.length} job${t.jobs.length === 1 ? "" : "s"} · ${hoursLabel(t.hours)}`;

function dayTitle(d: HubData) {
  return d.isToday
    ? "Today's route"
    : `Route · ${formatDateKey(d.date, "en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

function windowText(j: HubJob, tz: string) {
  if (!j.start) return "No time yet";
  const end = j.end ? formatTime(j.end, tz) : null;
  return end ? `${formatTime(j.start, tz)} – ${end}` : formatTime(j.start, tz);
}

/** Thin load bar in the tech's color (share of an 8 h day). */
function LoadBar({ t, className }: { t: HubTech; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "block h-1 overflow-hidden rounded-full bg-fill",
        className,
      )}
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.max(t.jobs.length ? 6 : 0, Math.round(t.load * 100))}%`,
          background: t.color,
        }}
      />
    </span>
  );
}

function RecChip({ r }: { r: Recommendation }) {
  return (
    <Pill
      tone={r.rank === 1 ? "accent" : r.fits ? "gray" : "orange"}
      size="sm"
      dot={false}
    >
      #{r.rank}
      {r.extraMiles != null ? ` · +${r.extraMiles} mi` : ""}
    </Pill>
  );
}

/* ------------------------------------------------------------------ list column */

export function HubList({
  data,
  recByTech,
}: {
  data: HubData;
  recByTech: Map<string, Recommendation>;
}) {
  const top = data.recs.slice(0, 3);
  const byId = new Map(data.techs.map((t) => [t.id, t]));
  const onClock = data.techs.filter((t) => t.clockedIn).length;
  return (
    <>
      <HubDateBar date={data.date} todayKey={data.todayKey} />

      {data.job && <AssigningCard data={data} job={data.job} />}

      {data.job && top.length > 0 && (
        <section aria-labelledby="best-h" className="flex flex-col gap-3">
          <SectionHeader
            id="best-h"
            title="Best matches"
            subtitle="Ranked by extra driving, free time, skills and today's load"
          />
          <ol className="list-card">
            {top.map((r) => {
              const t = byId.get(r.techId);
              if (!t) return null;
              return (
                <li key={r.techId}>
                  <SelectTech
                    id={t.id}
                    label={`#${r.rank} ${t.name}: ${r.reasons.join(", ")}`}
                    className="list-row min-h-[64px] px-4 py-3"
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "num flex size-7 shrink-0 items-center justify-center rounded-full text-footnote font-bold",
                        r.rank === 1
                          ? "bg-accent-fill text-on-accent"
                          : "bg-fill text-label",
                      )}
                    >
                      {r.rank}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-headline">{t.name}</span>
                        {r.rank === 1 && (
                          <Pill tone="accent" size="sm" dot={false}>
                            Recommended
                          </Pill>
                        )}
                      </span>
                      <span className="line-clamp-2 text-footnote text-label-2">
                        {r.reasons.join(" · ")}
                      </span>
                    </span>
                  </SelectTech>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="techs-h" className="flex flex-col gap-3">
        <SectionHeader
          id="techs-h"
          title="Technicians"
          subtitle={
            data.isToday
              ? `${onClock} of ${data.techs.length} on the clock`
              : `${data.techs.length} active`
          }
        />
        {data.techs.length === 0 ? (
          <Card>
            <EmptyState
              compact
              title="No technicians yet"
              message="Invite a tech from Team to start assigning jobs."
              action={
                <Link
                  href="/team"
                  className="text-subhead font-semibold text-accent-text"
                >
                  Open Team
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="list-card">
            {data.techs.map((t) => {
              const r = recByTech.get(t.id);
              const st = STATE[t.state];
              return (
                <li key={t.id}>
                  <SelectTech
                    id={t.id}
                    label={`${t.name}, ${st.label}, ${loadLine(t)}`}
                    className="list-row min-h-[72px] py-3 pl-4 pr-3"
                  >
                    <Morph name={`tech-${t.id}-avatar`}>
                      <span className="inline-block">
                        <Avatar
                          name={t.name}
                          seed={t.id}
                          src={t.avatarUrl}
                          size={44}
                          presence={t.clockedIn && data.isToday}
                        />
                      </span>
                    </Morph>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-headline">{t.name}</span>
                      </span>
                      <span className="num truncate text-footnote text-label-2">
                        {loadLine(t)}
                      </span>
                      <LoadBar t={t} className="mt-0.5 max-w-40" />
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <Pill tone={st.tone} size="sm">
                        {st.label}
                      </Pill>
                      {r && <RecChip r={r} />}
                    </span>
                  </SelectTech>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!data.job && (
        <ListSection
          variant="title"
          header="Needs a tech"
          subtitle={
            data.toAssign.length
              ? "Pick a job to see who fits best"
              : "Every job on this day has a technician"
          }
        >
          {data.toAssign.length === 0 ? (
            <p className="px-4 py-4 text-subhead text-label-2">
              Nothing waiting. New jobs without a tech show up here.
            </p>
          ) : (
            data.toAssign.slice(0, 12).map((j) => (
              <Link
                key={j.id}
                href={hubHref({ date: data.date, job: j.id }, null)}
                className="row-press list-row flex min-h-[64px] items-center gap-3 px-4 py-3"
              >
                <span
                  aria-hidden
                  className="icon-tile size-9 shrink-0 items-center justify-center rounded-control bg-[color-mix(in_srgb,var(--accent)_var(--tint-a),transparent)] text-accent-text"
                >
                  <CalendarClock size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-headline">
                    {j.number} · {j.title}
                  </span>
                  <span className="truncate text-footnote text-label-2">
                    {j.start ? windowText(j, data.tz) : "No date yet"} ·{" "}
                    {j.address}
                  </span>
                </span>
                <Pill tone="accent" size="sm" dot={false}>
                  Assign
                </Pill>
              </Link>
            ))
          )}
        </ListSection>
      )}
    </>
  );
}

function AssigningCard({ data, job }: { data: HubData; job: HubJob }) {
  return (
    <div className="flex flex-col gap-2">
      {data.movedToJobDay && (
        <Banner tone="info">
          {job.number} is booked for{" "}
          {formatDateKey(data.date, "en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
          , so the hub shows that day.
        </Banner>
      )}
      <Card padding="md" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-footnote font-semibold text-label-2">
            Assigning
          </span>
          <Link
            href={hubHref({ date: data.date, job: null })}
            className="hit-44 text-subhead font-semibold text-accent-text"
          >
            Change
          </Link>
        </div>
        <PushLink
          href={`/jobs/${job.id}`}
          className="text-headline hover:underline"
        >
          {job.number} · {job.title}
        </PushLink>
        <div className="flex flex-col gap-1 text-subhead text-label-2">
          <span className="flex items-center gap-1.5">
            <CalendarClock size={15} aria-hidden className="shrink-0" />
            <span className="num">
              {job.start
                ? windowText(job, data.tz)
                : "No time yet: each tech gets a suggested slot"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin size={15} aria-hidden className="shrink-0" />
            <span className="truncate">
              {job.customerName} · {job.address}
            </span>
          </span>
        </div>
        {job.lat == null && (
          <p className="text-footnote text-label-2">
            No location on this job, so techs are ranked by load.
          </p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ tech panel */

export function TechPanel({
  t,
  data,
  rec,
}: {
  t: HubTech;
  data: HubData;
  rec: Recommendation | undefined;
}) {
  const st = STATE[t.state];
  const job = data.job;
  const assigned = job ? job.assigneeIds.includes(t.id) : false;
  const replacing = job
    ? data.techs
        .filter((x) => job.assigneeIds.includes(x.id) && x.id !== t.id)
        .map((x) => x.name)
    : [];
  const suggested =
    job && !job.start && rec?.suggestedStart != null
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: data.tz,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(rec.suggestedStart)
      : null;
  const canAct =
    !!job && !assigned && (!!job.start || (data.canReschedule && !!suggested));
  const action =
    job && canAct ? (
      <HubAssignButton
        jobId={job.id}
        jobNumber={job.number}
        techId={t.id}
        techName={t.name}
        date={data.date}
        start={job.start ? null : suggested}
        minutes={job.minutes}
        replacing={replacing}
        block
      />
    ) : null;
  const whenText = job
    ? job.start
      ? windowText(job, data.tz)
      : rec?.suggestedStart != null
        ? `Suggested ${formatTime(rec.suggestedStart, data.tz)}`
        : "No free slot"
    : "";

  // The day as a trip timeline, with the job being assigned dropped into its slot.
  const steps: TripStep[] = t.jobs.map((s) => ({
    id: s.id,
    state: DONE.has(s.status)
      ? "done"
      : LIVE.has(s.status)
        ? "current"
        : "upcoming",
    time: s.start ? formatTime(s.start, data.tz) : "Any time",
    title: (
      <span>
        <span className="num text-label-2">{s.seq}.</span> {s.title}
      </span>
    ),
    body: (
      <>
        <span className="block">
          {s.number} · {s.address}
        </span>
        <span className="mt-1 inline-flex">
          <StatusPill kind="job" status={s.status} size="sm" live={false} />
        </span>
      </>
    ),
    href: `/jobs/${s.id}`,
  }));
  if (job && rec && !assigned) {
    const at =
      rec.insertAfter === "start"
        ? 0
        : steps.findIndex((s) => s.id === rec.insertAfter) + 1;
    steps.splice(Math.max(0, at), 0, {
      id: `new-${job.id}`,
      state: "upcoming",
      time:
        job.start != null
          ? formatTime(job.start, data.tz)
          : rec.suggestedStart != null
            ? formatTime(rec.suggestedStart, data.tz)
            : "—",
      title: (
        <span className="font-semibold text-accent-text">
          {job.number} · {job.title}
        </span>
      ),
      body: (
        <>
          <span className="block">
            {rec.fits ? job.address : `${job.address} · doesn't fit cleanly`}
          </span>
          <span className="mt-1 inline-flex">
            <Pill tone="accent" size="sm" dot={false}>
              New stop
            </Pill>
          </span>
        </>
      ),
    });
  }

  const details = [
    {
      key: "exp",
      label: "Experience",
      value: experienceLabel(t.experienceYears) ?? "",
    },
    {
      key: "tenure",
      label: "At the company",
      value: t.tenure
        ? `${t.tenure}${t.hireDate ? ` · ${formatDateKey(t.hireDate, "en-US", { month: "short", year: "numeric" })}` : ""}`
        : "",
    },
    // ⚖️ Age is display-only and only present for team managers (see queries.ts).
    ...(t.age != null
      ? [{ key: "age", label: "Age", value: String(t.age) }]
      : []),
    {
      key: "phone",
      label: "Mobile",
      value: t.phone ? formatPhoneDisplay(t.phone) : "",
      href: t.phone ? `tel:${t.phone}` : undefined,
    },
    { key: "veh", label: "Vehicle", value: t.vehicle ?? "" },
    {
      key: "skills",
      label: "Skills",
      stacked: t.skills.length > 2,
      value: t.skills.join(", "),
    },
    { key: "start", label: "Day starts from", value: t.startLabel ?? "" },
  ];

  return (
    <>
      <Card padding="lg" className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {/* Phone: the list avatar morphs into this one (M3). Desktop shows both
              at once, so only the phone copy carries the shared name. */}
          <span className="md:hidden">
            <Morph name={`tech-${t.id}-avatar`}>
              <span className="inline-block">
                <Avatar
                  name={t.name}
                  seed={t.id}
                  src={t.avatarUrl}
                  size={64}
                  presence={t.clockedIn && data.isToday}
                />
              </span>
            </Morph>
          </span>
          <span className="hub-wide">
            <Avatar
              name={t.name}
              seed={t.id}
              src={t.avatarUrl}
              size={56}
              presence={t.clockedIn && data.isToday}
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="truncate text-title2 font-bold">{t.name}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={st.tone} size="sm">
                {st.label}
              </Pill>
              <span className="num text-footnote text-label-2">
                {loadLine(t)}
              </span>
            </div>
          </div>
          {t.phone && (
            <div className="flex shrink-0 gap-2 hub-wide">
              <IconButton
                label={`Call ${t.name}`}
                variant="secondary"
                size={40}
                href={`tel:${t.phone}`}
              >
                <Phone size={18} aria-hidden />
              </IconButton>
              <IconButton
                label={`Text ${t.name}`}
                variant="secondary"
                size={40}
                href={`sms:${t.phone}`}
              >
                <MessageCircle size={18} aria-hidden />
              </IconButton>
            </div>
          )}
        </div>
        <LoadBar t={t} />
      </Card>

      {job && rec && (
        <Card
          padding="md"
          className="flex flex-col gap-3"
          aria-label="Recommendation"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-headline">
              {assigned ? `On ${job.number}` : `Fit for ${job.number}`}
            </span>
            <RecChip r={rec} />
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {rec.reasons.map((x) => (
              <li
                key={x}
                className="rounded-pill bg-fill-2 px-2.5 py-1 text-footnote text-label"
              >
                {x}
              </li>
            ))}
          </ul>
          {assigned ? (
            <p className="text-subhead text-label-2">
              {t.name.split(" ")[0]} is already on this job.
            </p>
          ) : action ? (
            <div className="hub-wide">{action}</div>
          ) : (
            <p className="text-subhead text-label-2">
              {job.start
                ? "You can't assign this job."
                : "No free slot that day. Pick another day or open the job to set a time."}
            </p>
          )}
        </Card>
      )}

      <section
        aria-labelledby={`route-${t.id}`}
        className="flex flex-col gap-3"
      >
        <SectionHeader id={`route-${t.id}`} title={dayTitle(data)} />
        <Card padding="md">
          {steps.length ? (
            <TripTimeline steps={steps} label={dayTitle(data)} live={false} />
          ) : (
            <p className="py-2 text-subhead text-label-2">
              Nothing booked{data.isToday ? " today" : " that day"}.
            </p>
          )}
        </Card>
      </section>

      <section
        aria-labelledby={`details-${t.id}`}
        className="flex flex-col gap-3"
      >
        <SectionHeader id={`details-${t.id}`} title="Details" />
        <KeyValueList items={details} />
      </section>

      {action && (
        <BottomBar
          className="md:hidden"
          label="Assign"
          summary={<BarSummary title={job?.number ?? ""} subtitle={whenText} />}
          action={action}
        />
      )}
    </>
  );
}

/** Phone tech view nav bar: call button. */
export function PhoneTrailing({ t }: { t: HubTech }) {
  return t.phone ? (
    <IconButton
      label={`Call ${t.name}`}
      variant="plain"
      size={40}
      href={`tel:${t.phone}`}
    >
      <Phone size={20} aria-hidden />
    </IconButton>
  ) : null;
}
