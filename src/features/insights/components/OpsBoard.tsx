import {
  CalendarClock,
  CalendarX,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  Inbox,
  ListTodo,
  PhoneCall,
  Receipt,
  ShieldCheck,
  Timer,
  UserRoundX,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFeatureFlags } from "@/lib/settings";
import { formatTime, formatTimeRange } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Avatar } from "@/ui/components/Avatar";
import { Card } from "@/ui/components/Card";
import { ProgressRing } from "@/ui/components/charts";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection, SectionHeader } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatCard } from "@/ui/components/StatCard";
import { cx } from "@/ui/cx";
import type { Tone } from "@/ui/tone";
import { toneStyle } from "@/ui/tone";
import { navAccess } from "../nav-access";
import { getOpsData, getTechDay, type JobBrief, type TechDay } from "../ops";
import { AssignJobButton, Elapsed } from "./islands";

const ACTIVE = new Set(["en_route", "arrived", "in_progress"]);
const DONE = new Set(["completed", "closed"]);

function waitText(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ${mins % 60} m`;
  return `${Math.floor(mins / 1440)} d`;
}

/** One tech's day: avatar (green ring when clocked in), done/total, a segment per job and what's now/next. */
function TechDayCard({
  t,
  tz,
  href,
}: {
  t: TechDay;
  tz: string;
  href: string;
}) {
  const done = t.jobs.filter((j) => DONE.has(j.status)).length;
  const now = t.jobs.find((j) => ACTIVE.has(j.status));
  const next = t.jobs.find((j) => !DONE.has(j.status) && !ACTIVE.has(j.status));
  const line = now
    ? { lead: "Now", text: now.title ?? now.number }
    : next
      ? {
          lead: next.windowStart ? formatTime(next.windowStart, tz) : "Next",
          text: next.title ?? next.number,
        }
      : null;
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className="card pressable hover-lift flex w-[232px] shrink-0 snap-start flex-col gap-3 p-3.5 outline-offset-2 md:w-auto"
    >
      <span className="flex items-center gap-2.5">
        <Avatar name={t.name} seed={t.id} size={36} presence={t.clockedIn} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-headline text-label">
            {t.name}
          </span>
          <span className="block text-footnote text-label-2">
            {t.clockedIn ? "On the clock" : "Off the clock"}
          </span>
        </span>
        <span className="num text-subhead font-semibold text-label">
          {done}
          <span className="text-label-2">/{t.jobs.length}</span>
        </span>
      </span>
      <span aria-hidden className="flex h-1.5 gap-1">
        {t.jobs.length === 0 ? (
          <span className="flex-1 rounded-full bg-fill" />
        ) : (
          t.jobs.map((j) => (
            <span
              key={j.id}
              className={cx(
                "flex-1 rounded-full",
                DONE.has(j.status)
                  ? "bg-[var(--sys-green)]"
                  : ACTIVE.has(j.status)
                    ? "bg-accent"
                    : "bg-fill",
              )}
            />
          ))
        )}
      </span>
      <span className="truncate text-subhead text-label-2">
        {line ? (
          <>
            <span
              className={cx(
                "font-semibold",
                now ? "text-accent-text" : "text-label",
              )}
            >
              {line.lead}
            </span>{" "}
            · {line.text}
          </>
        ) : t.jobs.length ? (
          "Day done"
        ) : (
          "No jobs today"
        )}
      </span>
    </Link>
  );
}

/** A "Needs attention" row: tone tile, title, why, the count and a verb for the quick action. */
function AttentionRow({
  a,
}: {
  a: {
    title: string;
    subtitle?: string;
    count: number;
    href: string;
    icon: ReactNode;
    tone: Tone;
    critical?: boolean;
    detail?: ReactNode;
    verb: string;
  };
}) {
  return (
    <Link
      href={a.href}
      transitionTypes={["nav-forward"]}
      className="row-press flex min-h-[60px] items-center gap-3 px-4 py-2.5 outline-offset-[-2px]"
    >
      <span
        className="icon-tile tone-bg flex size-9 shrink-0 items-center justify-center rounded-[10px]"
        style={toneStyle(a.tone)}
      >
        {a.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-body text-label">{a.title}</span>
          <span
            className={cx(
              "num inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-pill px-1.5 text-footnote font-bold",
              a.critical ? "bg-danger-fill text-white" : "tint-bg tint-fg",
            )}
            style={a.critical ? undefined : toneStyle("gray")}
          >
            {a.count}
          </span>
        </span>
        {(a.subtitle || a.detail) && (
          <span className="flex min-w-0 items-center gap-1.5 truncate text-subhead text-label-2">
            {a.detail && (
              <span className="num shrink-0 font-medium text-label">
                {a.detail}
              </span>
            )}
            {a.detail && a.subtitle && <span aria-hidden>·</span>}
            {a.subtitle && <span className="truncate">{a.subtitle}</span>}
          </span>
        )}
      </span>
      <span
        className="tint-bg tint-fg hidden h-8 shrink-0 items-center rounded-pill px-3 sm:inline-flex text-subhead font-semibold"
        style={toneStyle("accent")}
      >
        {a.verb}
      </span>
      <ChevronRight
        aria-hidden
        size={18}
        className="shrink-0 text-label-3 sm:hidden"
      />
    </Link>
  );
}

function windowText(j: JobBrief, tz: string): string {
  if (j.windowStart && j.windowEnd)
    return formatTimeRange(j.windowStart, j.windowEnd, tz);
  if (j.windowStart) return formatTime(j.windowStart, tz);
  return "No time set";
}

/**
 * Office "Today / Ops" board (SPEC M20 office dashboard). Rendered by the S54 slot on
 * /today and by /insights?view=ops. Every row links to the filtered list behind it
 * (BUILD_PLAN Appendix A). A row or tile only shows when the viewer can open the
 * page behind it — the same rule as the nav (permission + feature flag), so office
 * never lands on a page it can't see (QA2 T4-09).
 */
export async function OpsBoard({ user }: { user: SessionUser }) {
  const [d, flags, techs] = await Promise.all([
    getOpsData(user),
    getFeatureFlags(),
    getTechDay().catch(() => [] as TechDay[]),
  ]);
  const canOpen = navAccess(user, flags);
  // Today's jobs open the day schedule; without the calendar, the jobs list.
  const dayNav = canOpen("schedule") ? "schedule" : "jobs";
  const dayHref = dayNav === "schedule" ? "/schedule?view=day" : "/jobs";
  const outboxScope = user.perms.has("messages.outbox_all") ? "all" : "mine";
  const outboxCount = outboxScope === "all" ? d.outbox.all : d.outbox.mine;
  const items: {
    key: string;
    /** Nav item key of the page behind the row; hidden when the viewer can't open it. */
    nav: string;
    title: string;
    subtitle?: string;
    count: number;
    href: string;
    icon: ReactNode;
    tone: Tone;
    critical?: boolean;
    detail?: ReactNode;
    /** Quick-action verb on the row. */
    verb: string;
  }[] = [
    {
      key: "breached",
      verb: "Reply",
      nav: "leads",
      title: `Leads not contacted > ${d.slaMinutes} min`,
      count: d.leadsBreached,
      href: "/leads?filter=breached",
      icon: <Timer size={17} aria-hidden />,
      tone: "red",
      critical: true,
    },
    {
      key: "late",
      verb: "Check",
      nav: dayNav,
      title: "Running late",
      subtitle: "Window ended, tech not on site",
      count: d.runningLate.length,
      href: dayHref,
      icon: <Clock size={17} aria-hidden />,
      tone: "red",
      critical: true,
    },
    {
      key: "unassigned",
      verb: "Assign",
      nav: "jobs",
      title: "Unassigned today and tomorrow",
      count: d.unassigned.length,
      href: "/jobs?unassigned=1",
      icon: <UserRoundX size={17} aria-hidden />,
      tone: "orange",
    },
    {
      key: "unconfirmed",
      verb: "Confirm",
      nav: "jobs",
      title: "Unconfirmed tomorrow",
      count: d.unconfirmedTomorrow.length,
      href: "/jobs?unconfirmed=1",
      icon: <CalendarX size={17} aria-hidden />,
      tone: "orange",
    },
    {
      key: "approvals",
      verb: "Review",
      nav: "approvals",
      title: "Approvals waiting",
      subtitle: "Vehicle logs, receipts, cancels",
      count: d.approvals,
      href: "/approvals",
      icon: <ShieldCheck size={17} aria-hidden />,
      tone: "indigo",
    },
    {
      key: "outbox",
      verb: "Send",
      nav: "messages",
      title: outboxScope === "all" ? "Outbox (everyone)" : "My outbox",
      subtitle: "Texts waiting for a tap to send",
      count: outboxCount,
      href: `/messages/outbox?scope=${outboxScope}`,
      icon: <Inbox size={17} aria-hidden />,
      tone: "blue",
    },
    {
      key: "deposits",
      verb: "Collect",
      nav: "jobs",
      title: "Deposits unpaid",
      count: d.depositsUnpaid.count,
      href: "/jobs?depositDue=1",
      icon: <Wallet size={17} aria-hidden />,
      tone: "green",
      detail: d.depositsUnpaid.cents ? (
        <MoneyText cents={d.depositsUnpaid.cents} compactWhole />
      ) : undefined,
    },
    {
      key: "overdue",
      verb: "Remind",
      nav: "invoices",
      title: "Overdue invoices",
      count: d.overdueInvoices.count,
      href: "/invoices?status=overdue",
      icon: <Receipt size={17} aria-hidden />,
      tone: "red",
      detail: d.overdueInvoices.cents ? (
        <MoneyText cents={d.overdueInvoices.cents} compactWhole />
      ) : undefined,
    },
    {
      key: "estimates",
      verb: "Follow up",
      nav: "estimates",
      title: "Estimates to follow up",
      subtitle: "Sent 2+ days ago or expiring soon",
      count: d.estimatesFollowUp,
      href: "/estimates?status=sent,viewed",
      icon: <FileText size={17} aria-hidden />,
      tone: "purple",
    },
    {
      key: "tasks",
      verb: "Open",
      nav: "tasks",
      title: d.tasks.scopeAll ? "Tasks due today (all)" : "My tasks due today",
      subtitle: d.tasks.overdue ? `${d.tasks.overdue} overdue` : undefined,
      count: d.tasks.dueToday + d.tasks.overdue,
      href: `/tasks?scope=${d.tasks.scopeAll ? "all" : "mine"}`,
      icon: <ListTodo size={17} aria-hidden />,
      tone: "teal",
      critical: d.tasks.overdue > 0,
    },
    {
      key: "callbacks",
      verb: "Call",
      nav: "tasks",
      title: "Customers to call back",
      subtitle: "Flagged receipts and low ratings",
      count: d.callbacks,
      href: "/tasks?scope=all&kind=callback_customer",
      icon: <PhoneCall size={17} aria-hidden />,
      tone: "pink",
      critical: d.callbacks > 0,
    },
  ];
  const attention = items.filter((a) => canOpen(a.nav));
  const open = attention.filter((a) => a.count > 0);
  const clear = attention.filter((a) => a.count === 0);
  const progress = d.todayJobs.total ? d.todayJobs.done / d.todayJobs.total : 0;

  const oldest = d.newLeads[0];
  const oldestMins = oldest
    ? Math.max(
        0,
        Math.floor((d.now.getTime() - oldest.createdAt.getTime()) / 60_000),
      )
    : 0;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="enter-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          size="md"
          label="Today's jobs"
          value={
            <span className="flex items-center gap-3">
              <span>
                {d.todayJobs.done}
                <span className="text-label-2">/{d.todayJobs.total}</span>
              </span>
              <ProgressRing
                value={progress}
                label="Jobs done today"
                size={30}
                stroke={4}
                showValue={false}
                tone="green"
              />
            </span>
          }
          footnote={`${d.todayJobs.inProgress} in progress`}
          href={canOpen(dayNav) ? dayHref : undefined}
        />
        <StatCard
          size="md"
          label="New leads"
          value={d.newLeadCount}
          footnote={
            oldest ? (
              <span
                className={cx(
                  oldestMins >= d.slaMinutes && "font-medium text-danger",
                )}
              >
                Oldest {waitText(oldestMins)}
              </span>
            ) : (
              "None waiting"
            )
          }
          href={canOpen("leads") ? "/leads?status=new" : undefined}
        />
        <StatCard
          size="md"
          label="Overdue AR"
          value={<MoneyText cents={d.overdueInvoices.cents} compactWhole />}
          footnote={`${d.overdueInvoices.count} invoice${d.overdueInvoices.count === 1 ? "" : "s"}`}
          href={canOpen("invoices") ? "/invoices?status=overdue" : undefined}
        />
        {canOpen("approvals") ? (
          <StatCard
            size="md"
            label="Approvals"
            value={d.approvals}
            footnote={d.approvals ? "Waiting for you" : "Nothing waiting"}
            href="/approvals"
          />
        ) : (
          <StatCard
            size="md"
            label={d.tasks.scopeAll ? "Tasks due" : "My tasks due"}
            value={d.tasks.dueToday + d.tasks.overdue}
            footnote={
              d.tasks.overdue ? `${d.tasks.overdue} overdue` : "Due today"
            }
            href={`/tasks?scope=${d.tasks.scopeAll ? "all" : "mine"}`}
          />
        )}
      </div>

      {techs.length > 0 && (
        <section aria-labelledby="techs-h">
          <SectionHeader
            id="techs-h"
            title="Techs today"
            subtitle={`${techs.filter((t) => t.clockedIn).length} of ${techs.length} on the clock`}
            actionHref={canOpen(dayNav) ? dayHref : undefined}
            actionLabel={dayNav === "schedule" ? "Schedule" : "Jobs"}
          />
          <div className="-mx-[var(--gutter)] flex snap-x scroll-px-[var(--gutter)] gap-3 overflow-x-auto px-[var(--gutter)] pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:overflow-visible md:px-0">
            {techs.map((t) => (
              <TechDayCard
                key={t.id}
                t={t}
                tz={d.tz}
                href={canOpen(dayNav) ? dayHref : "/jobs"}
              />
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 gap-y-[var(--section-gap)] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-[var(--section-gap)]">
          <section aria-labelledby="attn-h" className="order-1 xl:order-none">
            <SectionHeader
              id="attn-h"
              title="Needs attention"
              subtitle={
                open.length
                  ? `${open.length} thing${open.length === 1 ? "" : "s"} waiting on the office`
                  : undefined
              }
            />
            <Card padding="none" className="overflow-hidden">
              {open.length === 0 ? (
                <div>
                  <ListRow
                    icon={<ClipboardCheck size={17} aria-hidden />}
                    iconTone="green"
                    title="All caught up"
                    subtitle="No leads, jobs or money waiting on the office"
                  />
                </div>
              ) : (
                <ul className="divide-y divide-[var(--sep)] [&>li]:ml-0">
                  {open.map((a) => (
                    <li key={a.key}>
                      <AttentionRow a={a} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {clear.length > 0 && open.length > 0 && (
              <p className="px-4 pt-2 text-footnote text-label-2">
                Clear: {clear.map((c) => c.title.toLowerCase()).join(" · ")}.
              </p>
            )}
          </section>

          {d.unconfirmedTomorrow.length > 0 && (
            <ListSection
              className="order-4 xl:order-none"
              variant="title"
              header="Unconfirmed tomorrow"
              footer="Reminder texts go out automatically; call anyone who hasn't confirmed by the afternoon."
            >
              {d.unconfirmedTomorrow.map((j) => (
                <ListRow
                  key={j.id}
                  title={j.customer ?? j.number}
                  subtitle={`${j.tech ?? "Unassigned"} · ${windowText(j, d.tz)}`}
                  href={`/jobs/${j.id}`}
                />
              ))}
            </ListSection>
          )}
        </div>

        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-[var(--section-gap)]">
          {d.newLeads.length > 0 && canOpen("leads") && (
            <ListSection
              className="order-2 xl:order-none"
              variant="title"
              header="New leads waiting"
              action={
                <Link
                  href="/leads?status=new"
                  transitionTypes={["nav-forward"]}
                  className="hit-44 text-subhead font-semibold text-accent-text"
                >
                  See all
                </Link>
              }
            >
              {d.newLeads.map((l) => (
                <ListRow
                  key={l.id}
                  leading={<Avatar name={l.name} seed={l.id} size={32} />}
                  title={l.name}
                  subtitle={
                    [l.service, l.source].filter(Boolean).join(" · ") ||
                    undefined
                  }
                  detail={
                    <Elapsed
                      since={l.createdAt.toISOString()}
                      serverNow={d.now.toISOString()}
                      slaMinutes={d.slaMinutes}
                    />
                  }
                  href={`/leads/${l.id}`}
                />
              ))}
            </ListSection>
          )}

          {d.runningLate.length > 0 && (
            <ListSection
              className="order-3 xl:order-none"
              variant="title"
              header="Running late"
            >
              {d.runningLate.map((j) => (
                <ListRow
                  key={j.id}
                  icon={<CalendarClock size={17} aria-hidden />}
                  iconTone="red"
                  title={j.customer ?? j.number}
                  subtitle={`${j.tech ?? "Unassigned"} · window ${windowText(j, d.tz)}`}
                  href={`/jobs/${j.id}`}
                />
              ))}
            </ListSection>
          )}

          {d.unassigned.length > 0 && (
            <ListSection
              className="order-5 xl:order-none"
              variant="title"
              header="Unassigned jobs"
            >
              {d.unassigned.map((j) => (
                <div
                  key={j.id}
                  className="list-row flex min-h-11 items-center gap-3 px-4 py-2"
                >
                  <Link
                    href={`/jobs/${j.id}`}
                    transitionTypes={["nav-forward"]}
                    className="flex min-w-0 flex-1 flex-col"
                  >
                    <span className="truncate text-body">
                      {j.customer ?? j.title ?? j.number}
                    </span>
                    <span className="truncate text-subhead text-label-2">
                      {j.number} · {windowText(j, d.tz)}
                    </span>
                  </Link>
                  <AssignJobButton
                    jobId={j.id}
                    label="Assign"
                    variant="tinted"
                  />
                </div>
              ))}
            </ListSection>
          )}
        </div>
      </div>

      {d.todayJobs.total === 0 && open.length === 0 && (
        <EmptyState
          compact
          title="A quiet day"
          message="No jobs on the schedule today. New bookings and leads appear here as they come in."
        />
      )}
    </div>
  );
}
