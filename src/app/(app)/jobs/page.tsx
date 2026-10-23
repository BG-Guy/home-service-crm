import { Briefcase } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { JobCards } from "@/features/jobs/components/JobCards";
import { JobListMore } from "@/features/jobs/components/JobListMore";
import { JobRow } from "@/features/jobs/components/JobRow";
import { JobsLayoutSwitch } from "@/features/jobs/components/JobsLayoutSwitch";
import {
  JOBS_LAYOUT_COOKIE,
  parseJobsLayout,
} from "@/features/jobs/components/jobs-layout";
import {
  ParamSegmented,
  ParamSelect,
} from "@/features/jobs/components/ParamControls";
import type { JobStatus } from "@/features/jobs/contracts";
import { JOB_STATUS_ORDER } from "@/features/jobs/machine";
import { canViewAll, listJobs } from "@/features/jobs/queries";
import { techRoster } from "@/features/jobs/schedule-queries";
import type { JobListFilters, JobListItem } from "@/features/jobs/types";
import { requireAnyPerm } from "@/lib/auth/current";
import { addDaysToKey, dateKey, formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Jobs" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

const QUICK: { key: string; label: string; params: Record<string, string> }[] =
  [
    { key: "all", label: "All", params: {} },
    { key: "upcoming", label: "Upcoming", params: { view: "upcoming" } },
    {
      key: "unscheduled",
      label: "Unscheduled",
      params: { status: "unscheduled" },
    },
    {
      key: "active",
      label: "In the field",
      params: { status: "en_route,arrived,in_progress" },
    },
    { key: "on_hold", label: "On hold", params: { status: "on_hold" } },
    { key: "done", label: "Completed", params: { status: "completed,closed" } },
    { key: "cancelled", label: "Cancelled", params: { status: "cancelled" } },
  ];
const TOGGLES: { key: keyof JobListFilters & string; label: string }[] = [
  { key: "callback", label: "Callbacks" },
  { key: "cancelledAfterArrival", label: "Cancelled after arrival" },
  { key: "unassigned", label: "Unassigned" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "noInvoiceAfter48h", label: "No invoice 48 h" },
  { key: "depositDue", label: "Deposit due" },
];

function href(
  sp: SP,
  patch: Record<string, string | null>,
  drop: string[] = [],
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val && k !== "cursor" && !drop.includes(k)) p.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

function groupByDay(items: JobListItem[], tz: string) {
  const today = dateKey(new Date(), tz);
  const groups: { key: string; label: string; items: JobListItem[] }[] = [];
  for (const j of items) {
    const k = j.windowStart ? dateKey(j.windowStart, tz) : "none";
    const label =
      k === "none"
        ? "No date"
        : k === today
          ? "Today"
          : k === addDaysToKey(today, 1)
            ? "Tomorrow"
            : k === addDaysToKey(today, -1)
              ? "Yesterday"
              : formatDateKey(k, "en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(j);
    else groups.push({ key: k, label, items: [j] });
  }
  return groups;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireAnyPerm(["jobs.view_all", "jobs.view_own"]);
  const sp = await searchParams;
  const all = canViewAll(user);
  const mine = one(sp.mine) === "1" || !all;
  const status = one(sp.status)
    .split(",")
    .filter((s): s is JobStatus =>
      (JOB_STATUS_ORDER as readonly string[]).includes(s),
    );
  const view = (one(sp.view) || (mine && !status.length ? "upcoming" : "")) as
    | JobListFilters["view"]
    | "";
  const filters: JobListFilters = {
    status: status.length ? status : undefined,
    tech: one(sp.tech) || undefined,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    mine: one(sp.mine) === "1",
    callback: one(sp.callback) === "1",
    cancelledAfterArrival: one(sp.cancelledAfterArrival) === "1",
    unassigned: one(sp.unassigned) === "1",
    unconfirmed: one(sp.unconfirmed) === "1",
    noInvoiceAfter48h: one(sp.noInvoiceAfter48h) === "1",
    depositDue: one(sp.depositDue) === "1",
    q: one(sp.q) || undefined,
    view: view || undefined,
    cursor: one(sp.cursor) || null,
  };
  const [{ items, nextCursor, tz }, techs, jar] = await Promise.all([
    listJobs(filters),
    all ? techRoster() : Promise.resolve([]),
    cookies(),
  ]);
  const layout = parseJobsLayout(jar.get(JOBS_LAYOUT_COOKIE)?.value);
  const quick =
    QUICK.find(
      (q) =>
        (q.params.status ?? "") === one(sp.status) &&
        (q.params.view ?? "") === one(sp.view),
    )?.key ?? "all";
  const groups = groupByDay(items, tz);
  const filtered =
    !!filters.q ||
    !!status.length ||
    TOGGLES.some((t) => filters[t.key as "callback"]);

  const officeFilters = !(mine && !all);
  // Sticky filter block height (search pill + chip row), so the day headers
  // can stick right under it.
  const barH = officeFilters ? 106 : 60;

  return (
    <PageTransition>
      <LargeTitleHeader
        title={mine && !all ? "My jobs" : "Jobs"}
        trailing={<HeaderActions />}
      >
        {officeFilters ? null : (
          <ParamSegmented
            param="view"
            label="Show"
            value={(view as "upcoming" | "past") || "upcoming"}
            segments={[
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past" },
            ]}
          />
        )}
      </LargeTitleHeader>
      <Page
        className={officeFilters ? "[--jobs-bar:106px]" : "[--jobs-bar:60px]"}
      >
        <div
          className="sticky top-[var(--sticky-top,calc(env(safe-area-inset-top)+44px))] z-[var(--z-sticky)] -mx-[var(--gutter)] flex flex-col bg-bg px-[var(--gutter)] pt-2"
          style={{ height: barH }}
        >
          <SearchField
            param="q"
            defaultValue={filters.q ?? ""}
            placeholder="Job #, customer, address"
          />
          {officeFilters && (
            <ChipRow label="Filter jobs" className="mt-1">
              {QUICK.map((q) => (
                <Chip
                  key={q.key}
                  replace
                  selected={quick === q.key}
                  href={href(sp, {
                    status: q.params.status ?? null,
                    view: q.params.view ?? null,
                  })}
                >
                  {q.label}
                </Chip>
              ))}
            </ChipRow>
          )}
        </div>
        {officeFilters && (
          <div className="mt-1 mb-4 flex flex-col gap-2">
            <ChipRow label="More filters">
              <Chip
                replace
                selected={filters.mine}
                href={href(sp, { mine: filters.mine ? null : "1" })}
              >
                Mine
              </Chip>
              {TOGGLES.map((t) => {
                const on = !!filters[t.key as "callback"];
                return (
                  <Chip
                    key={t.key}
                    replace
                    selected={on}
                    href={href(sp, { [t.key]: on ? null : "1" })}
                  >
                    {t.label}
                  </Chip>
                );
              })}
            </ChipRow>
            {techs.length > 0 && (
              <ParamSelect
                param="tech"
                label="Technician"
                value={filters.tech ?? ""}
                placeholder="All technicians"
                options={techs.map((t) => ({ value: t.id, label: t.name }))}
                className="max-w-xs"
              />
            )}
          </div>
        )}
        {items.length > 0 && (
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-footnote text-label-2">
              {layout === "cards"
                ? "Open a card to peek at the job"
                : "Tap a job to open it"}
            </span>
            <JobsLayoutSwitch value={layout} />
          </div>
        )}
        {items.length === 0 ? (
          <div className="card mt-2">
            <EmptyState
              icon={<Briefcase size={44} />}
              title={
                filtered
                  ? "No matching jobs"
                  : mine
                    ? "No jobs here yet"
                    : "No jobs yet"
              }
              message={
                filtered
                  ? "Try a different search or filter."
                  : mine
                    ? "Jobs assigned to you show up here."
                    : "Create a job from a customer, a lead, or the + button."
              }
              action={
                filtered ? (
                  <Button href="/jobs" variant="secondary">
                    Clear filters
                  </Button>
                ) : user.perms.has("jobs.create") ? (
                  <Button href="/jobs/new">New job</Button>
                ) : undefined
              }
            />
          </div>
        ) : layout === "cards" ? (
          <JobCards
            groups={groups}
            tz={tz}
            filters={{ ...filters, cursor: null }}
            cursor={nextCursor}
            headerTop="calc(var(--sticky-top,calc(env(safe-area-inset-top) + 44px)) + var(--jobs-bar))"
          />
        ) : (
          <div className="enter-stagger flex flex-col gap-5">
            {groups.map((g, i) => (
              <section
                key={g.key}
                aria-labelledby={`day-${g.key}`}
                style={{ ["--i" as string]: Math.min(i, 9) }}
              >
                <h2
                  id={`day-${g.key}`}
                  className="sticky top-[calc(var(--sticky-top,calc(env(safe-area-inset-top)+44px))+var(--jobs-bar))] z-[9] -mx-[var(--gutter)] flex items-baseline justify-between bg-bg px-[calc(var(--gutter)+4px)] pt-2 pb-2 text-title3"
                >
                  {g.label}
                  <span className="num text-subhead font-medium text-label-2">
                    {g.items.length} {g.items.length === 1 ? "job" : "jobs"}
                  </span>
                </h2>
                <div className="list-card">
                  {g.items.map((j) => (
                    <JobRow
                      key={j.id}
                      job={j}
                      tz={tz}
                      showDate={g.key === "none"}
                    />
                  ))}
                </div>
              </section>
            ))}
            {nextCursor && (
              <JobListMore
                filters={{ ...filters, cursor: null }}
                cursor={nextCursor}
                tz={tz}
              />
            )}
          </div>
        )}
      </Page>
    </PageTransition>
  );
}
