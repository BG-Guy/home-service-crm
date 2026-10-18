import { CalendarPlus, FileSignature, FileText, Merge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { CallButton } from "@/features/customers/components/CallButton";
import { CustomerMenu } from "@/features/customers/components/CustomerMenu";
import {
  CustomersPane,
  filterFromSearchParams,
} from "@/features/customers/components/CustomersPane";
import { EmailLink } from "@/features/customers/components/EmailLink";
import { FlagsEditor } from "@/features/customers/components/FlagsEditor";
import { PropertiesList } from "@/features/customers/components/PropertiesList";
import {
  getCustomerDetail,
  getCustomerEditable,
} from "@/features/customers/queries";
import { CustomerCard } from "@/features/customers/slots";
import { CustomerEstimatesPanel } from "@/features/estimates/slots";
import { CustomerInvoicesPanel } from "@/features/invoices/slots";
import { CustomerJobsPanel, NotesPanel } from "@/features/jobs/slots";
import { ConsentPanel } from "@/features/messaging/slots";
import { ActivityTimeline } from "@/features/notify/slots";
import { CustomerPaymentsPanel } from "@/features/payments/slots";
import { RecordPaymentButton } from "@/features/payments/slots.client";
import { RequestReviewButton } from "@/features/reviews/slots.client";
import { getCustomFieldDefs } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Page, SplitView } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { SkeletonCard } from "@/ui/components/Skeleton";
import { StatCard } from "@/ui/components/StatCard";
import { PageTransition } from "@/ui/motion/PageTransition";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const c = await getCustomerDetail(id);
    return { title: c.displayName };
  } catch {
    return { title: "Customer" };
  }
}

const CHANNEL_LABEL: Record<string, string> = {
  sms: "Text message",
  call: "Phone call",
  email: "Email",
  whatsapp: "WhatsApp",
};

