import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listStatements } from "@/features/payroll/queries";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Statements" };

export default async function StatementsPage() {
  await requireUser("payroll.view_own");
  if (!(await isEnabled("payroll"))) notFound();
  const rows = await listStatements();
  return (
    <PageTransition>
      <NavBar title="Statements" back={{ href: "/pay", label: "Pay" }} />
      <Page className="pt-4">
        {rows.length === 0 ? (
          <div className="list-card">
            <EmptyState
              icon={<FileText size={44} strokeWidth={1.5} />}
              title="No statements yet"
              message="A statement is created when each pay period closes. You get 48 hours to review it."
            />
          </div>
        ) : (
          <ListSection>
            {rows.map((r) => (
              <ListRow
                key={r.id}
                href={`/pay/statements/${r.id}`}
                multiline
                title={`${formatDateKey(r.startsOn)} – ${formatDateKey(r.endsOn)}`}
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusPill kind="settlement" status={r.status} size="sm" />
                    {!r.acknowledged && r.status !== "draft" && (
                      <Pill size="sm" tone="orange">
                        To acknowledge
                      </Pill>
                    )}
                    {r.paidCents > 0 && (
                      <span>Paid {formatMoney(r.paidCents)}</span>
                    )}
                  </span>
                }
                detail={
                  <span
                    className={`num font-semibold ${r.closingCents < 0 ? "text-danger" : "text-label"}`}
                  >
                    {formatMoney(r.closingCents)}
                  </span>
                }
              />
            ))}
          </ListSection>
        )}
      </Page>
    </PageTransition>
  );
}
