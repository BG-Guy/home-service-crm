import type { Metadata } from "next";
import { ServiceTypesManager } from "@/features/settings/components/ServiceTypes";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { SERVICE_ICONS } from "@/features/settings/options";
import {
  listChecklistTemplates,
  listServiceTypesFull,
} from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";
import { iconFor } from "@/ui/icons";

export const metadata: Metadata = { title: "Service types" };

// Settings → Service types (SPEC M21): every service-type field, archive/restore.
export default async function SettingsServicesPage() {
  await requireUser("settings.manage");
  const [rows, checklists] = await Promise.all([
    listServiceTypesFull(),
    listChecklistTemplates(),
  ]);
  const iconKeys = new Set<string>([
    ...SERVICE_ICONS.map((i) => i.value),
    "clipboard",
    ...rows.map((r) => r.icon ?? "clipboard"),
  ]);
  const icons = Object.fromEntries(
    [...iconKeys].map((k) => {
      const Icon = iconFor(k);
      return [k, <Icon key={k} size={17} aria-hidden />];
    }),
  );
  return (
    <SettingsScreen
      title="Service types"
      intro="What you sell. Each type sets the default duration and price, required photos, checklist and paperwork for its jobs."
    >
      <ServiceTypesManager
        icons={icons}
        checklists={checklists.map((c) => ({ id: c.id, name: c.name }))}
        items={rows.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          icon: r.icon,
          aliases: r.aliases,
          defaultDurationMin: r.defaultDurationMin,
          defaultPriceCents: r.defaultPriceCents,
          contractKind:
            r.contractKind === "improvement" ? "improvement" : "repair",
          checklistTemplateId: r.checklistTemplateId,
          photosRequiredBefore: r.photosRequiredBefore,
          photosRequiredAfter: r.photosRequiredAfter,
          photosOnInvoice: r.photosOnInvoice,
          requiresSignedEstimate: r.requiresSignedEstimate,
          requiresOwnershipCheck: r.requiresOwnershipCheck,
          upsellCovered: r.upsellCovered,
          warrantyDays: r.warrantyDays,
          maintenanceIntervalMonths: r.maintenanceIntervalMonths,
          sort: r.sort,
          active: r.active,
        }))}
      />
    </SettingsScreen>
  );
}
