import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerCard } from "@/features/customers/slots";
import { assertEstimateAccess } from "@/features/estimates/access";
import { complianceNotes } from "@/features/estimates/compliance";
import {
  EstimateActionsProvider,
  EstimateBuilder,
  EstimateSendButton,
} from "@/features/estimates/components/EstimateBuilder";
import { EstimateDocument } from "@/features/estimates/components/EstimateDocument";
import { loadEstimateDocForViewer } from "@/features/estimates/doc";
import { isEstimateOpen } from "@/features/estimates/logic";
import { CameraCaptureButton } from "@/features/media/slots.client";
import { ActivityTimeline } from "@/features/notify/slots";
import { getEntityTags } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { dateKey, formatDate, formatDateTime } from "@/lib/time";
import { DetailLayout, Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import { StatusPill } from "@/ui/components/StatusPill";
import { Morph } from "@/ui/motion/Morph";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Estimate" };

// Estimate builder (SPEC M07; BUILD_PLAN §9 B3): options, lines, discount within the
// role limit, deposit preview (B4), cooling-off + compliance warnings, problem
// photos (S24), send / sign here (S15) / verbal / decline, then the approval record.
export default async function EstimatesIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser("estimates.view");
  if (!(await isEnabled("estimates")) || !isUuid(id)) notFound();
  try {
    await assertEstimateAccess(user, id, "read");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const doc = await loadEstimateDocForViewer(user, id);
  if (!doc) notFound();
  const [settings, company, tagMap] = await Promise.all([
    getSettings(),
    findCompany(),
    getEntityTags([{ type: "estimate", id }]).catch(() => ({})),
  ]);
  const e = doc.estimate;
  const tz = doc.timezone;
  const open = isEstimateOpen(e.status);
  const canCreate = user.perms.has("estimates.create");
  const compliance = complianceNotes({
    contractKind: doc.serviceType?.contractKind ?? null,
    state: company?.address?.state ?? null,
    enabled: settings.compliance.contract_templates,
  });
  const approvedOption = doc.options.find((o) => o.id === e.approvedOptionId);
  const RAIL = (
    <>
      <CustomerCard
        customerId={doc.customer.id}
        jobId={doc.job?.id}
        variant="compact"
      />
      {doc.job && canCreate && e.status === "approved" ? (
        <ListSection header="Changes after approval">
          <ListRow
            href={`/jobs/${doc.job.id}?tab=estimate`}
            title="Change orders"
            subtitle="Extra work beyond the signed amount needs a signed change order"
          />
        </ListSection>
      ) : null}
      {Object.values(doc.deposits).some(Boolean) && open ? (
        <ListSection header="Deposit">
          {doc.options.map((o) =>
            doc.deposits[o.id] ? (
              <ListRow
                key={o.id}
                title={o.label}
                subtitle={doc.deposits[o.id]?.ruleName}
                detail={formatMoney(doc.deposits[o.id]?.amountCents ?? 0)}
              />
            ) : null,
          )}
        </ListSection>
      ) : null}
      <ListSection header="Tags">
        <div className="px-4 py-3">
          <TagEditor
            entityType="estimate"
            entityId={e.id}
            initial={(tagMap as Record<string, never[]>)[e.id] ?? []}
            readOnly={!canCreate}
          />
        </div>
      </ListSection>
      <ActivityTimeline entity={{ type: "estimate", id: e.id }} limit={15} />
    </>
  );

  return (
    <PageTransition>
      <NavBar
        title={e.number}
        back={
          doc.job
            ? {
                href: `/jobs/${doc.job.id}?tab=estimate`,
                label: doc.job.number,
              }
            : { href: "/estimates", label: "Estimates" }
        }
      />
      <Page className="pt-4">
        {/* Print shows only the estimate as paper (QA T4-08); the builder and the
            side panels are app chrome and carry print:hidden. */}
        <EstimateDocument doc={doc} className="hidden print:block" />
        <EstimateActionsProvider>
          <DetailLayout
            className="print:hidden"
            railLabel="Estimate summary"
            bar={
              open && user.perms.has("estimates.send") ? (
                <BottomBar
                  label="Estimate actions"
                  summary={
                    <BarSummary
                      title={
                        <MoneyText
                          cents={
                            approvedOption?.totals.totalCents ??
                            doc.headlineCents
                          }
                        />
                      }
                      subtitle={
                        doc.options.length > 1 ? "Recommended option" : "Total"
                      }
                    />
                  }
                  action={
                    <EstimateSendButton
                      status={e.status}
                      disabled={!doc.options.some((o) => o.lines.length > 0)}
                    />
                  }
                />
              ) : undefined
            }
            rail={RAIL}
          >
            <section className="flex flex-col gap-1 px-1">
              <div className="flex flex-wrap items-center gap-2">
                <Morph name={`estimate-${e.id}-title`}>
                  <h1 className="inline-block text-headline text-label-2">
                    {e.title ? `${e.number} · ${e.title}` : e.number}
                  </h1>
                </Morph>
                <StatusPill kind="estimate" status={e.status} />
              </div>
              <p className="mt-1 text-footnote font-medium text-label-2">
                {approvedOption
                  ? `Approved · ${approvedOption.label}`
                  : doc.options.length > 1
                    ? "Recommended option"
                    : "Total"}
              </p>
              <MoneyText
                cents={approvedOption?.totals.totalCents ?? doc.headlineCents}
                className="text-large-title font-bold text-label"
              />
              <p className="text-subhead text-label-2">
                {doc.customer.displayName}
                {e.expiresAt && open
                  ? ` · valid until ${formatDate(e.expiresAt, tz)}`
                  : ""}
              </p>
            </section>

            {e.status === "viewed" && e.viewedAt ? (
              <Banner tone="info" title="The customer opened it">
                Viewed {formatDateTime(e.viewedAt, tz)}. Follow-ups continue
                until they decide.
              </Banner>
            ) : null}
            {e.status === "declined" ? (
              <Banner tone="error" title="Declined">
                {e.declineReason ?? "No reason given."}
              </Banner>
            ) : null}
            {e.status === "expired" ? (
              <Banner tone="warning" title="Expired">
                Reopen it from ••• to give the customer a new window.
              </Banner>
            ) : null}
            {open && doc.coolingOff ? (
              <Banner tone="legal" title="3-day cancellation notice attached">
                This sale at the customer's home goes beyond the requested
                repair, so the FTC Cooling-Off Rule applies: they may cancel
                within 3 business days. The notice prints and shows with the
                estimate.
              </Banner>
            ) : null}
            {open
              ? compliance.map((c) => (
                  <Banner key={c.title} tone="legal" title={c.title}>
                    {c.body}
                  </Banner>
                ))
              : null}
            {approvedOption && doc.signature ? (
              <ListSection
                header="Approval"
                footer={`Document fingerprint SHA-256 ${doc.signature.docSha256.slice(0, 16)}… · policies v${doc.policies.map((p) => p.version).join("/")}`}
              >
                <ListRow
                  title={`${doc.signature.signerName} · ${doc.signature.channel === "verbal" ? "verbal approval" : doc.signature.channel === "remote_link" ? "signed online" : "signed in person"}`}
                  subtitle={[
                    formatDateTime(doc.signature.signedAt, tz),
                    doc.signature.ip ? `IP ${doc.signature.ip}` : null,
                    doc.signature.lat != null ? "location captured" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  multiline
                />
                {doc.job ? (
                  <ListRow
                    href={`/jobs/${doc.job.id}?tab=invoice`}
                    title={`Job ${doc.job.number}`}
                    subtitle="Approved lines were added to the job's invoice"
                  />
                ) : null}
              </ListSection>
            ) : null}

            <EstimateBuilder
              estimate={{
                id: e.id,
                number: e.number,
                status: e.status,
                title: e.title,
                notes: e.notes,
                warrantyText: e.warrantyText,
                expiresOn: e.expiresAt ? dateKey(e.expiresAt, tz) : null,
                customerName: doc.customer.displayName,
                printHref: `/estimates/${e.id}/print`,
              }}
              options={doc.options.map((o) => ({
                id: o.id,
                label: o.label,
                recommended: o.recommended,
                notes: o.notes,
                deposit: doc.deposits[o.id] ?? null,
                lines: o.lines.map((l) => ({
                  id: l.id,
                  type: l.type as never,
                  pricebookItemId: l.pricebookItemId,
                  name: l.name,
                  description: l.description,
                  qty: Number(l.qty),
                  unitPriceCents: l.unitPriceCents,
                  unitCostCents: l.unitCostCents,
                  discountCents: l.discountCents,
                  taxable: l.taxable,
                  partSource: l.partSource as never,
                  warrantyDays: l.warrantyDays,
                  manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
                  serial: l.serial,
                  isServiceFee: l.isServiceFee,
                  isUpsell: l.isUpsell,
                  isOptional: l.isOptional,
                  isSelected: l.isSelected,
                  totalCents: l.totalCents,
                })),
              }))}
              taxBps={doc.taxBps}
              taxExempt={doc.customer.taxExempt}
              open={open}
              perms={{
                create: canCreate,
                send: user.perms.has("estimates.send"),
                approveOnBehalf: user.perms.has("estimates.approve_on_behalf"),
                discount: user.perms.has("estimates.discount"),
                showCost:
                  user.baseRole !== "tech" ||
                  user.perms.has("jobs.view_financials"),
              }}
              consentText={doc.consentText}
              coolingOff={doc.coolingOff}
              hidePrimary
            />

            {doc.job ? (
              <ListSection
                variant="title"
                header="Photos of the problem"
                footer="Problem photos show on the estimate the customer sees."
              >
                {doc.problemPhotos.length > 0 ? (
                  <div className="p-3">
                    <PhotoGrid
                      columns={4}
                      photos={doc.problemPhotos.map((p) => ({
                        id: p.id,
                        url: p.url,
                        thumbUrl: p.thumbUrl,
                        caption: p.caption,
                        alt: p.caption ?? "Problem photo",
                      }))}
                    />
                  </div>
                ) : null}
                {open && canCreate ? (
                  <div className="px-4 py-3">
                    <CameraCaptureButton
                      jobId={doc.job.id}
                      defaultTag="problem"
                      allowedTags={["problem"]}
                      label="Add problem photo"
                      multiple
                    />
                  </div>
                ) : null}
              </ListSection>
            ) : null}
          </DetailLayout>
        </EstimateActionsProvider>
      </Page>
    </PageTransition>
  );
}
