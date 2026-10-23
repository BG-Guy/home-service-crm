import type { Metadata } from "next";
import { kindOf } from "@/features/jobs/kinds";
import { ServiceTypesManager } from "@/features/settings/components/ServiceTypes";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { SERVICE_ICONS } from "@/features/settings/options";
import {
  listChecklistTemplates,
  listServiceTypesFull,
} from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";
import { iconFor } from "@/ui/icons";

export const metadata: Metadata = { title: "Job types" };

// Settings → Job types (SPEC M21; leads-flow redesign item 6): the three job types
// (Free estimate, Service call, Project) and the trade's jobs under each, with every
// rule; archive/restore. The route keeps its old /settings/services path.
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
      title="Job types"
      intro="Every booking starts with one of three job types. Your trade's jobs sit under them, each with its own length, price, photos, checklist and paperwork."
    >
      <ServiceTypesManager
        icons={icons}
        checklists={checklists.map((c) => ({ id: c.id, name: c.name }))}
        items={rows.map((r) => ({
          id: r.id,
          name: r.name,
          kind: kindOf(r.kind),
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
          sort: r.sort,
          active: r.active,
        }))}
      />
    </SettingsScreen>
  );
}
