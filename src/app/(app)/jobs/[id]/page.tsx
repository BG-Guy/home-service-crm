import {
  CalendarClock,
  ClipboardList,
  FileText,
  History,
  Images,
  MessageCircle,
  Package,
  Receipt,
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
import { ActionBar } from "@/features/jobs/components/ActionBar";
import { ChecklistClient } from "@/features/jobs/components/ChecklistClient";
import { JobHeaderCard } from "@/features/jobs/components/JobHeaderCard";
import { JobOfficeMenu } from "@/features/jobs/components/JobOfficeMenu";
import { StatusEventList } from "@/features/jobs/components/StatusEventList";
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
import { AssignJobButton } from "@/features/jobs/slots.client";
import { checkTransition } from "@/features/jobs/transition";
import { JobPhotosPanel } from "@/features/media/slots";
import { JobMessagesPanel } from "@/features/messaging/slots";
import { ActivityTimeline } from "@/features/notify/slots";
import { JobPartsPanel } from "@/features/parts/slots";
import { AddPartButton } from "@/features/parts/slots.client";
import { DepositChip, JobPaymentsPanel } from "@/features/payments/slots";
import { CollectPaymentButton } from "@/features/payments/slots.client";
import { JobEarningsPanel } from "@/features/payroll/slots";
import { RequestReviewButton } from "@/features/reviews/slots.client";
import {
  getCustomFieldDefs,
  getEntityTags,
  listServiceTypes,
} from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { actorOf, requireAnyPerm } from "@/lib/auth/current";
import { mapsHref } from "@/lib/links";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey, formatDate, formatDateTime } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { type KeyValueItem, KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { ActionRailFrame } from "@/ui/components/PageActions";
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
  const [jobLines, draftInvoice, photoCounts] = inProgressBar
    ? await Promise.all([
        listJobLines(job.id).catch(() => null),
        getInvoiceForJob(job.id).catch(() => null),
        photosOn ? jobPhotoCounts(job.id).catch(() => null) : null,
      ])
    : [null, null, null];
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
        <ListSection header="Checklist" id="checklist">
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
      <ListSection header="Details">
        <KeyValueList items={details} card={false} />
      </ListSection>
      {customItems.length > 0 && (
        <ListSection header="More info">
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
        <ListSection header="Tags">
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
        <ListSection header="On this job">
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
        <ListSection header="Status & geostamps" id="status-events">
          <StatusEventList events={events} tz={tz} />
        </ListSection>
        <Slot>
          <ActivityTimeline jobId={job.id} showFilterChips />
        </Slot>
      </div>
    ),
  };

  return (
    <PageTransition>
      <ActionRailFrame enabled={office}>
        <NavBar
          title={job.number}
          back={{ href: backHref, label: techView ? "Today" : "Jobs" }}
          trailing={
            office ? (
              <JobOfficeMenu
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
        <Page
          className={
            showActionBar
              ? // Clear the floating dock: its measured height (ActionBar publishes --dock-h).
                "pt-3 pb-[calc(var(--dock-h,128px)+24px)] lg:pb-[calc(var(--dock-h,128px)+40px)]"
              : "pt-3"
          }
        >
          <div className="flex flex-col gap-[var(--section-gap)]">
            <JobHeaderCard
              job={job}
              tz={tz}
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
                    <JobReadinessRing jobId={job.id} size={40} showWhy />
                  </Suspense>
                ) : null
              }
              assign={
                has("jobs.assign") &&
                !["completed", "closed", "cancelled"].includes(job.status) ? (
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
            {!techView &&
              job.status === "completed" &&
              canCollect &&
              job.paymentStatus !== "paid" &&
              !showActionBar && (
                <CollectPaymentButton jobId={job.id} size="lg" fullWidth />
              )}
            {visibleTabs.length > 1 && (!techView || tab !== "overview") && (
              <ChipRow
                label="Job sections"
                className="-mx-[var(--gutter)] px-[var(--gutter)]"
              >
                {visibleTabs.map((t) => (
                  <Chip
                    key={t}
                    replace
                    selected={tab === t}
                    href={`/jobs/${job.id}${t === "overview" ? "" : `?tab=${t}`}`}
                    icon={
                      t === "overview" ? <ClipboardList size={14} /> : undefined
                    }
                  >
                    {TAB_LABEL[t]}
                  </Chip>
                ))}
              </ChipRow>
            )}
            {content[tab]}
          </div>
        </Page>
        {showActionBar && (
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
            navUrl={
              job.addressMasked
                ? null
                : mapsHref(
                    { full: job.addressFull, lat: job.lat, lng: job.lng },
                    ua,
                  )
            }
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
            slots={{
              readiness: <JobReadinessRing jobId={job.id} size={56} showWhy />,
              collect: canCollect ? (
                <CollectPaymentButton jobId={job.id} size="lg" fullWidth />
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
        )}
      </ActionRailFrame>
    </PageTransition>
  );
}
