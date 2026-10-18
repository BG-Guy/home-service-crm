import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AssignPlanButton,
  MileageRateForm,
  PayrollSettingsForm,
  RoleRatesForm,
} from "@/features/payroll/components/CommissionSettings";
import { PlanEditor } from "@/features/payroll/components/PlanEditor";
import { getCommissionSettings } from "@/features/payroll/queries";
import { requireUser } from "@/lib/auth/current";
import { formatBps } from "@/lib/money";
import { isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { Pill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Commission & payroll" };

export default async function SettingsCommissionPage() {
  await requireUser("comp_plans.manage");
  if (!(await isEnabled("payroll"))) notFound();
  const c = await getCommissionSettings();
  const planName = (k: string) =>
    c.latest.find((p) => p.planKey === k)?.name ?? k;
  const svcName = (id: string) =>
    c.serviceTypes.find((s) => s.id === id)?.name ?? "Service";
  const activePlans = c.latest.filter((p) => !p.archived);

  return (
    <PageTransition>
      <NavBar
        title="Commission & payroll"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page className="pt-4">
        <div className="flex flex-col gap-[var(--section-gap)]">
          <PlanEditor
            plans={c.latest.map((p) => ({
              planKey: p.planKey,
              name: p.name,
              version: p.version,
              archived: p.archived,
              plan: p.plan,
            }))}
            defaultKey={c.settings.default_plan_key}
          />

          <ListSection
            header="Who's on which plan"
            footer="Rate order: job custom rate → person × service → person → plan × service → role → plan."
          >
            {c.people.length === 0 ? (
              <ListRow
                title="No techs yet"
                subtitle="Invite techs from Team."
              />
            ) : (
              c.people.map((p) => {
                const o = p.overrides as {
                  rate_bps?: number;
                  by_service_type?: Record<string, number>;
                  tech_keeps_cash?: boolean;
                  cash_settlement?: "net_in_payout" | "separate_remittance";
                };
                const bits = [
                  planName(p.planKey),
                  o.rate_bps != null
                    ? `${formatBps(o.rate_bps)} personal`
                    : null,
                  ...Object.entries(o.by_service_type ?? {}).map(
                    ([id, b]) => `${svcName(id)} ${formatBps(b)}`,
                  ),
                  o.tech_keeps_cash === false
                    ? "hands in cash"
                    : o.cash_settlement === "net_in_payout"
                      ? "cash deducted from pay"
                      : null,
                ].filter(Boolean);
                return (
                  <ListRow
                    key={p.id}
                    multiline
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {p.name}
                        <span className="text-footnote text-label-2">
                          {p.workerType === "w2" ? "W-2" : "1099"}
                        </span>
                      </span>
                    }
                    subtitle={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span>{bits.join(" · ")}</span>
                        {!p.agreementSigned && (
                          <Pill size="sm" tone="orange">
                            Agreement unsigned
                          </Pill>
                        )}
                      </span>
                    }
                    accessory={
                      <AssignPlanButton
                        person={{
                          id: p.id,
                          name: p.name,
                          workerType: p.workerType,
                          planKey: p.planKey,
                          overrides: o,
                        }}
                        plans={activePlans.map((x) => ({
                          planKey: x.planKey,
                          name: x.name,
                          version: x.version,
                        }))}
                        serviceTypes={c.serviceTypes}
                      />
                    }
                  />
                );
              })
            )}
          </ListSection>

          <ListSection header="Pay periods & payouts">
            <PayrollSettingsForm
              initial={{
                ...c.settings,
                nacha: c.settings.nacha as unknown as Record<
                  string,
                  string | null
                >,
              }}
              plans={activePlans.map((p) => ({
                planKey: p.planKey,
                name: p.name,
              }))}
            />
          </ListSection>

          <ListSection
            header="Default rate by role"
            footer="Used when neither the person nor the service type has a rate."
          >
            <RoleRatesForm roles={c.roles} rates={c.settings.role_rates_bps} />
          </ListSection>

          <ListSection
            header="Mileage reimbursement rates"
            footer="Applied to trips in tech-owned vehicles (Vehicles → Trips)."
          >
            {c.mileage.map((r) => (
              <ListRow
                key={r.id}
                title={`${(r.millicentsPerMile / 1000).toFixed(1)}¢ per mile`}
                subtitle={`From ${formatDateKey(r.effectiveFrom)}${r.source ? ` · ${r.source}` : ""}`}
              />
            ))}
            <MileageRateForm />
          </ListSection>

          <ListSection header="Version history">
            {c.versions.map((v) => (
              <ListRow
                key={v.id}
                title={`${v.name} v${v.version}`}
                subtitle={`${v.planKey} · effective ${formatDateKey(v.effectiveFrom)}${v.archivedAt ? " · archived" : ""}`}
              />
            ))}
          </ListSection>
        </div>
      </Page>
    </PageTransition>
  );
}
