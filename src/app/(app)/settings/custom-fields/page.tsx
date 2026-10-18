import type { Metadata } from "next";
import { CustomFieldsManager } from "@/features/settings/components/CustomFieldsManager";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { ENTITY_LABELS } from "@/features/settings/options";
import {
  countCustomFieldsByEntity,
  listCustomFieldDefs,
  listServiceTypesFull,
} from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";
import { Chip, ChipRow } from "@/ui/components/Chip";

export const metadata: Metadata = { title: "Custom fields" };

const ENTITIES = [
  "customer",
  "property",
  "job",
  "lead",
  "vehicle",
  "tool",
] as const;
type Entity = (typeof ENTITIES)[number];

// Settings → Custom fields (SPEC M21): per entity (+ service-type scope for jobs):
// key, label, type, options, required, show on invoice; order and archive.
export default async function SettingsCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  await requireUser("custom_fields.manage");
  const sp = await searchParams;
  const entity: Entity = (ENTITIES as readonly string[]).includes(
    sp.entity ?? "",
  )
    ? (sp.entity as Entity)
    : "customer";
  const [defs, counts, services] = await Promise.all([
    listCustomFieldDefs(entity),
    countCustomFieldsByEntity(),
    entity === "job" ? listServiceTypesFull() : Promise.resolve([]),
  ]);
  return (
    <SettingsScreen
      title="Custom fields"
      intro="Extra fields on your records. They appear on forms and detail pages, and can print on invoices."
    >
      <ChipRow label="Record type" className="mb-5">
        {ENTITIES.map((e) => (
          <Chip
            key={e}
            href={`/settings/custom-fields?entity=${e}`}
            replace
            selected={e === entity}
            count={counts[e] ?? 0}
          >
            {ENTITY_LABELS[e]}
          </Chip>
        ))}
      </ChipRow>
      <CustomFieldsManager
        key={entity}
        entity={entity}
        serviceTypes={services
          .filter((s) => s.active)
          .map((s) => ({ id: s.id, name: s.name }))}
        fields={defs.map((d) => ({
          id: d.id,
          entityType: d.entityType,
          key: d.key,
          label: d.label,
          type: d.type as CustomFieldDef["type"],
          options: Array.isArray(d.options)
            ? (d.options as unknown[]).map(String)
            : [],
          required: d.required,
          showOnInvoice: d.showOnInvoice,
          active: d.active,
          serviceTypeIds: d.serviceTypeIds,
        }))}
      />
    </SettingsScreen>
  );
}
