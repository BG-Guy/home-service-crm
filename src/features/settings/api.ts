import "server-only";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  checklistTemplates,
  customFieldDefs,
  entityTags,
  serviceTypes,
  tags,
  taxRates,
} from "@/db/schema";
import { kindOf } from "@/features/jobs/kinds";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { brandCss } from "@/lib/branding";
import { getSettings } from "@/lib/settings";
import type { Actor, EntityRef } from "@/lib/types";
import type {
  ChecklistItemDef,
  CustomFieldDef,
  CustomFieldEntity,
  ServiceTypeRow,
  TagBrief,
  TagTarget,
} from "./contracts";
import { coerceCustomValues } from "./custom-values";
import { tagColorCss } from "./tag-colors";

// B8 settings API (BUILD_PLAN §6.8). Server-only reads for every module plus the one
// write other groups call (setEntityTags). No permission checks here: callers check
// the entity's edit permission (TagEditor's own action does, see actions.ts).
//
// Tag colors: `tags.color` stores a tone key ("blue"); every function here returns a
// CSS-ready color (`var(--sys-blue)` or a hex) that the UI-kit TagChip accepts as-is.

export type * from "./contracts";

function toServiceType(r: typeof serviceTypes.$inferSelect): ServiceTypeRow {
  return {
    id: r.id,
    name: r.name,
    kind: kindOf(r.kind),
    color: r.color,
    icon: r.icon,
    aliases: r.aliases,
    defaultDurationMin: r.defaultDurationMin,
    defaultPriceCents: r.defaultPriceCents,
    contractKind: r.contractKind === "improvement" ? "improvement" : "repair",
    checklistTemplateId: r.checklistTemplateId,
    photosRequiredBefore: r.photosRequiredBefore,
    photosRequiredAfter: r.photosRequiredAfter,
    photosOnInvoice: r.photosOnInvoice,
    requiresSignedEstimate: r.requiresSignedEstimate,
    requiresOwnershipCheck: r.requiresOwnershipCheck,
    upsellCovered: r.upsellCovered,
    warrantyDays: r.warrantyDays,
    maintenanceIntervalMonths: r.maintenanceIntervalMonths,
    active: r.active,
  };
}

/** Active service types (sorted); `includeInactive` adds archived ones. Never deleted rows. */
export async function listServiceTypes(opts?: {
  includeInactive?: boolean;
}): Promise<ServiceTypeRow[]> {
  const conds = [isNull(serviceTypes.deletedAt)];
  if (!opts?.includeInactive) conds.push(eq(serviceTypes.active, true));
  const rows = await db
    .select()
    .from(serviceTypes)
    .where(and(...conds))
    .orderBy(asc(serviceTypes.sort), asc(serviceTypes.name));
  return rows.map(toServiceType);
}

/** One service type by id (archived included), or null. */
export async function getServiceType(
  id: string,
): Promise<ServiceTypeRow | null> {
  const [r] = await db
    .select()
    .from(serviceTypes)
    .where(eq(serviceTypes.id, id))
    .limit(1);
  return r ? toServiceType(r) : null;
}

/** A checklist template with normalized items, or null. */
export async function getChecklistTemplate(
  id: string,
): Promise<{ id: string; name: string; items: ChecklistItemDef[] } | null> {
  const [r] = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, id))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    items: r.items.map((i) => ({ ...i, required: i.required ?? false })),
  };
}

/** Tags that may be applied to `appliesTo` (alphabetical). */
export async function listTags(appliesTo: TagTarget): Promise<TagBrief[]> {
  const rows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(arrayContains(tags.appliesTo, [appliesTo]))
    .orderBy(asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({ ...r, color: tagColorCss(r.color) }));
}

