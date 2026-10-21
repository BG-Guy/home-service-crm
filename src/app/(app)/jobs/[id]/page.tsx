import {
  CalendarClock,
  FileText,
  History,
  Images,
  MessageCircle,
  Package,
  Receipt,
  Route,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { db } from "@/db";
import { getCustomerBrief } from "@/features/customers/api";
import { CustomerCard, PropertyCard } from "@/features/customers/slots";
import { JobReadinessRing, JobRiskChip } from "@/features/disputes/slots";
import { JobEstimatePanel } from "@/features/estimates/slots";
import { getInvoiceForJob, listJobLines } from "@/features/invoices/api";
import { JobInvoicePanel } from "@/features/invoices/slots";
import { AssignJobButton } from "@/features/jobs/components/AssignJobButton";
import { JobHeaderCard } from "@/features/jobs/components/JobHeaderCard";
import { JobOfficeMenuButton } from "@/features/jobs/components/JobOfficeMenuButton";
import {
  JobMoneyCard,
  JobProgressCard,
  JobTechCards,
} from "@/features/jobs/components/JobRail";
import { JobTabs } from "@/features/jobs/components/JobTabs";
import {
  LazyActionBar as ActionBar,
  LazyAddPartButton as AddPartButton,
  LazyChecklist as ChecklistClient,
  LazyCollectPaymentButton as CollectPaymentButton,
  LazyRequestReviewButton as RequestReviewButton,
  LazyTagEditor as TagEditor,
} from "@/features/jobs/components/lazy-islands";
import { StatusEventList } from "@/features/jobs/components/StatusEventList";
import { hubHrefForJob } from "@/features/jobs/dispatch/href";
import type { GuardMiss } from "@/features/jobs/machine";
import {
  CALLBACK_REASON_LABEL,
  CANCEL_REASON_LABEL,
  HOLD_REASON_LABEL,
} from "@/features/jobs/machine";
import {
  getJobDetail,
  getStatusEvents,
  jobPhotoCounts,
  nextJobAfter,
} from "@/features/jobs/queries";
import { NotesPanel } from "@/features/jobs/slots";
import { checkTransition } from "@/features/jobs/transition";
import { JobPhotosPanel } from "@/features/media/slots";
import { JobMessagesPanel } from "@/features/messaging/slots";
import { ActivityTimeline } from "@/features/notify/slots";
import { JobPartsPanel } from "@/features/parts/slots";
import { DepositChip, JobPaymentsPanel } from "@/features/payments/slots";
import { JobEarningsPanel } from "@/features/payroll/slots";
import {
  getCustomFieldDefs,
  getEntityTags,
  listServiceTypes,
} from "@/features/settings/api";
import { actorOf, requireAnyPerm } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import {
  dateKey,
  formatDate,
  formatDateTime,
  formatDayShort,
  formatInTz,
  formatTimeRange,
} from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { DetailLayout, Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { IconButton } from "@/ui/components/IconButton";
import { type KeyValueItem, KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { SkeletonCard } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Job" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

const TABS = [
  "overview",
  "photos",
  "estimate",
  "invoice",
  "parts",
  "messages",
  "history",
] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  photos: "Photos",
  estimate: "Estimate",
  invoice: "Invoice",
  parts: "Parts",
  messages: "Messages",
  history: "History",
};

const DEFAULT_ESIGN =
  "I agree to sign electronically. My electronic signature has the same effect as a handwritten one.";

function Slot({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SkeletonCard lines={3} />}>{children}</Suspense>;
}

async function previewMissing(
  user: SessionUser,
  jobId: string,
  to: "in_progress" | "completed",
): Promise<GuardMiss[] | null> {
  try {
    const { guard } = await checkTransition(db, {
      jobId,
      to,
      actor: actorOf(user),
      user,
      dryRun: true,
    });
    return guard.missing;
  } catch {
    return null;
  }
}

function navUrl(
  ua: string,
  job: { lat: number | null; lng: number | null; addressFull: string },
) {
  const dest =
    job.lat != null && job.lng != null
      ? `${job.lat},${job.lng}`
      : job.addressFull;
  const q = encodeURIComponent(dest);
  return /iPhone|iPad|iPod|Macintosh/.test(ua)
    ? `https://maps.apple.com/?daddr=${q}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/** Sign-off summary rows: identical lines merged ("2 × Rekey cylinder — $90.00"). */
function summarizeLines(
  lines: { name: string; qty: number; totalCents: number }[],
): string[] {
  const merged = new Map<string, { qty: number; cents: number }>();
  for (const l of lines) {
    const m = merged.get(l.name) ?? { qty: 0, cents: 0 };
    m.qty += l.qty;
    m.cents += l.totalCents;
    merged.set(l.name, m);
  }
  return [...merged].map(
    ([name, m]) =>
      `${m.qty === 1 ? "" : `${m.qty} × `}${name} — ${formatMoney(m.cents)}`,
  );
}

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const user = await requireAnyPerm(["jobs.view_all", "jobs.view_own"]);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const job = await getJobDetail(id);
  if (!job) notFound();

  const has = (p: Parameters<typeof user.perms.has>[0]) => user.perms.has(p);
  const techView = user.baseRole === "tech";
  const [
    settings,
    tz,
    photosOn,
    beforeAfter,
    estimatesOn,
    partsOn,
    reviewsOn,
    protectionOn,
  ] = await Promise.all([
    getSettings(),
    getCompanyTimezone(),
    isEnabled("photos"),
    isEnabled("before_after"),
    isEnabled("estimates"),
    isEnabled("parts"),
    isEnabled("reviews"),
    // The evidence pack lives under chargeback protection (QA T3-06).
    isEnabled("chargeback_protection"),
  ]);
  const canEvidence = protectionOn && has("evidence.view");
  const action = one(sp.action);
  let tab = (TABS as readonly string[]).includes(one(sp.tab))
    ? (one(sp.tab) as Tab)
    : "overview";
  if (action === "collect") tab = "invoice";
  const visibleTabs = TABS.filter(
    (t) =>
      (t !== "photos" || photosOn) &&
      (t !== "estimate" || (estimatesOn && has("estimates.view"))) &&
      (t !== "invoice" || has("invoices.view")) &&
      (t !== "parts" || partsOn) &&
      (t !== "messages" || has("messages.send") || has("messages.view_all")),
  );
  if (!visibleTabs.includes(tab)) tab = "overview";

  const fieldPerm =
    has("jobs.status_any") || (has("jobs.status_own") && job.viewerIsAssignee);
  const activeField = [
    "en_route",
    "arrived",
    "in_progress",
    "on_hold",
  ].includes(job.status);
  const showActionBar =
    fieldPerm &&
    job.status !== "unscheduled" &&
    job.status !== "cancelled" &&
    job.status !== "closed" &&
    (job.viewerIsAssignee || techView || activeField || action === "complete");
  const office =
    !techView &&
    (has("jobs.edit") ||
      has("jobs.assign") ||
      has("jobs.cancel") ||
      has("jobs.reopen"));

  const ua = (await headers()).get("user-agent") ?? "";
  const [
    startMissing,
    completeMissing,
    brief,
    esign,
    nextJob,
    serviceTypes,
    tags,
    defs,
    events,
  ] = await Promise.all([
    showActionBar && job.status === "arrived"
      ? previewMissing(user, job.id, "in_progress")
      : null,
    showActionBar && job.status === "in_progress"
      ? previewMissing(user, job.id, "completed")
      : null,
    getCustomerBrief(job.customerId, user, { jobId: job.id }).catch(() => null),
    showActionBar ? getCurrentPolicy("esign_consent").catch(() => null) : null,
    showActionBar && job.status === "completed"
      ? nextJobAfter(user, job.id)
      : null,
    office && has("jobs.edit") ? listServiceTypes() : [],
    tab === "overview"
      ? getEntityTags([{ type: "job", id: job.id }]).catch(() => ({}))
      : {},
    tab === "overview"
      ? getCustomFieldDefs("job", job.serviceTypeId).catch(() => [])
      : [],
    tab === "history" ? getStatusEvents(job.id) : [],
  ]);
  // In progress: the sign-off summary (lines + total), the "no items on the
  // invoice yet" warning and the recommended-photos row of the Complete sheet.
  const inProgressBar = showActionBar && job.status === "in_progress";
  // The invoice feeds the in-progress sign-off total, the completed bar's
  // balance and the desktop money card (one summary read, no lines).
  const wantInvoice = inProgressBar || has("invoices.view");
  const [jobLines, draftInvoice, photoCounts] = await Promise.all([
    inProgressBar ? listJobLines(job.id).catch(() => null) : null,
    wantInvoice ? getInvoiceForJob(job.id).catch(() => null) : null,
    inProgressBar && photosOn ? jobPhotoCounts(job.id).catch(() => null) : null,
  ]);
  const invoiceSummary = jobLines ? summarizeLines(jobLines) : null;
  const esignText = esign?.body ?? DEFAULT_ESIGN;
  const todayKey = dateKey(new Date(), tz);
  const canCollect = has("payments.collect") || has("payments.record_manual");
  const backHref = techView ? "/today" : "/jobs";
  const custom = job.custom;
  const arrivalFlags = Array.isArray(custom.arrival_flags)
    ? (custom.arrival_flags as string[])
    : [];

  // ---------------------------------------------------------------- banners
  const banners: ReactNode[] = [];
  if (job.status === "cancelled")
    banners.push(
      <Banner
        key="cancel"
        tone="error"
        title={`Cancelled: ${CANCEL_REASON_LABEL[job.cancelReason ?? ""] ?? job.cancelReason ?? "Other"}`}
      >
        {job.cancelNote ?? "No note."}
        {job.cancelReviewStatus === "pending" && " · Waiting for admin review."}
        {job.cancelReviewStatus === "flagged" && " · Flagged by an admin."}
      </Banner>,
    );
  if (job.status === "on_hold")
    banners.push(
      <Banner key="hold" tone="warning" title="On hold">
        {HOLD_REASON_LABEL[job.holdReason ?? ""] ?? job.holdReason ?? "Waiting"}
        {typeof custom.hold_note === "string" && custom.hold_note
          ? ` — ${custom.hold_note}`
          : ""}
      </Banner>,
    );
  if (
    job.rescheduleRequestedAt &&
    !techView &&
    ["scheduled", "confirmed", "unscheduled"].includes(job.status)
  )
    banners.push(
      <Banner
        key="resched"
        tone="info"
        icon={<CalendarClock size={18} />}
        title="Customer asked to reschedule"
        action={
          has("jobs.assign") ? (
            <AssignJobButton jobId={job.id} label="Reschedule" />
          ) : undefined
        }
      >
        {job.rescheduleNote ?? "No note left."}
      </Banner>,
    );
  if (!techView && arrivalFlags.includes("far_from_property"))
    banners.push(
      <Banner
        key="far"
        tone="warning"
        title="Arrival recorded away from the property"
      >
        See History for the geostamp.
      </Banner>,
    );
  if (!techView && (custom.start_override || custom.complete_override))
    banners.push(
      <Banner
        key="ovr"
        tone="legal"
        icon={<ShieldCheck size={18} />}
        title="Requirements overridden"
      >
        {[custom.start_override, custom.complete_override]
          .filter(Boolean)
          .map((o) => (o as { reason?: string }).reason)
          .join(" · ")}
      </Banner>,
    );

  // ---------------------------------------------------------------- overview
  const details: KeyValueItem[] = [
    { key: "service", label: "Service", value: job.serviceTypeName ?? "—" },
    ...(job.description
      ? [
          {
            key: "desc",
            label: "Description",
            value: job.description,
            stacked: true,
          },
        ]
      : []),
    ...(job.customerNotes
      ? [
          {
            key: "cnotes",
            label: "Customer notes",
            value: job.customerNotes,
            stacked: true,
          },
        ]
      : []),
    ...(job.isCallback
      ? [
          {
            key: "cb",
            label: "Callback of",
            value: `${job.callbackOfNumber ?? "job"} · ${CALLBACK_REASON_LABEL[job.callbackReason ?? ""] ?? "Other"}${custom.no_charge ? " · no charge" : ""}`,
            href: job.callbackOfJobId
              ? `/jobs/${job.callbackOfJobId}`
              : undefined,
          },
        ]
      : []),
    ...job.callbacks.map((c) => ({
      key: `cbk-${c.id}`,
      label: "Callback",
      value: c.number,
      href: `/jobs/${c.id}`,
    })),
    ...(job.warrantyExpiresAt
      ? [
          {
            key: "warranty",
            label: "Warranty",
            value:
              new Date(job.warrantyExpiresAt) > new Date()
                ? `Until ${formatDate(job.warrantyExpiresAt, tz)}`
                : `Expired ${formatDate(job.warrantyExpiresAt, tz)}`,
          },
        ]
      : []),
    ...(job.recurrence
      ? [
          {
            key: "rec",
            label: "Repeats",
            value: `Every ${job.recurrence.n} ${job.recurrence.every === "weeks" ? "week" : "month"}${job.recurrence.n === 1 ? "" : "s"}`,
          },
        ]
      : []),
    ...(job.visitCount > 1
      ? [
          {
            key: "visits",
            label: "Visits",
            value: String(job.visitCount),
            numeric: true,
          },
        ]
      : []),
    ...(job.leadId && has("leads.view")
      ? [
          {
            key: "lead",
            label: "From lead",
            value: "View lead",
            href: `/leads/${job.leadId}`,
          },
        ]
      : []),
    {
      key: "created",
      label: "Created",
      value: `${formatDateTime(job.createdAt, tz)}${job.createdByName ? ` · ${job.createdByName}` : ""}`,
    },
  ];
  const customItems: KeyValueItem[] = defs
    .filter((d) => job.custom[d.key] != null && job.custom[d.key] !== "")
    .map((d) => ({
      key: `cf-${d.key}`,
      label: d.label,
      value: Array.isArray(job.custom[d.key])
        ? (job.custom[d.key] as unknown[]).join(", ")
        : typeof job.custom[d.key] === "boolean"
          ? job.custom[d.key]
            ? "Yes"
            : "No"
          : String(job.custom[d.key]),
    }));
  const checklistEditable =
    fieldPerm &&
    [
      "arrived",
      "in_progress",
      "on_hold",
      "en_route",
      "scheduled",
      "confirmed",
      "completed",
    ].includes(job.status);

  const overview = (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Slot>
        <CustomerCard
          customerId={job.customerId}
          jobId={job.id}
          variant="full"
          showActions
        />
      </Slot>
      <Slot>
        <PropertyCard
          propertyId={job.propertyId}
          jobId={job.id}
          variant="full"
        />
      </Slot>
      {job.checklist.length > 0 && (
        <ListSection variant="title" header="Checklist" id="checklist">
          <ChecklistClient
            jobId={job.id}
            items={job.checklist}
            editable={checklistEditable}
            photosEnabled={photosOn && has("photos.upload")}
            esignText={esignText}
            customerName={job.customerName}
            renderedAt={Date.now()}
          />
        </ListSection>
      )}
      <ListSection variant="title" header="Details">
        <KeyValueList items={details} card={false} />
      </ListSection>
      {customItems.length > 0 && (
        <ListSection variant="title" header="More info">
          <KeyValueList items={customItems} card={false} />
        </ListSection>
      )}
      <Slot>
        <NotesPanel
          entity={{ type: "job", id: job.id }}
          customerId={job.customerId}
          jobId={job.id}
          allowCustomerVisible={!techView}
        />
      </Slot>
      {!techView && (
        <ListSection variant="title" header="Tags">
          <div className="px-4 py-3">
            <TagEditor
              entityType="job"
              entityId={job.id}
              initial={
                (
                  tags as Record<
                    string,
                    { id: string; name: string; color: string }[]
                  >
                )[job.id] ?? []
              }
            />
          </div>
        </ListSection>
      )}
      <Slot>
        <JobEarningsPanel jobId={job.id} />
      </Slot>
      {!techView &&
        reviewsOn &&
        (job.status === "completed" || job.status === "closed") && (
          <div>
            <RequestReviewButton jobId={job.id} />
          </div>
        )}
      {techView && (
        <ListSection variant="title" header="On this job">
          {visibleTabs
            .filter((t) => t !== "overview")
            .map((t) => (
              <ListRow
                key={t}
                href={`/jobs/${job.id}?tab=${t}`}
                transition="push"
                icon={
                  t === "photos" ? (
                    <Images size={17} />
                  ) : t === "estimate" ? (
                    <FileText size={17} />
                  ) : t === "invoice" ? (
                    <Receipt size={17} />
                  ) : t === "parts" ? (
                    <Package size={17} />
                  ) : t === "messages" ? (
                    <MessageCircle size={17} />
                  ) : (
                    <History size={17} />
                  )
                }
                iconTone={
                  t === "photos"
                    ? "orange"
                    : t === "estimate"
                      ? "indigo"
                      : t === "invoice"
                        ? "green"
                        : t === "parts"
                          ? "brown"
                          : t === "messages"
                            ? "blue"
                            : "gray"
                }
                title={TAB_LABEL[t]}
              />
            ))}
        </ListSection>
      )}
    </div>
  );

  const content: Record<Tab, ReactNode> = {
    overview,
    photos: (
      <Slot>
        <JobPhotosPanel
          jobId={job.id}
          canCapture={fieldPerm || has("jobs.edit")}
        />
      </Slot>
    ),
    estimate: (
      <Slot>
        <JobEstimatePanel jobId={job.id} />
      </Slot>
    ),
    invoice: (
      <div className="flex flex-col gap-[var(--section-gap)]">
        <Slot>
          <JobInvoicePanel jobId={job.id} />
        </Slot>
        <Slot>
          <JobPaymentsPanel jobId={job.id} />
        </Slot>
      </div>
    ),
    parts: (
      <Slot>
        <JobPartsPanel jobId={job.id} />
      </Slot>
    ),
    messages: (
      <Slot>
        <JobMessagesPanel jobId={job.id} />
      </Slot>
    ),
    history: (
      <div className="flex flex-col gap-[var(--section-gap)]">
        <ListSection
          variant="title"
          header="Status & geostamps"
          id="status-events"
        >
          <StatusEventList events={events} tz={tz} />
        </ListSection>
        <Slot>
          <ActivityTimeline jobId={job.id} showFilterChips />
        </Slot>
      </div>
    ),
  };

  const start = job.windowStart ?? job.scheduledStart;
  const end = job.windowEnd ?? job.scheduledEnd;
  const clock = (iso: string) =>
    formatInTz(iso, tz, { hour: "numeric", minute: "2-digit" });
  const windowLabel = start
    ? `${dateKey(new Date(start), tz) === todayKey ? "Today" : formatDayShort(start, tz)} · ${end ? formatTimeRange(start, end, tz) : clock(start)}`
    : null;
  const canAssign =
    has("jobs.assign") &&
    !["completed", "closed", "cancelled"].includes(job.status);
  // Office view without the field dock: the bar carries the office's next step
  // (collect a balance, or schedule an unassigned job).
  const collectBar =
    !showActionBar &&
    !techView &&
    job.status === "completed" &&
    canCollect &&
    job.paymentStatus !== "paid";
  const assignBar =
    !showActionBar &&
    !collectBar &&
    canAssign &&
    (job.status === "unscheduled" || job.assignees.length === 0);
  const bar = showActionBar ? (
    <ActionBar
      job={{
        id: job.id,
        number: job.number,
        status: job.status,
        customerName: job.customerName,
        customerFirstName: job.customerFirstName,
        windowStart: job.windowStart,
        arrivedAt: job.arrivedAt,
        paymentStatus: job.paymentStatus,
      }}
      navUrl={job.addressMasked ? null : navUrl(ua, job)}
      phone={brief?.contactRevealed ? brief.phone : null}
      perms={{
        field: fieldPerm,
        cancel: has("jobs.cancel"),
        cancelAfterArrival: has("jobs.cancel_after_arrival"),
        reviewCancellations: has("jobs.review_cancellations"),
        override: has("jobs.override_requirements"),
        photos: photosOn && has("photos.upload"),
        estimates: estimatesOn && has("estimates.create"),
      }}
      startMissing={startMissing}
      completeMissing={completeMissing}
      windowLengths={settings.jobs.window_lengths_min}
      defaultWindow={settings.jobs.default_window_min}
      todayKey={todayKey}
      policy={settings.jobs.cancellation_policy}
      esignText={esignText}
      nextJobId={nextJob?.id ?? null}
      beforeAfter={beforeAfter}
      hasChecklist={job.checklist.length > 0}
      signed={!!custom.completion_signature_id}
      invoice={
        invoiceSummary
          ? {
              lines: invoiceSummary,
              totalCents:
                draftInvoice?.totalCents ??
                (jobLines ?? []).reduce((a, l) => a + l.totalCents, 0),
            }
          : null
      }
      photoCounts={photoCounts}
      initialSheet={action === "complete" ? "complete" : null}
      summary={{
        window: windowLabel,
        eta: job.etaAt ? `ETA ${clock(job.etaAt)}` : null,
        hold: HOLD_REASON_LABEL[job.holdReason ?? ""] ?? job.holdReason,
        balanceCents: draftInvoice?.balanceCents ?? null,
      }}
      slots={{
        readiness: <JobReadinessRing jobId={job.id} size={56} showWhy />,
        collect: canCollect ? (
          <CollectPaymentButton jobId={job.id} size="lg" />
        ) : undefined,
        collectDeposit: canCollect ? (
          <CollectPaymentButton
            jobId={job.id}
            allowDeposit
            label="Collect deposit"
            variant="tinted"
          />
        ) : undefined,
        addPart:
          partsOn && has("parts.add_to_job") ? (
            <AddPartButton
              jobId={job.id}
              label="Parts"
              variant="gray"
              size="sm"
            />
          ) : undefined,
        orderPart:
          partsOn && has("parts.add_to_job") ? (
            <AddPartButton
              jobId={job.id}
              mode="special_order"
              label="Order part"
              variant="gray"
              size="sm"
            />
          ) : undefined,
      }}
    />
  ) : collectBar ? (
    <BottomBar
      label={`${job.number} actions`}
      summary={
        <BarSummary
          title={
            draftInvoice && draftInvoice.balanceCents > 0
              ? formatMoney(draftInvoice.balanceCents)
              : "Job complete"
          }
          subtitle={
            draftInvoice && draftInvoice.balanceCents > 0
              ? "Balance due"
              : "Not paid yet"
          }
        />
      }
      action={<CollectPaymentButton jobId={job.id} size="lg" />}
    />
  ) : assignBar ? (
    <BottomBar
      label={`${job.number} actions`}
      summary={
        <BarSummary
          title={windowLabel ?? "Not scheduled"}
          subtitle="No technician yet"
        />
      }
      secondary={
        <IconButton
          label="Open assign hub"
          variant="secondary"
          size={44}
          transition="push"
          href={hubHrefForJob(job.id, start ? dateKey(start, tz) : null)}
        >
          <Route size={20} aria-hidden />
        </IconButton>
      }
      action={
        <AssignJobButton
          jobId={job.id}
          label={job.status === "unscheduled" ? "Schedule" : "Assign"}
          variant="filled"
          size="lg"
        />
      }
    />
  ) : null;

  const rail = (
    <>
      <JobProgressCard job={job} tz={tz} />
      {has("invoices.view") && (
        <JobMoneyCard
          jobId={job.id}
          invoice={
            draftInvoice
              ? {
                  number: draftInvoice.number,
                  totalCents: draftInvoice.totalCents,
                  balanceCents: draftInvoice.balanceCents,
                }
              : null
          }
        />
      )}
      <JobTechCards job={job} />
    </>
  );

  return (
    <PageTransition>
      <NavBar
        title={job.number}
        back={{ href: backHref, label: techView ? "Today" : "Jobs" }}
        trailing={
          office ? (
            <JobOfficeMenuButton
              job={{
                id: job.id,
                number: job.number,
                status: job.status,
                title: job.title,
                description: job.description,
                customerNotes: job.customerNotes,
                priority: job.priority,
                afterHours: job.afterHours,
                serviceTypeId: job.serviceTypeId,
                recurrence: job.recurrence,
                arrivedAt: job.arrivedAt,
                windowStart: job.windowStart,
                confirmedAt: job.confirmedAt,
              }}
              serviceTypes={serviceTypes.map((s) => ({
                id: s.id,
                name: s.name,
              }))}
              can={{
                edit: has("jobs.edit"),
                assign: has("jobs.assign") || has("jobs.reschedule"),
                cancel: has("jobs.cancel"),
                cancelAfterArrival: has("jobs.cancel_after_arrival"),
                reviewCancellations: has("jobs.review_cancellations"),
                reopen: has("jobs.reopen"),
                statusAny: has("jobs.status_any"),
                create: has("jobs.create"),
                evidence: canEvidence,
              }}
              policy={settings.jobs.cancellation_policy}
              windowLengths={settings.jobs.window_lengths_min}
              defaultWindow={settings.jobs.default_window_min}
              todayKey={todayKey}
              initial={action === "assign" ? "assign" : null}
            />
          ) : undefined
        }
      />
      <Page className="pt-3">
        <DetailLayout
          rail={rail}
          bar={bar}
          railOnPhone="hide"
          railLabel="Job summary"
        >
          <JobHeaderCard
            job={job}
            tz={tz}
            navHref={job.addressMasked ? null : navUrl(ua, job)}
            chips={
              <>
                <Suspense fallback={null}>
                  <JobRiskChip jobId={job.id} showWhy={!techView} />
                </Suspense>
                <Suspense fallback={null}>
                  <DepositChip jobId={job.id} />
                </Suspense>
              </>
            }
            readiness={
              job.status === "in_progress" ||
              job.status === "completed" ||
              job.status === "closed" ? (
                <Suspense fallback={null}>
                  <JobReadinessRing jobId={job.id} size={44} showWhy />
                </Suspense>
              ) : null
            }
            assign={
              canAssign && !assignBar ? (
                <AssignJobButton
                  jobId={job.id}
                  label={job.assignees.length ? "Reassign" : "Assign"}
                  variant="gray"
                />
              ) : null
            }
            evidenceHref={
              canEvidence &&
              (job.status === "completed" || job.status === "closed")
                ? `/jobs/${job.id}/evidence`
                : null
            }
          />
          {banners.length > 0 && (
            <div className="flex flex-col gap-2">{banners}</div>
          )}
          {visibleTabs.length > 1 && (!techView || tab !== "overview") && (
            <JobTabs
              active={tab}
              tabs={visibleTabs.map((t) => ({
                key: t,
                label: TAB_LABEL[t],
                href: `/jobs/${job.id}${t === "overview" ? "" : `?tab=${t}`}`,
              }))}
            />
          )}
          {content[tab]}
        </DetailLayout>
      </Page>
    </PageTransition>
  );
}
