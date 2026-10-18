import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { CustomerCard } from "@/features/customers/slots";
import { NotesPanel } from "@/features/jobs/slots";
import { LeadActions } from "@/features/leads/components/LeadActions";
import { LeadEditSheet } from "@/features/leads/components/LeadEditSheet";
import {
  LeadsPane,
  leadFilterFrom,
} from "@/features/leads/components/LeadsPane";
import { SlaTimer } from "@/features/leads/components/SlaTimer";
import {
  EVENT_LABEL,
  lostReasonLabel,
  OUTCOME_LABEL,
  spamSignals,
} from "@/features/leads/labels";
import { getLeadDetail, listActiveSources } from "@/features/leads/queries";
import { MessageComposer } from "@/features/messaging/slots.client";
import { ActivityTimeline } from "@/features/notify/slots";
import {
  getCustomFieldDefs,
  getEntityTags,
  listServiceTypes,
} from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { mapsHref, personHref } from "@/lib/links";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { formatDateKey, formatDateTime } from "@/lib/time";
import { Page, SplitView } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { ActionRailFrame } from "@/ui/components/PageActions";
import { SkeletonCard } from "@/ui/components/Skeleton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Lead" };

function Slot({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SkeletonCard lines={3} />}>{children}</Suspense>;
}

