import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { TaxDefaults, TaxRates } from "@/features/settings/components/Taxes";
import {
  listServiceTypesFull,
  listTaxRatesFull,
} from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Taxes" };

// Settings → Taxes (SPEC M21): rates (bps), default rate, labor/parts/fees
// taxability defaults and per-service-type overrides.
export default async function SettingsTaxesPage() {
  await requireUser("settings.manage");
  const [rates, services, s] = await Promise.all([
    listTaxRatesFull(),
    listServiceTypesFull(),
    getSettings(),
  ]);
  const items = rates.map((r) => ({
    id: r.id,
    name: r.name,
    rateBps: r.rateBps,
    isDefault: r.isDefault,
    active: r.active,
  }));
  return (
    <SettingsScreen
      title="Taxes"
      intro="Sales tax rates and what's taxable. Rates are stored exactly (8.25% = 825 basis points)."
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <TaxRates rates={items} />
        <TaxDefaults
          rates={items}
          serviceTypes={services
            .filter((x) => x.active)
            .map((x) => ({ id: x.id, name: x.name }))}
          initial={{
            laborTaxable: s.taxes.labor_taxable,
            partsTaxable: s.taxes.parts_taxable,
            feesTaxable: s.taxes.fees_taxable,
            byServiceType: s.taxes.by_service_type,
          }}
        />
      </div>
    </SettingsScreen>
  );
}
