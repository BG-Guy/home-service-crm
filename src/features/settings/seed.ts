// Demo seed fragment for `settings` (BUILD_PLAN §10.3 #3). Owner: B8.
// Tags (+ applied to customers and jobs), custom-field defs, checklist templates,
// the profile's extra service type (`after_hours_lockout` in the default demo) and its
// default tax rate (8.25% in Austin).
// Writes only B8 tables; deterministic ids + onConflictDoNothing (rerunnable).
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import {
  checklistTemplates,
  customFieldDefs,
  entityTags,
  serviceTypes,
  tags,
  taxRates,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";

const BASE_TAGS = [
  { key: "vip", name: "VIP", color: "purple", appliesTo: ["customer", "job"] },
  {
    key: "complaint",
    name: "Complaint",
    color: "red",
    appliesTo: ["customer", "job", "invoice"],
  },
  {
    key: "commercial",
    name: "Commercial",
    color: "blue",
    appliesTo: ["customer", "job", "lead", "estimate", "invoice"],
  },
  {
    key: "warranty",
    name: "Warranty",
    color: "orange",
    appliesTo: ["customer", "job", "invoice"],
  },
  {
    key: "repeat",
    name: "Repeat customer",
    color: "green",
    appliesTo: ["customer", "lead"],
  },
] as const;

const tagId = (k: string) => seedId("tag", k);

const STANDARD_REPAIR = seedId("checklist", "standard_repair");

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const p = ctx.plan;
  const prof = ctx.profile.settings;
  const extra = prof.extraServiceType;
  const created = new Date(ctx.now.getTime() - 90 * 86_400_000);
  // The trade's job tag (applied to every 11th job, e.g. "Needs ladder").
  const TAGS = [
    ...BASE_TAGS,
    { ...prof.jobTag, appliesTo: ["job"] as string[] },
  ];
  const EXTRA_CHECKLIST = seedId("checklist", extra.checklist.key);

  // Checklists first (service types point at them).
  await db
    .insert(checklistTemplates)
    .values([
      {
        id: EXTRA_CHECKLIST,
        name: extra.checklist.name,
        items: extra.checklist.items.map((i) => ({ ...i })),
        createdAt: created,
        updatedAt: created,
      },
      {
        id: STANDARD_REPAIR,
        name: "Standard repair",
        items: [
          {
            id: "diagnosed",
            label: "Problem confirmed with the customer",
            type: "check",
            required: true,
          },
          {
            id: "before",
            label: "Before photo of the problem",
            type: "photo",
            required: true,
          },
          {
            id: "tested",
            label: "Repair tested in front of the customer",
            type: "check",
            required: true,
          },
          {
            id: "cleanup",
            label: "Work area cleaned up",
            type: "check",
            required: false,
          },
          { id: "notes", label: "Notes for next visit", type: "text" },
        ],
        createdAt: created,
        updatedAt: created,
      },
    ])
    .onConflictDoNothing();

  // Extra service type + link the generic repair type to the repair checklist.
  await db
    .insert(serviceTypes)
    .values({
      id: seedId("service_type", extra.key),
      name: extra.name,
      color: extra.color,
      icon: extra.icon,
      aliases: [...extra.aliases],
      defaultDurationMin: extra.defaultDurationMin,
      defaultPriceCents: extra.defaultPriceCents,
      contractKind: extra.contractKind,
      checklistTemplateId: EXTRA_CHECKLIST,
      photosRequiredBefore: extra.photosRequiredBefore,
      photosRequiredAfter: extra.photosRequiredAfter,
      photosOnInvoice: true,
      requiresSignedEstimate: false,
      requiresOwnershipCheck: extra.requiresOwnershipCheck,
      upsellCovered: false,
      warrantyDays: extra.warrantyDays,
      sort: 15,
      active: true,
      createdAt: created,
      updatedAt: created,
    })
    .onConflictDoNothing();
  await db
    .update(serviceTypes)
    .set({ checklistTemplateId: STANDARD_REPAIR })
    .where(eq(serviceTypes.id, seedId("service_type", "repair")));

  // Tax: the base seed's 0% placeholder becomes the profile's local rate (Austin's
  // 8.25% for the default demo); plus an alternate rate.
  await db
    .update(taxRates)
    .set({ name: prof.taxRateName, rateBps: p.taxBps, isDefault: true })
    .where(eq(taxRates.id, seedId("tax_rate", "default")));
  await db
    .insert(taxRates)
    .values({
      id: seedId("tax_rate", prof.altTaxRate.key),
      name: prof.altTaxRate.name,
      rateBps: prof.altTaxRate.rateBps,
      isDefault: false,
      createdAt: created,
      updatedAt: created,
    })
    .onConflictDoNothing();

  // Custom fields (SPEC M21): property equipment + a vehicle field.
  await db
    .insert(customFieldDefs)
    .values([
      ...prof.propertyFields.map((f, i) => ({
        id: seedId("custom_field", `property.${f.key}`),
        entityType: "property",
        key: f.key,
        label: f.label,
        type: f.type,
        ...(f.options ? { options: [...f.options] } : {}),
        required: false,
        showOnInvoice: f.showOnInvoice,
        sort: i + 1,
      })),
      {
        id: seedId("custom_field", "vehicle.fuel_card"),
        entityType: "vehicle",
        key: "fuel_card",
        label: "Fuel card #",
        type: "text",
        required: false,
        showOnInvoice: false,
        sort: 1,
      },
      {
        id: seedId("custom_field", "job.gate_access"),
        entityType: "job",
        key: "gate_access",
        label: "Gated community",
        type: "boolean",
        required: false,
        showOnInvoice: false,
        sort: 1,
      },
    ])
    .onConflictDoNothing();

  // Tags and their use on demo customers and jobs.
  await db
    .insert(tags)
    .values(
      TAGS.map((t) => ({
        id: tagId(t.key),
        name: t.name,
        color: t.color,
        appliesTo: [...t.appliesTo],
        createdAt: created,
      })),
    )
    .onConflictDoNothing();
  const byName = new Map<string, string>(
    TAGS.map((t) => [t.name, tagId(t.key)]),
  );
  const links: { tagId: string; entityType: string; entityId: string }[] = [];
  for (const c of p.customers) {
    for (const name of c.tags) {
      const id = byName.get(name);
      if (id) links.push({ tagId: id, entityType: "customer", entityId: c.id });
    }
  }
  const customerTags = new Map(p.customers.map((c) => [c.n, c.tags]));
  for (const j of p.jobs) {
    const ct = customerTags.get(j.customerN) ?? [];
    if (ct.includes("VIP"))
      links.push({ tagId: tagId("vip"), entityType: "job", entityId: j.id });
    if (ct.includes("Commercial"))
      links.push({
        tagId: tagId("commercial"),
        entityType: "job",
        entityId: j.id,
      });
    if (j.callbackOf != null)
      links.push({
        tagId: tagId("warranty"),
        entityType: "job",
        entityId: j.id,
      });
    if (j.n % 11 === 0)
      links.push({
        tagId: tagId(prof.jobTag.key),
        entityType: "job",
        entityId: j.id,
      });
  }
  // Returning customers (more than two jobs) get "Repeat customer".
  const jobsPer = new Map<number, number>();
  for (const j of p.jobs)
    jobsPer.set(j.customerN, (jobsPer.get(j.customerN) ?? 0) + 1);
  for (const c of p.customers)
    if ((jobsPer.get(c.n) ?? 0) >= 3 && c.n > 3)
      links.push({
        tagId: tagId("repeat"),
        entityType: "customer",
        entityId: c.id,
      });
  if (links.length)
    await db
      .insert(entityTags)
      .values(links.map((l) => ({ ...l, createdAt: created })))
      .onConflictDoNothing();

  ctx.log(
    `settings: ${TAGS.length} tags (${links.length} applied), 4 custom fields, 2 checklists, ${extra.name.toLowerCase()}, ${(p.taxBps / 100).toFixed(2).replace(/0$/, "")}% tax`,
  );
}
