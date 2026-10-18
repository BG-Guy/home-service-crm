import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { assertChangeOrderAccess } from "@/features/estimates/access";
import {
  DEFAULT_ESIGN_CONSENT,
  loadChangeOrder,
} from "@/features/estimates/api";
import { ChangeOrderEditor } from "@/features/estimates/components/ChangeOrderEditor";
import { getLatestSignature } from "@/features/signatures/api";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { ActionRailFrame } from "@/ui/components/PageActions";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Change order" };

// Change order (SPEC M07; BUILD_PLAN §3.3 /estimates/co/[id]): the delta over the
// signed estimate, signed in person (S15), remotely (/e/ link) or verbally.
export default async function EstimatesCoIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser("estimates.view");
  if (!(await isEnabled("estimates")) || !isUuid(id)) notFound();
  try {
    await assertChangeOrderAccess(user, id, "read");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [loaded, tz, esign, sig] = await Promise.all([
    loadChangeOrder(id),
    getCompanyTimezone(),
    getCurrentPolicy("esign_consent"),
    getLatestSignature("change_order", id),
  ]);
  if (!loaded) notFound();
  const co = loaded.changeOrder;
  return (
    <PageTransition>
      <ActionRailFrame
        compact
        enabled={
          user.perms.has("estimates.create") ||
          user.perms.has("estimates.approve_on_behalf")
        }
      >
        <NavBar
          title={co.number}
          back={{
            href: `/jobs/${loaded.job.id}?tab=estimate`,
            label: loaded.job.number,
          }}
        />
        <Page className="max-w-2xl space-y-6 pt-4">
          <section className="px-1">
            <StatusPill kind="changeOrder" status={co.status} />
            <p className="mt-2 text-footnote text-label-2">Additional amount</p>
            <MoneyText
              cents={loaded.totals.totalCents}
              signed
              className="text-large-title font-bold"
            />
            <p className="text-subhead text-label-2">
              {loaded.customer.displayName} · Job {loaded.job.number}
            </p>
          </section>
          {co.status === "approved" && sig ? (
            <Banner tone="success" title="Approved">
              {sig.signerName} ·{" "}
              {sig.channel === "verbal"
                ? "verbal"
                : sig.channel.replace("_", " ")}{" "}
              · {formatDateTime(sig.signedAt, tz)}. The lines were added to the
              job's invoice.
            </Banner>
          ) : null}
          {co.status === "declined" ? (
            <Banner tone="error" title="Declined">
              The extra work wasn't approved. Don't do it without a new signed
              change order.
            </Banner>
          ) : null}
          <ChangeOrderEditor
            co={{
              id: co.id,
              number: co.number,
              status: co.status,
              reason: co.reason,
            }}
            lines={loaded.lines.map((l) => ({
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
              totalCents: l.totalCents,
            }))}
            taxBps={loaded.taxBps}
            taxExempt={loaded.customer.taxExempt}
            customerName={loaded.customer.displayName}
            consentText={esign?.body ?? DEFAULT_ESIGN_CONSENT}
            totalCents={loaded.totals.totalCents}
            previousCents={
              co.status === "approved"
                ? loaded.signedTotalCents == null
                  ? null
                  : loaded.signedTotalCents - loaded.totals.totalCents
                : loaded.signedTotalCents
            }
            perms={{
              create: user.perms.has("estimates.create"),
              send: user.perms.has("estimates.send"),
              approveOnBehalf: user.perms.has("estimates.approve_on_behalf"),
              discount: user.perms.has("estimates.discount"),
              showCost:
                user.baseRole !== "tech" ||
                user.perms.has("jobs.view_financials"),
            }}
          />
        </Page>
      </ActionRailFrame>
    </PageTransition>
  );
}
