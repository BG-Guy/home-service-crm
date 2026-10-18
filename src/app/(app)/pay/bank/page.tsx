import { eq } from "drizzle-orm";
import { Landmark, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { BankForm } from "@/features/payroll/components/BankForm";
import { requireUser } from "@/lib/auth/current";
import { getCurrentPolicy } from "@/lib/policies";
import {
  findCompany,
  getCompanyTimezone,
  getSettings,
  isEnabled,
} from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Direct deposit" };

export default async function BankPage() {
  const user = await requireUser("payroll.bank_edit_own");
  if (!(await isEnabled("payroll"))) notFound();
  const [u] = await db
    .select({
      last4: users.bankLast4,
      type: users.bankAccountType,
      holder: users.bankHolderType,
      changedAt: users.bankChangedAt,
      verifiedAt: users.bankVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const [s, tz, policy, company] = await Promise.all([
    getSettings(),
    getCompanyTimezone(),
    getCurrentPolicy("direct_deposit_auth"),
    findCompany(),
  ]);
  // Policy texts are written with a {company} placeholder (QA T3-17).
  const fill = (t: string) =>
    t.replaceAll("{company}", company?.name || "the company");
  const hold =
    !!u?.changedAt &&
    Date.now() - u.changedAt.getTime() <
      s.payroll.bank_change_hold_hours * 3_600_000 &&
    !(u.verifiedAt && u.verifiedAt >= u.changedAt);

  return (
    <PageTransition>
      <NavBar title="Direct deposit" back={{ href: "/pay", label: "Pay" }} />
      <Page className="pt-4">
        <div className="flex flex-col gap-[var(--section-gap)]">
          {u?.last4 && (
            <ListSection header="On file">
              <ListRow
                icon={<Landmark size={18} aria-hidden />}
                title={`${u.type === "savings" ? "Savings" : "Checking"} ••${u.last4}`}
                subtitle={`${u.holder === "business" ? "Business" : "Personal"} account${u.changedAt ? ` · changed ${formatDateTime(u.changedAt, tz)}` : ""}`}
                detail={
                  u.verifiedAt && !hold ? (
                    <ShieldCheck
                      size={18}
                      className="text-success"
                      aria-label="Verified"
                    />
                  ) : undefined
                }
              />
            </ListSection>
          )}
          {hold && (
            <Banner tone="warning" title="Safety hold">
              Because your details changed recently, direct deposit waits{" "}
              {s.payroll.bank_change_hold_hours} hours (or until your admin
              confirms it with you by phone).
            </Banner>
          )}
          <ListSection
            header={u?.last4 ? "Change account" : "Set up direct deposit"}
          >
            <div className="p-4">
              <BankForm
                defaultHolder={user.name}
                authTitle={fill(
                  policy?.title ?? "Direct deposit authorization",
                )}
                authBody={fill(
                  policy?.body ??
                    "I authorize {company} to deposit my pay into the account above, and, if a deposit is made in error, to correct it. This stays in effect until I change it.",
                )}
              />
            </div>
          </ListSection>
        </div>
      </Page>
    </PageTransition>
  );
}