const ATTR_LABEL: Record<string, string> = {
  utm_source: "Source (utm)",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_term: "Keyword",
  utm_content: "Ad content",
  gclid: "Google click id",
  gbraid: "Google gbraid",
  wbraid: "Google wbraid",
  fbclid: "Facebook click id",
  msclkid: "Microsoft click id",
  referrer: "Referrer",
  landing_url: "Landing page",
  page_url: "Form page",
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("leads.view");
  if (!(await isEnabled("leads"))) notFound();
  const { id } = await params;
  const sp = await searchParams;
  let lead: Awaited<ReturnType<typeof getLeadDetail>>;
  try {
    lead = await getLeadDetail(user, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const p = user.perms;
  const canEdit = p.has("leads.edit");
  const [settings, tz, estimatesOn, tagMap, customDefs, sources, services] =
    await Promise.all([
      getSettings(),
      getCompanyTimezone(),
      isEnabled("estimates"),
      getEntityTags([{ type: "lead", id: lead.id }]).catch(() => ({})),
      getCustomFieldDefs("lead").catch(() => []),
      canEdit ? listActiveSources() : Promise.resolve([]),
      canEdit ? listServiceTypes().catch(() => []) : Promise.resolve([]),
    ]);
  const tags =
    (tagMap as Record<string, { id: string; name: string; color: string }[]>)[
      lead.id
    ] ?? [];
  const custom = lead.custom;
  const attribution = Object.entries(lead.attribution).filter(
    ([k, v]) =>
      k !== "first_touch" && k !== "last_touch" && v != null && v !== "",
  );
  const touches = (["first_touch", "last_touch"] as const)
    .map((k) => [k, lead.attribution[k]] as const)
    .filter(([, v]) => v && typeof v === "object") as [
    string,
    Record<string, string>,
  ][];
  // Hide internal keys, the honeypot and empty values (T2-22).
  const extra = Object.entries(lead.extra).filter(
    ([k, v]) =>
      !k.startsWith("_") &&
      k !== "custom" &&
      k !== "company_website" &&
      v != null &&
      v !== "",
  );
  const open = ["new", "contacted", "qualified"].includes(lead.status);
  const addr = lead.address;
  const addressText = addr?.street
    ? `${addr.street}${addr.unit ? ` ${addr.unit}` : ""}, ${[addr.city, addr.state].filter(Boolean).join(", ")} ${addr.zip ?? ""}`.trim()
    : ((lead.extra._address_text as string) ?? null);
  const filter = leadFilterFrom(sp);
  const ua = (await headers()).get("user-agent");
  const assignedHref = personHref(user, lead.assignedUserId);
  const assignedPill = lead.assignedName ? (
    <Pill tone="blue" dot={false} size="sm">
      {lead.assignedUserId === user.id ? "Yours" : lead.assignedName}
    </Pill>
  ) : null;

  const detail = (
    <ActionRailFrame compact enabled={canEdit || p.has("leads.convert")}>
      <NavBar
        back={{ href: "/leads", label: "Leads" }}
        title={lead.name}
        trailing={
          canEdit ? (
            <LeadEditSheet
              lead={{
                id: lead.id,
                name: lead.name,
                serviceTypeId: lead.serviceTypeId,
                service: lead.serviceTypeId ? null : lead.service,
                quotedPriceCents: lead.quotedPriceCents,
                preferredDate: lead.preferredDate,
                preferredWindow: lead.preferredWindow,
                notes: lead.notesFull,
                sourceId: lead.leadSourceId,
              }}
              sources={sources}
              services={services.map((s) => ({ id: s.id, name: s.name }))}
            />
          ) : null
        }
      />
      <Page className="pt-2">
        <ListGroup>
          <section className="list-card flex flex-col gap-3 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-title2 font-bold">{lead.name}</h1>
                <p className="text-subhead text-label-2">
                  {lead.service ?? "Service not given"}
                  {lead.sourceName ? ` · ${lead.sourceName}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusPill
                  kind="lead"
                  status={lead.status}
                  label={
                    lead.status === "lost" && lead.lostReason
                      ? `Lost · ${lostReasonLabel(lead.lostReason)}`
                      : undefined
                  }
                />
                {(open || lead.firstResponseAt) && (
                  <SlaTimer
                    createdAt={lead.createdAt}
                    respondedAt={lead.firstResponseAt}
                  />
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lead.isReturning && (
                <Pill tone="indigo" size="sm">
                  Returning customer
                </Pill>
              )}
              {lead.isTest && (
                <Pill tone="gray" size="sm">
                  Test lead
                </Pill>
              )}
              {lead.inServiceArea === false && (
                <Pill tone="red" size="sm">
                  Outside service area
                </Pill>
              )}
              {assignedPill && assignedHref ? (
                <Link
                  href={assignedHref}
                  transitionTypes={["nav-forward"]}
                  className="pressable hit-44 rounded-pill"
                >
                  <span className="sr-only">Assigned: </span>
                  {assignedPill}
                </Link>
              ) : (
                assignedPill
              )}
            </div>
            <LeadActions
              leadId={lead.id}
              name={lead.name}
              status={lead.status}
              hasPhone={lead.hasPhone}
              phone={lead.phone}
              customerId={lead.customerId}
              assignedToMe={lead.assignedUserId === user.id}
              assigned={!!lead.assignedUserId}
              flagged={lead.flagged || lead.status === "spam"}
              canEdit={canEdit}
              canConvert={p.has("leads.convert")}
              estimatesOn={estimatesOn}
              lostReasons={settings.leads.lost_reasons}
            />
          </section>

          {lead.flagged && (
            <Banner
              tone="warning"
              title={`Check this lead (spam score ${lead.spamScore})`}
            >
              {lead.spamReason
                ? `Signals: ${spamSignals(lead.spamReason)}. `
                : ""}
              No customer was created yet. Tap “Looks legit” to move it to the
              inbox.
            </Banner>
          )}
          {lead.status === "spam" && (
            <Banner tone="info" title="Marked as spam">
              Reason: {spamSignals(lead.spamReason) || "marked by hand"}. The
              sender saw a normal thank-you.
            </Banner>
          )}
          {(lead.convertedJobId || lead.convertedEstimateId) && (
            <ListSection header="Booked">
              {lead.convertedJobId && (
                <ListRow
                  title={`Job ${lead.convertedJobNumber ?? ""}`}
                  href={`/jobs/${lead.convertedJobId}`}
                />
              )}
              {lead.convertedEstimateId && (
                <ListRow
                  title={`Estimate ${lead.convertedEstimateNumber ?? ""}`}
                  href={`/estimates/${lead.convertedEstimateId}`}
                />
              )}
            </ListSection>
          )}

          <ListSection header="Request">
            {lead.phoneDisplay && (
              <ListRow
                title="Phone"
                detail={lead.phoneDisplay}
                href={`tel:${lead.phone}`}
                external
              />
            )}
            {lead.email && (
              <ListRow
                title="Email"
                detail={lead.email}
                href={`mailto:${lead.email}`}
                external
              />
            )}
            {addressText && (
              <ListRow
                title="Address"
                subtitle={addressText}
                multiline
                // Leads are office-only (leads.view), so the address isn't masked.
                href={mapsHref({ full: addressText }, ua) ?? undefined}
                external
                detail={
                  lead.inServiceArea === true
                    ? "In area"
                    : lead.inServiceArea === false
                      ? "Outside area"
                      : undefined
                }
              />
            )}
            <ListRow title="Service" detail={lead.service ?? "—"} />
            {lead.quotedPriceCents != null && (
              <ListRow
                title="Quoted price"
                detail={<MoneyText cents={lead.quotedPriceCents} />}
              />
            )}
            {(lead.preferredDate || lead.preferredWindow) && (
              <ListRow
                title="Preferred"
                detail={[
                  lead.preferredDate
                    ? formatDateKey(lead.preferredDate, "en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : null,
                  lead.preferredWindow,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
            <ListRow
              title="Received"
              detail={formatDateTime(lead.createdAt, tz)}
            />
            {lead.firstResponseAt && (
              <ListRow
                title="First response"
                detail={formatDateTime(lead.firstResponseAt, tz)}
                subtitle={lead.firstResponseByName ?? undefined}
              />
            )}
            {lead.notesFull && (
              <ListRow
                title={
                  <span className="whitespace-pre-wrap">{lead.notesFull}</span>
                }
                subtitle="Notes"
                multiline
              />
            )}
          </ListSection>

          {lead.customerId && open && canEdit && (
            <section className="flex flex-col gap-2">
              <h2 className="px-4 text-footnote uppercase text-label-2">
                Text them
              </h2>
              <div className="list-card px-3 py-3">
                <MessageComposer
                  customerId={lead.customerId}
                  leadId={lead.id}
                  defaultChannel="sms"
                  compact
                />
              </div>
            </section>
          )}

          {lead.customerId && (
            <Slot>
              <CustomerCard
                customerId={lead.customerId}
                variant="compact"
                showActions={false}
              />
            </Slot>
          )}

          <ListSection
            header="Source & attribution"
            footer={
              lead.smsConsent
                ? "SMS consent was captured with this request (unchecked box, text shown, page, IP and browser recorded)."
                : "No SMS consent with this request. Texts about the request itself (replies, booking, reminders) can still go out; marketing texts need consent first."
            }
          >
            <ListRow title="Source" detail={lead.sourceName ?? "—"} />
            {lead.externalId && (
              <ListRow title="External id" detail={lead.externalId} />
            )}
            {lead.sourceCostCents != null && (
              <ListRow
                title="Lead cost"
                detail={<MoneyText cents={lead.sourceCostCents} />}
              />
            )}
            {attribution.map(([k, v]) => (
              <ListRow
                key={k}
                title={ATTR_LABEL[k] ?? k}
                subtitle={<span className="break-all">{String(v)}</span>}
                multiline
              />
            ))}
            {touches.map(([k, v]) => (
              <ListRow
                key={k}
                title={k === "first_touch" ? "First touch" : "Last touch"}
                subtitle={
                  <span className="break-all">
                    {Object.entries(v)
                      .filter(([kk]) => kk !== "at")
                      .map(([kk, vv]) => `${kk}: ${vv}`)
                      .join(" · ")}
                  </span>
                }
                detail={v.at ? formatDateTime(v.at, tz) : undefined}
                multiline
              />
            ))}
            <ListRow
              title="SMS consent"
              detail={lead.smsConsent ? "Yes" : "No"}
            />
            <ListRow
              title="Marketing consent"
              detail={lead.marketingConsent ? "Yes" : "No"}
            />
          </ListSection>

          {(customDefs.length > 0 && Object.keys(custom).length > 0) ||
          extra.length > 0 ? (
            <ListSection header="More details">
              {customDefs
                .filter((d) => custom[d.key] != null && custom[d.key] !== "")
                .map((d) => (
                  <ListRow
                    key={d.key}
                    title={d.label}
                    detail={String(custom[d.key])}
                  />
                ))}
              {extra.slice(0, 20).map(([k, v]) => (
                <ListRow
                  key={k}
                  title={k.replace(/_/g, " ")}
                  subtitle={
                    <span className="break-all">
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                  }
                  multiline
                />
              ))}
            </ListSection>
          ) : null}

          {canEdit && (
            <section className="flex flex-col gap-2">
              <h2 className="px-4 text-footnote uppercase text-label-2">
                Tags
              </h2>
              <div className="list-card px-4 py-3">
                <TagEditor
                  entityType="lead"
                  entityId={lead.id}
                  initial={tags}
                />
              </div>
            </section>
          )}

          <Slot>
            <NotesPanel
              entity={{ type: "lead", id: lead.id }}
              customerId={lead.customerId ?? undefined}
              allowCustomerVisible={false}
            />
          </Slot>

          {lead.events.length > 0 && (
            <ListSection header="Intake log">
              {lead.events.map((e) => (
                <ListRow
                  key={e.id}
                  title={
                    e.kind === "call_attempt"
                      ? `Call · ${OUTCOME_LABEL[e.outcome ?? ""] ?? e.outcome}`
                      : e.kind === "status"
                        ? `Status → ${e.outcome}`
                        : e.kind === "sla_breached"
                          ? `No response after ${e.outcome} min`
                          : e.kind === "note" && e.outcome === "lead_retry"
                            ? "Call-back task created"
                            : (EVENT_LABEL[e.kind] ?? e.kind)
                  }
                  subtitle={e.actorName ?? undefined}
                  detail={formatDateTime(e.createdAt, tz)}
                />
              ))}
            </ListSection>
          )}

          <Slot>
            <ActivityTimeline
              entity={{ type: "lead", id: lead.id }}
              limit={25}
            />
          </Slot>

          {p.has("settings.api_keys") && lead.events.some((e) => e.raw) && (
            <details className="list-card px-4 py-3">
              <summary className="min-h-11 cursor-pointer content-center text-subhead font-medium">
                Raw payload (admins)
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-control bg-fill-2 p-3 font-mono text-caption">
                {JSON.stringify(
                  lead.events.find(
                    (e) => e.kind === "received" || e.kind === "spam",
                  )?.raw ?? lead.events.find((e) => e.raw)?.raw,
                  null,
                  2,
                )}
              </pre>
              {lead.leadSourceId && (
                <Link
                  href={`/settings/lead-sources/${lead.leadSourceId}`}
                  className="mt-2 inline-block min-h-11 content-center text-subhead text-accent-text"
                >
                  Open the source's test console
                </Link>
              )}
            </details>
          )}
        </ListGroup>
      </Page>
    </ActionRailFrame>
  );

  return (
    <PageTransition>
      <SplitView
        showDetail
        list={<LeadsPane filter={filter} viewer={user} activeId={lead.id} />}
        detail={detail}
      />
    </PageTransition>
  );
}
