import {
  CalendarClock,
  CalendarX,
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
import { AssignJobButton } from "@/features/jobs/slots.client";
import { getFeatureFlags } from "@/lib/settings";
import { formatTime, formatTimeRange } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { ProgressRing } from "@/ui/components/charts";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatCard } from "@/ui/components/StatCard";
import type { Tone } from "@/ui/tone";
import { navAccess } from "../nav-access";
import { getOpsData, type JobBrief } from "../ops";
import { Elapsed } from "./Elapsed";

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
  const [d, flags] = await Promise.all([getOpsData(user), getFeatureFlags()]);
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
  }[] = [
    {
      key: "breached",
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
      nav: "jobs",
      title: "Unassigned today and tomorrow",
      count: d.unassigned.length,
      href: "/jobs?unassigned=1",
      icon: <UserRoundX size={17} aria-hidden />,
      tone: "orange",
    },
    {
      key: "unconfirmed",
      nav: "jobs",
      title: "Unconfirmed tomorrow",
      count: d.unconfirmedTomorrow.length,
      href: "/jobs?unconfirmed=1",
      icon: <CalendarX size={17} aria-hidden />,
      tone: "orange",
    },
    {
      key: "approvals",
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

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Today's jobs"
          value={
            <span className="flex items-center gap-3">
              {d.todayJobs.done}/{d.todayJobs.total}
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
          label="New leads"
          value={d.newLeadCount}
          footnote={
            d.leadsBreached
              ? `${d.leadsBreached} past ${d.slaMinutes} min`
              : `None waiting over ${d.slaMinutes} min`
          }
          href={canOpen("leads") ? "/leads?status=new" : undefined}
        />
        {canOpen("approvals") ? (
          <StatCard
            label="Approvals"
            value={d.approvals}
            footnote={d.approvals ? "Waiting for you" : "Nothing waiting"}
            href="/approvals"
          />
        ) : (
          <StatCard
            label={d.tasks.scopeAll ? "Tasks due" : "My tasks due"}
            value={d.tasks.dueToday + d.tasks.overdue}
            footnote={
              d.tasks.overdue ? `${d.tasks.overdue} overdue` : "Due today"
            }
            href={`/tasks?scope=${d.tasks.scopeAll ? "all" : "mine"}`}
          />
        )}
        <StatCard
          label="Overdue AR"
          value={<MoneyText cents={d.overdueInvoices.cents} compactWhole />}
          footnote={`${d.overdueInvoices.count} invoice${d.overdueInvoices.count === 1 ? "" : "s"}`}
          href={canOpen("invoices") ? "/invoices?status=overdue" : undefined}
        />
      </div>

      <ListSection
        header="Needs attention"
        footer={
          clear.length && open.length
            ? `Clear: ${clear.map((c) => c.title.toLowerCase()).join(" · ")}.`
            : undefined
        }
      >
        {open.length === 0 ? (
          <ListRow
            icon={<ClipboardCheck size={17} aria-hidden />}
            iconTone="green"
            title="All caught up"
            subtitle="No leads, jobs or money waiting on the office"
          />
        ) : (
          open.map((a) => (
            <ListRow
              key={a.key}
              icon={a.icon}
              iconTone={a.tone}
              title={a.title}
              subtitle={a.subtitle}
              detail={a.detail}
              accessory="badge"
              badge={a.count}
              badgeCritical={a.critical}
              href={a.href}
            />
          ))
        )}
      </ListSection>

      {d.newLeads.length > 0 && canOpen("leads") && (
        <ListSection
          header="New leads waiting"
          trailing={
            <Link href="/leads?status=new" className="text-accent-text">
              All
            </Link>
          }
        >
          {d.newLeads.map((l) => (
            <ListRow
              key={l.id}
              title={l.name}
              subtitle={
                [l.service, l.source].filter(Boolean).join(" · ") || undefined
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

      {d.unassigned.length > 0 && (
        <ListSection header="Unassigned jobs">
          {d.unassigned.map((j) => (
            <div
              key={j.id}
              className="list-row flex min-h-11 items-center gap-3 px-4 py-2"
            >
              <Link
                href={`/jobs/${j.id}`}
                className="flex min-w-0 flex-1 flex-col"
              >
                <span className="truncate text-body">
                  {j.customer ?? j.title ?? j.number}
                </span>
                <span className="truncate text-subhead text-label-2">
                  {j.number} · {windowText(j, d.tz)}
                </span>
              </Link>
              <AssignJobButton jobId={j.id} label="Assign" variant="tinted" />
            </div>
          ))}
        </ListSection>
      )}

      {d.runningLate.length > 0 && (
        <ListSection header="Running late">
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

      {d.unconfirmedTomorrow.length > 0 && (
        <ListSection
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
