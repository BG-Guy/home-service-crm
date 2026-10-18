import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { CustomerForm } from "@/features/customers/components/CustomerForm";
import { consentWithCompany } from "@/features/leads/consent-text";
import { getCustomFieldDefs } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { findCompany, getSettings } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New customer" };

export default async function CustomersNewPage() {
  await requireUser("customers.create");
  const [customDefs, propertyDefs, sources, settings, company] =
    await Promise.all([
      getCustomFieldDefs("customer").catch(() => []),
      getCustomFieldDefs("property").catch(() => []),
      db
        .select({ id: leadSources.id, name: leadSources.name })
        .from(leadSources)
        .where(and(eq(leadSources.active, true)))
        .orderBy(asc(leadSources.name)),
      getSettings(),
      findCompany(),
    ]);
  return (
    <PageTransition>
      <NavBar
        title="New customer"
        back={{ href: "/customers", label: "Customers" }}
      />
      <Page className="max-w-[640px] pt-4">
        <CustomerForm
          mode="create"
          customDefs={customDefs}
          propertyDefs={propertyDefs}
          leadSources={sources}
          consentText={consentWithCompany(
            settings.compliance.sms_consent_text,
            settings.branding.app_name || company?.name || "",
          )}
          defaultState={company?.state ?? null}
        />
      </Page>
    </PageTransition>
  );
}
