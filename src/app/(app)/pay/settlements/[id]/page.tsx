import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/features/payroll/components/PrintButton";
import {
  AdjustmentButton,
  ApproveButton,
  CloseNoPayoutButton,
  MarkVerifiedButton,
  RecordPayoutButton,
} from "@/features/payroll/components/SettlementAdmin";
import { StatementView } from "@/features/payroll/components/StatementView";
import { getStatement } from "@/features/payroll/queries";
import { requireUser } from "@/lib/auth/current";
import { isUuid } from "@/lib/ids";
import {
  getCompany,
  getCompanyTimezone,
  getSettings,
  isEnabled,
} from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Settlement" };

export default async function SettlementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("payroll.view_all");
  const { id } = await params;
  if (!isUuid(id) || !(await isEnabled("payroll"))) notFound();
  const st = await getStatement(id);
  const [company, tz, s] = await Promise.all([
    getCompany(),
    getCompanyTimezone(),
    getSettings(),
  ]);
  const soft = st.status === "tech_review" || st.status === "draft";
  const inWindow =
    soft &&
    !st.settlement.techAckAt &&
    !!st.settlement.reviewDeadline &&
    st.settlement.reviewDeadline.getTime() > Date.now();
  const openFlags = st.flags.filter((f) => f.status === "open").length;
  const bankHold =
    !!st.tech.bankChangedAt &&
    Date.now() - st.tech.bankChangedAt.getTime() <
      s.payroll.bank_change_hold_hours * 3_600_000 &&
    !(
      st.tech.bankVerifiedAt && st.tech.bankVerifiedAt >= st.tech.bankChangedAt
    );

  return (
    <PageTransition>
      <NavBar
        title={st.tech.name}
        back={{ href: "/pay/settlements", label: "Payroll" }}
        trailing={<PrintButton label="Print pay stub" />}
      />
      <Page wide className="pt-4">
        <div className="flex flex-col gap-4">
          {bankHold && (
            <Banner
              tone="warning"
              title="Bank details changed recently"
              action={
                user.perms.has("payroll.payout") ? (
                  <MarkVerifiedButton userId={st.tech.id} name={st.tech.name} />
                ) : undefined
              }
            >
              Direct deposit is held for {s.payroll.bank_change_hold_hours}{" "}
              hours unless you confirm the change with {st.tech.name} by phone.
            </Banner>
          )}
          {openFlags > 0 && (
            <Banner
              tone="error"
              title={`${openFlags} flagged line${openFlags === 1 ? "" : "s"}`}
              action={undefined}
            >
              Resolve the tech&apos;s flags in Approvals before approving.
            </Banner>
          )}
          <div className="flex flex-wrap gap-2 print:hidden">
            {soft && user.perms.has("payroll.approve") && (
              <ApproveButton
                settlementId={st.settlement.id}
                inReview={inWindow}
                disabledReason={openFlags ? "Resolve the flags first" : null}
              />
            )}
            {st.status === "approved" &&
              st.owedCents > 0 &&
              user.perms.has("payroll.payout") && (
                <RecordPayoutButton
                  userId={st.tech.id}
                  settlementIds={[st.settlement.id]}
                  owedCents={st.owedCents}
                  name={st.tech.name}
                  hasBank={st.tech.hasBank}
                />
              )}
            {st.status === "approved" &&
              st.owedCents === 0 &&
              user.perms.has("payroll.approve") && (
                <CloseNoPayoutButton settlementId={st.settlement.id} />
              )}
            {user.perms.has("payroll.manage") && (
              <AdjustmentButton
                userId={st.tech.id}
                settlementId={soft ? st.settlement.id : null}
                defaultDate={
                  soft
                    ? st.period.endsOn
                    : new Date().toISOString().slice(0, 10)
                }
              />
            )}
          </div>
          <StatementView st={st} companyName={company.name} tz={tz} admin />
        </div>
      </Page>
    </PageTransition>
  );
}
