import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerCard } from "@/features/customers/slots";
import { assertEstimateAccess } from "@/features/estimates/access";
import { draftInvoiceImpact, workState } from "@/features/estimates/api";
import { complianceNotes } from "@/features/estimates/compliance";
import { ApprovedSummary } from "@/features/estimates/components/ApprovedSummary";
import {
  EstimateActionsProvider,
  EstimateBar,
  EstimateBuilder,
} from "@/features/estimates/components/EstimateBuilder";
import { EstimateDocument } from "@/features/estimates/components/EstimateDocument";
import { EstimatePhotos } from "@/features/estimates/components/EstimatePhotos";
import {
  LazyAfterSigning,
  LazyChooseEstimatePhotos,
  LazyEstimatePhotoButton,
} from "@/features/estimates/components/islands";
import { PreviewEstimateButton } from "@/features/estimates/components/PresentEstimateButton";
import {
  loadEstimateDocForViewer,
  replacementFor,
} from "@/features/estimates/doc";
import { isEstimateOpen } from "@/features/estimates/logic";
import { ActivityTimeline } from "@/features/notify/slots";
import { getEntityTags } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { stageStyle } from "@/lib/stage-colors";
import { dateKey, formatDate, formatDateTime } from "@/lib/time";
import { DetailLayout, Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { StatusPill } from "@/ui/components/StatusPill";
import { Morph } from "@/ui/motion/Morph";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Estimate" };

// Estimate builder (SPEC M07; Quote to Paid E2): option pills, item cards, the price
// book one tap per item, discounts within the role limit, deposit preview (B4),
// cooling-off + compliance warnings, problem photos (S24), then Present (the main
// button), Send, Sign here, Preview; the approval record once signed. Violet:
// the estimate stage color (`stageStyle`).
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
  const e = doc.estimate;
  const open = isEstimateOpen(e.status);
  const [settings, company, tagMap, impact, replacedBy, work] =
    await Promise.all([
      getSettings(),
      findCompany(),
      getEntityTags([{ type: "estimate", id }]).catch(() => ({})),
      open && doc.job ? draftInvoiceImpact(doc.job.id) : Promise.resolve(null),
      e.status === "superseded" ? replacementFor(e) : Promise.resolve(null),
      e.status === "approved" ? workState(e.id) : Promise.resolve(null),
    ]);
  const tz = doc.timezone;
  const canCreate = user.perms.has("estimates.create");
  const canSend = user.perms.has("estimates.send");
  const compliance = complianceNotes({
    contractKind: doc.serviceType?.contractKind ?? null,
    state: company?.address?.state ?? null,
    enabled: settings.compliance.contract_templates,
  });
  const approvedOption = doc.options.find((o) => o.id === e.approvedOptionId);
  const anyLines = doc.options.some((o) => o.lines.length > 0);
  const recommended = doc.options.find((o) => o.recommended) ?? doc.options[0];
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
  const subline = [e.title, doc.propertyLines[0]].filter(Boolean).join(" · ");

  return (
    <PageTransition>
      <div className="contents" style={stageStyle("estimate")}>
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
          trailing={
            open && canSend ? (
              <PreviewEstimateButton estimateId={e.id} disabled={!anyLines} />
            ) : undefined
          }
        />
        <Page className="pt-4">
          {/* Print shows only the estimate as paper (QA T4-08); the builder and the
            side panels are app chrome and carry print:hidden. */}
          <EstimateDocument doc={doc} className="hidden print:block" />
          <EstimateActionsProvider initialOptionId={recommended?.id}>
            <DetailLayout
              className="print:hidden"
              railLabel="Estimate summary"
              bar={
                open && canSend ? (
                  <EstimateBar
                    estimateId={e.id}
                    status={e.status}
                    canSend={canSend}
                    options={doc.options.map((o) => ({
                      id: o.id,
                      label: o.label,
                      recommended: o.recommended,
                      totalCents: o.totals.totalCents,
                      lineCount: o.lines.length,
                    }))}
                  />
                ) : undefined
              }
              rail={RAIL}
            >
              <section className="flex items-center gap-3 px-1">
                <Avatar name={doc.customer.displayName} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-title3 font-semibold text-label">
                    {doc.customer.displayName}
                  </p>
                  <Morph name={`estimate-${e.id}-title`}>
                    <p className="truncate text-subhead text-label-2">
                      {subline || e.number}
                    </p>
                  </Morph>
                  {e.expiresAt && open ? (
                    <p className="text-footnote text-label-2">
                      Valid until {formatDate(e.expiresAt, tz)}
                    </p>
                  ) : null}
                </div>
                <StatusPill kind="estimate" status={e.status} />
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
                  Reopen it to give the customer a new window.
                </Banner>
              ) : null}
              {e.status === "superseded" ? (
                <Banner tone="warning" title="Replaced">
                  {replacedBy ? (
                    <>
                      <Link
                        href={`/estimates/${replacedBy.id}`}
                        className="font-semibold text-accent-text"
                      >
                        {replacedBy.number}
                      </Link>{" "}
                      was approved for this job, so this one can't be signed.
                    </>
                  ) : (
                    "Another estimate on this job was approved, so this one can't be signed."
                  )}{" "}
                  Reopen it if the customer wants this one instead.
                </Banner>
              ) : null}
              {impact ? (
                <Banner
                  tone="info"
                  title="Approving replaces the invoice's lines"
                >
                  Approving this replaces{" "}
                  <Link
                    href={`/invoices/${impact.invoiceId}`}
                    className="font-semibold text-accent-text"
                  >
                    {impact.number}
                  </Link>
                  's lines ({formatMoney(impact.totalCents)} now), so the work
                  is billed once.
                  {impact.partsKept > 0
                    ? " Parts already used on the job stay on it."
                    : ""}
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
              {approvedOption ? (
                <ApprovedSummary
                  number={e.number}
                  optionLabel={approvedOption.label}
                  multi={doc.options.length > 1}
                  totalCents={approvedOption.totals.totalCents}
                  signature={doc.signature}
                  policyVersions={doc.policies.map((p) => p.version)}
                  timezone={tz}
                  job={work?.job ?? doc.job}
                  invoice={work?.invoice ?? null}
                />
              ) : null}
              {work?.linesSkipped && work.invoice ? (
                <Banner
                  tone="warning"
                  title={`${work.invoice.number} was already sent`}
                  action={
                    <Link
                      href={`/invoices/${work.invoice.id}`}
                      className="whitespace-nowrap text-subhead font-semibold text-accent-text"
                    >
                      Open {work.invoice.number}
                    </Link>
                  }
                >
                  So these lines weren't added. The office can revise it.
                </Banner>
              ) : null}
              {work ? (
                <LazyAfterSigning
                  estimateId={e.id}
                  mode={work.mode}
                  job={work.job}
                  originJob={work.originJob}
                  canScheduleLater={work.canScheduleLater && canSend}
                  canMoveBack={work.canMoveBack && canSend}
                  locked={work.linesSkipped ? null : work.locked}
                  deposit={work.deposit}
                  canCollect={user.perms.has("payments.collect")}
                />
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
                options={(approvedOption ? [approvedOption] : doc.options).map(
                  (o) => ({
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
                  }),
                )}
                taxBps={doc.taxBps}
                taxExempt={doc.customer.taxExempt}
                open={open}
                perms={{
                  create: canCreate,
                  send: canSend,
                  approveOnBehalf: user.perms.has(
                    "estimates.approve_on_behalf",
                  ),
                  discount: user.perms.has("estimates.discount"),
                  showCost:
                    user.baseRole !== "tech" ||
                    user.perms.has("jobs.view_financials"),
                }}
                consentText={doc.consentText}
                coolingOff={doc.coolingOff}
                actions={
                  open && canCreate && doc.job ? (
                    <LazyEstimatePhotoButton
                      estimateId={e.id}
                      jobId={doc.job.id}
                    />
                  ) : undefined
                }
              >
                {doc.job ? (
                  <section
                    aria-label="Estimate photos"
                    className="flex flex-col gap-2"
                  >
                    <div className="flex min-h-11 items-center justify-between gap-2 px-1">
                      <h2 className="text-headline">Photos</h2>
                      {open && canCreate ? (
                        <LazyChooseEstimatePhotos
                          estimateId={e.id}
                          jobId={doc.job.id}
                          selected={
                            doc.photosAttached
                              ? doc.problemPhotos.map((p) => p.id)
                              : []
                          }
                        />
                      ) : null}
                    </div>
                    {doc.problemPhotos.length > 0 ? (
                      <EstimatePhotos
                        photos={doc.problemPhotos}
                        title={null}
                        compact
                      />
                    ) : (
                      <p className="px-1 text-subhead text-label-2">
                        No photos yet. Add one of the problem and one of how it
                        should look after: the customer sees them with the
                        options.
                      </p>
                    )}
                    {!doc.photosAttached && doc.problemPhotos.length > 0 ? (
                      <p className="px-1 text-footnote text-label-2">
                        The customer sees the job's problem photos. Choose
                        photos to pick which ones.
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </EstimateBuilder>
            </DetailLayout>
          </EstimateActionsProvider>
        </Page>
      </div>
    </PageTransition>
  );
}
