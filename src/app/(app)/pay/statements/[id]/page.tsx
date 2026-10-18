import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/features/payroll/components/PrintButton";
import { StatementView } from "@/features/payroll/components/StatementView";
import { getStatement } from "@/features/payroll/queries";
import { requireUser } from "@/lib/auth/current";
import { isUuid } from "@/lib/ids";
import { getCompany, getCompanyTimezone, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Pay statement" };

export default async function StatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser("payroll.view_own");
  const { id } = await params;
  if (!isUuid(id) || !(await isEnabled("payroll"))) notFound();
  const st = await getStatement(id);
  const [company, tz] = await Promise.all([getCompany(), getCompanyTimezone()]);
  return (
    <PageTransition>
      <NavBar
        title="Statement"
        back={{ href: "/pay/statements", label: "Statements" }}
        trailing={<PrintButton label="Print pay stub" />}
      />
      <Page className="pt-4">
        <StatementView
          st={st}
          companyName={company.name}
          tz={tz}
          admin={false}
        />
      </Page>
    </PageTransition>
  );
}
