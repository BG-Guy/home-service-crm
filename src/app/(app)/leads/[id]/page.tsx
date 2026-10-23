import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { getMapConfig } from "@/adapters/maps";
import { CustomerCard } from "@/features/customers/slots";
import { NotesPanel } from "@/features/jobs/slots";
import { LazyLeadComposer } from "@/features/leads/components/LazyLeadComposer";
import {
  LeadBookingBar,
  LeadCardBody,
} from "@/features/leads/components/LeadCardBody";
import { LeadEnvProvider } from "@/features/leads/components/LeadProviders";
import { EVENT_LABEL, OUTCOME_LABEL } from "@/features/leads/labels";
import { getLeadCard, getLeadDetail } from "@/features/leads/queries";
import { ActivityTimeline } from "@/features/notify/slots";
import { getCustomFieldDefs } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import {
  ListGroup,
  ListRow,
  ListSection,
  SectionHeader,
} from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { SkeletonCard } from "@/ui/components/Skeleton";
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

/**
 * The lead page (for links and printing): the same card as the inbox's sheet
 * (TL;DR, boxes, action groups, booking bar), then the lead's history: source
 * and attribution, notes, the intake log and the activity.
 */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("leads.view");
  if (!(await isEnabled("leads"))) notFound();
  const { id } = await params;
  let card: Awaited<ReturnType<typeof getLeadCard>>;
  let lead: Awaited<ReturnType<typeof getLeadDetail>>;
  try {
    [card, lead] = await Promise.all([
      getLeadCard(user, id),
      getLeadDetail(user, id),
    ]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const p = user.perms;
  const canEdit = p.has("leads.edit");
  const [settings, tz, customDefs] = await Promise.all([
    getSettings(),
    getCompanyTimezone(),
    getCustomFieldDefs("lead").catch(() => []),
  ]);
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

  return (
    <PageTransition>
      <LeadEnvProvider
        init={{
          viewerId: user.id,
          can: {
            edit: canEdit,
            convert: p.has("leads.convert"),
            viewCustomers: p.has("customers.view"),
          },
          lostReasons: settings.leads.lost_reasons,
          tileUrl: getMapConfig(settings.map).tileUrl,
        }}
      >
        <NavBar back={{ href: "/leads", label: "Leads" }} title={card.name} />
        <Page className="pt-3">
          <div className="mx-auto flex max-w-[720px] flex-col gap-[var(--section-gap)]">
            <LeadCardBody lead={card} variant="page" />

            {lead.customerId && open && canEdit && (
              <section aria-labelledby="lead-text-h">
                <SectionHeader id="lead-text-h" title="Text them" />
                <div className="list-card px-3 py-3">
                  <LazyLeadComposer
                    customerId={lead.customerId}
                    leadId={lead.id}
                  />
                </div>
              </section>
            )}

            <ListGroup>
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
                variant="title"
                header="Source & attribution"
                footer={
                  lead.smsConsent
                    ? "SMS consent was captured with this request (unchecked box, text shown, page, IP and browser recorded)."
                    : "No SMS consent with this request. Texts about the request itself (replies, booking, reminders) can still go out; marketing texts need consent first."
                }
              >
                <ListRow title="Source" detail={lead.sourceName ?? "—"} />
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
                <ListSection variant="title" header="More details">
                  {customDefs
                    .filter(
                      (d) => custom[d.key] != null && custom[d.key] !== "",
                    )
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
                          {typeof v === "object"
                            ? JSON.stringify(v)
                            : String(v)}
                        </span>
                      }
                      multiline
                    />
                  ))}
                </ListSection>
              ) : null}

              <Slot>
                <NotesPanel
                  entity={{ type: "lead", id: lead.id }}
                  customerId={lead.customerId ?? undefined}
                  allowCustomerVisible={false}
                />
              </Slot>

              {lead.events.length > 0 && (
                <ListSection variant="title" header="Intake log">
                  {lead.events.map((e) => {
                    const raw = (e.raw ?? {}) as {
                      from?: string;
                      review?: string;
                      undo_of?: string;
                      reason?: string;
                    };
                    return (
                      <ListRow
                        key={e.id}
                        title={
                          e.kind === "call_attempt"
                            ? `Call · ${OUTCOME_LABEL[e.outcome ?? ""] ?? e.outcome}`
                            : e.kind === "status"
                              ? raw.undo_of
                                ? `Undone · back to ${e.outcome}`
                                : raw.review === "legit" &&
                                    raw.from === e.outcome
                                  ? "Looks legit"
                                  : `Status → ${e.outcome}`
                              : e.kind === "sla_breached"
                                ? `No response after ${e.outcome} min`
                                : e.kind === "note" &&
                                    e.outcome === "lead_retry"
                                  ? "Call-back task created"
                                  : e.kind === "touch" &&
                                      raw.reason === "repeat_caller"
                                    ? "Called again"
                                    : (EVENT_LABEL[e.kind] ?? e.kind)
                        }
                        subtitle={e.actorName ?? undefined}
                        detail={formatDateTime(e.createdAt, tz)}
                      />
                    );
                  })}
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
                      Open the source&apos;s test console
                    </Link>
                  )}
                </details>
              )}
            </ListGroup>
            <LeadBookingBar lead={card} variant="page" />
          </div>
        </Page>
      </LeadEnvProvider>
    </PageTransition>
  );
}
