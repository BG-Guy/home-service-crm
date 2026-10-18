import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { execRows } from "@/db";
import {
  CountersForm,
  DocumentSettingsForm,
  PolicyForm,
} from "@/features/invoices/components/DocumentSettingsForms";
import { requireUser } from "@/lib/auth/current";
import { DEFAULT_PREFIXES } from "@/lib/counters";
import { getCurrentPolicy } from "@/lib/policies";
import { getSettings } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { ListGroup } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Invoices & estimates" };

const POLICIES = [
  {
    kind: "warranty",
    label: "Warranty",
    title: "Workmanship warranty",
  },
  {
    kind: "esign_consent",
    label: "E-signature consent",
    title: "Consent to sign electronically",
  },
  {
    kind: "cooling_off",
    label: "Cooling-off notice (FTC 3-day rule)",
    title: "Notice of right to cancel",
  },
] as const;

// Settings → Invoices & estimates (SPEC M21; BUILD_PLAN §3.4): numbering, terms,
// late fee, photos, estimate defaults and change-order threshold, discount limits by
// role, customer-page options, and the document policies (versioned).
export default async function SettingsInvoicesPage() {
  await requireUser("settings.manage");
  const [s, counterRows, ...policies] = await Promise.all([
    getSettings(),
    execRows<{ key: string; prefix: string; next_value: number }>(
      sql`select key, prefix, next_value::int as next_value from counters where key in ('invoice','estimate','change_order','credit_note')`,
    ),
    ...POLICIES.map((p) => getCurrentPolicy(p.kind)),
  ]);
  const counter = (
    k: "invoice" | "estimate" | "change_order" | "credit_note",
  ) => {
    const r = counterRows.find((c) => c.key === k);
    return {
      prefix: r?.prefix ?? DEFAULT_PREFIXES[k],
      next: Number(r?.next_value ?? 1001),
    };
  };
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Invoices & estimates"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page>
        <ListGroup>
          <DocumentSettingsForm
            v={{
              invoices: s.invoices,
              estimates: s.estimates,
              portal: {
                show_tech_photo: s.portal.show_tech_photo,
                allow_reschedule_request: s.portal.allow_reschedule_request,
              },
              discount: s.limits.max_discount_pct,
            }}
          />
          <CountersForm
            counters={{
              invoice: counter("invoice"),
              estimate: counter("estimate"),
              change_order: counter("change_order"),
              credit_note: counter("credit_note"),
            }}
          />
          {POLICIES.map((p, i) => {
            const cur = policies[i] ?? null;
            return (
              <PolicyForm
                key={p.kind}
                kind={p.kind}
                label={p.label}
                title={cur?.title ?? p.title}
                body={cur?.body ?? ""}
                version={cur?.version ?? null}
              />
            );
          })}
        </ListGroup>
      </Page>
    </PageTransition>
  );
}
