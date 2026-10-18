import type { Metadata } from "next";
import { CompanyForm } from "@/features/settings/components/CompanyForm";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { requireUser } from "@/lib/auth/current";
import { getCompany, getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Company" };

// Settings → Company (SPEC M21): profile, address, time zone, business hours,
// after-hours, service ZIPs, licenses, open sign-up and tech rank visibility.
export default async function SettingsCompanyPage() {
  await requireUser("settings.manage");
  const [c, s] = await Promise.all([getCompany(), getSettings()]);
  const a = c.address;
  return (
    <SettingsScreen
      title="Company"
      intro="Your business profile. Customers see the business name, phone and address on texts, estimates and invoices."
    >
      <CompanyForm
        initial={{
          name: c.name,
          legalName: c.legalName ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
          address: {
            street: a?.street ?? "",
            unit: a?.unit ?? "",
            city: a?.city ?? "",
            state: a?.state ?? c.state ?? "",
            zip: a?.zip ?? "",
          },
          timezone: c.timezone,
          ein: s.company.ein ?? "",
          emergencyPhone: s.company.emergency_phone ?? "",
          leadResponseMinutes: s.company.lead_response_minutes,
          serviceZips: s.company.service_zips,
          weekendsAfterHours: s.company.weekends_after_hours,
          openSignup: s.auth.open_signup,
          showTechRank: s.insights.show_tech_rank,
          hours: s.company.business_hours,
          licenses: s.company.license_numbers,
        }}
      />
    </SettingsScreen>
  );
}