function Slot({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SkeletonCard lines={3} />}>{children}</Suspense>;
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className="pressable flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-card bg-card px-2 text-center text-footnote font-medium text-accent-text shadow-card"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </Link>
  );
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const c = await getCustomerDetail(id);
  if (c.mergedIntoId) redirect(`/customers/${c.mergedIntoId}`);

  const p = user.perms;
  const canEdit = p.has("customers.edit");
  const isTech = user.baseRole === "tech";
  const anonymized = !!c.anonymizedAt;
  const [customDefs, propertyDefs, editable, estimatesOn, tz] =
    await Promise.all([
      getCustomFieldDefs("customer").catch(() => []),
      getCustomFieldDefs("property").catch(() => []),
      canEdit ? getCustomerEditable(id) : Promise.resolve(null),
      isEnabled("estimates"),
      getCompanyTimezone(),
    ]);
  const customValues = customDefs
    .filter((d) => c.custom[d.key] != null && c.custom[d.key] !== "")
    .map((d) => ({
      key: d.key,
      label: d.label,
      value: Array.isArray(c.custom[d.key])
        ? (c.custom[d.key] as unknown[]).join(", ")
        : typeof c.custom[d.key] === "boolean"
          ? c.custom[d.key]
            ? "Yes"
            : "No"
          : String(c.custom[d.key]),
    }));
  const filter = filterFromSearchParams(sp);
  const backHref = filter.q
    ? `/customers?q=${encodeURIComponent(filter.q)}`
    : "/customers";
  const firstTouch = c.firstTouch as Record<string, string> | null;

  const detail = (
    <>
      <NavBar
        back={{ href: backHref, label: "Customers" }}
        title={c.displayName}
        trailing={
          <CustomerMenu
            customer={editable}
            customDefs={customDefs}
            canEdit={canEdit}
            canMerge={p.has("customers.merge")}
            canDelete={p.has("customers.delete")}
            archived={!!c.deletedAt}
            anonymized={anonymized}
          />
        }
      />
      <Page className="pt-2">
        <ListGroup>
          {(anonymized || c.deletedAt || c.flags.doNotService) && (
            <div className="flex flex-col gap-2">
              {anonymized && (
                <Banner tone="info" title="Anonymized">
                  Personal details were removed on{" "}
                  {formatDate(c.anonymizedAt, tz)}. Financial records are kept.
                </Banner>
              )}
              {c.deletedAt && !anonymized && (
                <Banner tone="warning" title="Archived">
                  This customer is hidden from lists and search.
                </Banner>
              )}
              {c.flags.doNotService && (
                <Banner tone="error" title="Do not service">
                  Check with the office before booking or sending anyone.
                </Banner>
              )}
            </div>
          )}

          <CustomerCard
            customerId={c.id}
            variant="header"
            showActions={!anonymized}
          />

          {!anonymized && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {p.has("jobs.create") && (
                <QuickAction
                  href={`/jobs/new?customerId=${c.id}`}
                  icon={<CalendarPlus size={20} />}
                  label="New job"
                />
              )}
              {estimatesOn && p.has("estimates.create") && (
                <QuickAction
                  href={`/estimates/new?customerId=${c.id}`}
                  icon={<FileSignature size={20} />}
                  label="Estimate"
                />
              )}
              {p.has("invoices.view") && (
                <QuickAction
                  href={`/invoices/statement/${c.id}`}
                  icon={<FileText size={20} />}
                  label="Statement"
                />
              )}
              {p.has("customers.merge") && (
                <QuickAction
                  href={`/customers/${c.id}/merge`}
                  icon={<Merge size={20} />}
                  label="Merge"
                />
              )}
            </div>
          )}

          {!anonymized && (p.has("payments.record_manual") || !isTech) && (
            <div className="flex flex-wrap gap-2 empty:hidden">
              <RecordPaymentButton customerId={c.id} />
              {!isTech && <RequestReviewButton customerId={c.id} />}
            </div>
          )}

          {/* 2 columns on phones so money never truncates (T4-05); a lone third tile spans both. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {c.balanceCents != null && (
              <StatCard
                label="Balance"
                value={
                  // Same format as Lifetime: whole amounts drop ".00" (QA2 NEW-12).
                  <MoneyText
                    cents={c.balanceCents}
                    compactWhole
                    className={c.balanceCents > 0 ? "text-warning" : undefined}
                  />
                }
                href={
                  p.has("invoices.view")
                    ? `/invoices/statement/${c.id}`
                    : undefined
                }
              />
            )}
            {p.has("invoices.view") && (
              <StatCard
                label="Lifetime"
                value={<MoneyText cents={c.lifetimeCents} compactWhole />}
              />
            )}
            <StatCard
              label="Jobs"
              value={c.jobCount}
              className={
                (c.balanceCents != null ? 1 : 0) +
                  (p.has("invoices.view") ? 1 : 0) ===
                2
                  ? "col-span-2 sm:col-span-1"
                  : undefined
              }
            />
          </div>

          {!anonymized && (
            <ListSection header="Contact">
              {c.phoneDisplay ? (
                <CallButton
                  customerId={c.id}
                  variant="row"
                  label={c.phoneDisplay}
                  subtitle={
                    c.contactRevealed
                      ? "Mobile"
                      : "Number shows from 2 h before your visit"
                  }
                  disabled={!c.contactRevealed}
                />
              ) : (
                <ListRow
                  title={<span className="text-label-2">No phone number</span>}
                />
              )}
              {c.phoneAltDisplay ? (
                <CallButton
                  customerId={c.id}
                  which="phoneAlt"
                  variant="row"
                  label={c.phoneAltDisplay}
                  subtitle="Other"
                  disabled={!c.contactRevealed}
                />
              ) : null}
              {c.email && c.contactRevealed ? (
                <EmailLink customerId={c.id} label={c.email} />
              ) : c.email ? (
                <ListRow title={c.email} subtitle="Email" />
              ) : null}
              <ListRow
                title="Prefers"
                detail={CHANNEL_LABEL[c.preferredChannel] ?? c.preferredChannel}
              />
              {c.language !== "en" ? (
                <ListRow title="Language" detail={c.language.toUpperCase()} />
              ) : null}
              {c.sourceName || c.source ? (
                <ListRow
                  title="Source"
                  detail={c.sourceName ?? c.source}
                  subtitle={
                    firstTouch?.utm_source
                      ? `${firstTouch.utm_source}${firstTouch.utm_campaign ? ` · ${firstTouch.utm_campaign}` : ""}`
                      : undefined
                  }
                />
              ) : null}
              <ListRow
                title="Customer since"
                detail={formatDate(c.createdAt, tz)}
              />
              {c.openLeadCount > 0 && p.has("leads.view") ? (
                <ListRow
                  title="Open leads"
                  detail={String(c.openLeadCount)}
                  href={`/leads?q=${encodeURIComponent(c.displayName)}`}
                />
              ) : null}
            </ListSection>
          )}

          {c.notes && !anonymized ? (
            <ListSection header="Notes">
              <ListRow
                title={<span className="whitespace-pre-wrap">{c.notes}</span>}
                multiline
              />
            </ListSection>
          ) : null}

          {!anonymized && (
            <PropertiesList
              customerId={c.id}
              properties={c.properties}
              canAdd={p.has("customers.create")}
              canEdit={canEdit}
              defs={propertyDefs}
            />
          )}

          <Slot>
            <CustomerJobsPanel customerId={c.id} limit={8} />
          </Slot>
          <Slot>
            <CustomerEstimatesPanel customerId={c.id} />
          </Slot>
          <Slot>
            <CustomerInvoicesPanel customerId={c.id} />
          </Slot>
          <Slot>
            <CustomerPaymentsPanel customerId={c.id} />
          </Slot>
          <Slot>
            <NotesPanel
              entity={{ type: "customer", id: c.id }}
              customerId={c.id}
              allowCustomerVisible={false}
            />
          </Slot>

          {(customValues.length > 0 || canEdit) && (
            <section className="flex flex-col gap-2">
              <h2 className="px-4 text-footnote uppercase text-label-2">
                Tags
              </h2>
              <div className="list-card px-4 py-3">
                {canEdit ? (
                  <TagEditor
                    entityType="customer"
                    entityId={c.id}
                    initial={c.tags}
                  />
                ) : (
                  <span className="text-subhead text-label-2">
                    {c.tags.map((t) => t.name).join(", ") || "No tags"}
                  </span>
                )}
              </div>
            </section>
          )}
          {customValues.length > 0 && (
            <ListSection header="Details">
              {customValues.map((v) => (
                <ListRow key={v.key} title={v.label} detail={v.value} />
              ))}
            </ListSection>
          )}

          <Slot>
            <ActivityTimeline customerId={c.id} showFilterChips limit={25} />
          </Slot>

          {!isTech && (
            <Slot>
              <ConsentPanel customerId={c.id} />
            </Slot>
          )}

          {p.has("customers.flags_manage") && !anonymized && (
            <FlagsEditor customerId={c.id} flags={c.flags} />
          )}
        </ListGroup>
      </Page>
    </>
  );

  return (
    <PageTransition>
      <SplitView
        showDetail
        list={<CustomersPane filter={filter} viewer={user} activeId={c.id} />}
        detail={detail}
      />
    </PageTransition>
  );
}