/** Batch: tags per entity id (one query for a whole list). */
export async function getEntityTags(
  entities: EntityRef[],
): Promise<Record<string, TagBrief[]>> {
  const out: Record<string, TagBrief[]> = {};
  if (entities.length === 0) return out;
  const rows = await db
    .select({
      entityId: entityTags.entityId,
      entityType: entityTags.entityType,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(
      or(
        ...entities.map((e) =>
          and(eq(entityTags.entityType, e.type), eq(entityTags.entityId, e.id)),
        ),
      ),
    );
  for (const r of rows) {
    const list = out[r.entityId] ?? [];
    list.push({ id: r.id, name: r.name, color: tagColorCss(r.color) });
    out[r.entityId] = list;
  }
  return out;
}

/**
 * Replace the entity's tag set (no perm check; audited). Tags that don't apply to the
 * entity type are ignored. User changes also write a timeline row (`<entity>.tagged`);
 * system/seed writes don't.
 */
export async function setEntityTags(
  tx: Tx,
  entity: EntityRef,
  tagIds: string[],
  actor: Actor,
): Promise<void> {
  const before = await tx
    .select({ tagId: entityTags.tagId })
    .from(entityTags)
    .where(
      and(
        eq(entityTags.entityType, entity.type),
        eq(entityTags.entityId, entity.id),
      ),
    );
  const requested = [...new Set(tagIds)];
  const allowed = requested.length
    ? await tx
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(
          and(
            inArray(tags.id, requested),
            arrayContains(tags.appliesTo, [entity.type]),
          ),
        )
    : [];
  const allowedIds = new Set(allowed.map((t) => t.id));
  const unique = requested.filter((id) => allowedIds.has(id));
  const beforeIds = before.map((b) => b.tagId);
  const same =
    beforeIds.length === unique.length &&
    beforeIds.every((id) => allowedIds.has(id));
  if (same) return;
  await tx
    .delete(entityTags)
    .where(
      and(
        eq(entityTags.entityType, entity.type),
        eq(entityTags.entityId, entity.id),
      ),
    );
  if (unique.length) {
    await tx
      .insert(entityTags)
      .values(
        unique.map((tagId) => ({
          tagId,
          entityType: entity.type,
          entityId: entity.id,
        })),
      )
      .onConflictDoNothing();
  }
  await writeAudit(tx, {
    actor,
    action: "tags.set",
    entity,
    before: { tag_ids: beforeIds },
    after: { tag_ids: unique },
    full: true,
  });
  if (actor.kind !== "system") {
    const names = allowed
      .filter((t) => allowedIds.has(t.id))
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b));
    await writeActivity(tx, {
      entity,
      kind: `${entity.type}.tagged`,
      summary: names.length ? `Tags: ${names.join(", ")}` : "Tags cleared",
      data: { tag_ids: unique },
      actorUserId: actor.userId,
    });
  }
}

/** Active defs for the entity (service-type scoped defs included when they match). */
export async function getCustomFieldDefs(
  entityType: CustomFieldEntity,
  serviceTypeId?: string | null,
): Promise<CustomFieldDef[]> {
  const rows = await db
    .select()
    .from(customFieldDefs)
    .where(
      and(
        eq(customFieldDefs.entityType, entityType),
        eq(customFieldDefs.active, true),
      ),
    )
    .orderBy(asc(customFieldDefs.sort));
  return rows
    .filter(
      (r) =>
        r.serviceTypeIds.length === 0 ||
        (serviceTypeId ? r.serviceTypeIds.includes(serviceTypeId) : false),
    )
    .map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type as CustomFieldDef["type"],
      options: Array.isArray(r.options)
        ? (r.options as unknown[]).map(String)
        : undefined,
      required: r.required,
      showOnInvoice: r.showOnInvoice,
    }));
}

/**
 * Coerce + validate custom values for an entity (see custom-values.ts for the stored
 * shapes). Unknown keys are dropped. Field errors are keyed `custom.<key>` to match the
 * S56 inputs; throw `new ValidationError(res.fieldErrors)` in your action on failure.
 */
export async function validateCustomValues(
  entityType: CustomFieldEntity,
  values: Record<string, unknown>,
  serviceTypeId?: string | null,
): Promise<
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, string[]> }
> {
  const defs = await getCustomFieldDefs(entityType, serviceTypeId);
  const res = coerceCustomValues(defs, values ?? {});
  return Object.keys(res.fieldErrors).length
    ? { ok: false, fieldErrors: res.fieldErrors }
    : { ok: true, values: res.values };
}

/** Active tax rates (default first). */
export async function getTaxRates(): Promise<
  { id: string; name: string; rateBps: number; isDefault: boolean }[]
> {
  return db
    .select({
      id: taxRates.id,
      name: taxRates.name,
      rateBps: taxRates.rateBps,
      isDefault: taxRates.isDefault,
    })
    .from(taxRates)
    .where(eq(taxRates.active, true))
    .orderBy(desc(taxRates.isDefault), asc(taxRates.name));
}

/**
 * CSS custom-property overrides for the root layout (brand accent + derived
 * contrast-safe `--accent-text` per theme). '' when no accent is set.
 * Uses the F helper in src/lib/branding.ts (contrast-checked, validated hex only).
 */
export async function getBrandingStyle(): Promise<string> {
  const settings = await getSettings();
  return brandCss(settings.branding.accent_color);
}
