"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { TAG_TARGETS } from "@/db/enums";
import {
  checklistTemplates,
  company,
  customFieldDefs,
  entityTags,
  rolePermissions,
  roles,
  serviceTypes,
  tags,
  taxRates,
  userPermissionOverrides,
  users,
} from "@/db/schema";
import { enqueueMessage } from "@/features/messaging/api";
import { notify } from "@/features/notify/api";
import { action, actionFailure, flattenZodError, zf } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { changePassword } from "@/lib/auth/flows";
import { requestMeta, revokeAllSessions } from "@/lib/auth/session";
import { normalizeHex } from "@/lib/branding";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { isFeatureFlag } from "@/lib/flags";
import {
  ALL_PERMS,
  checkOverrideChange,
  checkRoleGridChange,
  DEFAULT_GRANTS,
  isPerm,
  type Perm,
  toBaseRole,
} from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { publishPolicyVersion } from "@/lib/policies";
import { SECRET_KEYS, setSecret } from "@/lib/secrets";
import { readSettingsTx, updateSettings } from "@/lib/settings";
import type { ActionResult } from "@/lib/types";
import { listTags } from "./api";
import { normalizeTagColor } from "./tag-colors";

// Settings mutations (SPEC M21; BUILD_PLAN §9 B8). Every write goes through action()
// (auth → zod → one transaction with the write + audit + events → revalidate). Settings
// JSON is only ever written through F's updateSettings (audited 'settings.updated').

const SETTINGS = "/settings";
const HHMM = /^\d{2}:\d{2}$/;

const optText = (max = 200) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

/** FormData `x.0.a`, `x.1.a` arrive as `{ "0": {…}, "1": {…} }` → ordered array. */
function indexed<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object")
      return Object.entries(v as Record<string, unknown>)
        .filter(([k]) => /^\d+$/.test(k))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, x]) => x);
    return [v];
  }, z.array(item));
}

function cleanPhone(raw: string | null | undefined, field: string) {
  if (!raw) return null;
  const p = normalizePhone(raw);
  if (!p)
    throw new ValidationError({ [field]: ["Enter a valid phone number."] });
  return p;
}

/* ------------------------------------------------------------------ company */

const licenseSchema = z.object({
  state: z.string().trim().max(2).default(""),
  trade: z.string().trim().max(60).default(""),
  number: z.string().trim().max(60).default(""),
});

export const updateCompanyAction = action({
  name: "settings.company",
  perm: "settings.manage",
  input: z.object({
    name: z.string().trim().min(1, "Enter the business name.").max(120),
    legalName: optText(160),
    phone: optText(40),
    email: z.preprocess(
      (v) => (v === "" ? null : v),
      z.email("Enter a valid email.").nullable().optional(),
    ),
    website: optText(200),
    address: z
      .object({
        street: optText(160),
        unit: optText(40),
        city: optText(80),
        state: optText(2),
        zip: optText(10),
      })
      .default({}),
    timezone: z.string().min(1),
    ein: optText(20),
    emergencyPhone: optText(40),
    leadResponseMinutes: z.coerce.number().int().min(1).max(1440),
    serviceZips: z.string().max(5000).default(""),
    weekendsAfterHours: zf.checkbox(),
    openSignup: zf.checkbox(),
    showTechRank: zf.checkbox(),
    hours: z
      .record(
        z.string(),
        z.object({
          open: zf.checkbox(),
          from: z.string().regex(HHMM).optional(),
          to: z.string().regex(HHMM).optional(),
        }),
      )
      .default({}),
    licenses: indexed(licenseSchema).default([]),
  }),
  audit: "company.updated",
  async run({ input, tx, actor, audit }) {
    if (!Intl.supportedValuesOf("timeZone").includes(input.timezone))
      throw new ValidationError({ timezone: ["Pick a time zone."] });
    const zips = [
      ...new Set(
        input.serviceZips
          .split(/[\s,;]+/)
          .map((z) => z.trim())
          .filter(Boolean),
      ),
    ];
    const bad = zips.filter((z) => !/^\d{5}$/.test(z));
    if (bad.length)
      throw new ValidationError({
        serviceZips: [`Not a 5-digit ZIP: ${bad.slice(0, 3).join(", ")}`],
      });
    const businessHours = Object.entries(input.hours)
      .map(([day, h]) => ({ day: Number(day), ...h }))
      .filter((h) => h.open && h.from && h.to && h.day >= 0 && h.day <= 6)
      .map((h) => {
        if ((h.from as string) >= (h.to as string))
          throw new ValidationError({
            [`hours.${h.day}.to`]: ["Closing time must be after opening."],
          });
        return { day: h.day, open: h.from as string, close: h.to as string };
      })
      .sort((a, b) => a.day - b.day);

    const [before] = await tx
      .select()
      .from(company)
      .where(eq(company.id, 1))
      .limit(1);
    if (!before) throw new NotFoundError("Company");
    const addr = input.address;
    const hasAddr = Object.values(addr).some(Boolean);
    const next = {
      name: input.name,
      legalName: input.legalName ?? null,
      phone: cleanPhone(input.phone, "phone"),
      email: input.email ? input.email.toLowerCase() : null,
      website: input.website ?? null,
      timezone: input.timezone,
      address: hasAddr
        ? {
            ...(before.address ?? {}),
            street: addr.street ?? "",
            unit: addr.unit ?? undefined,
            city: addr.city ?? "",
            state: (addr.state ?? "").toUpperCase(),
            zip: addr.zip ?? "",
          }
        : null,
    };
    await tx
      .update(company)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(company.id, 1));
    await audit({
      entity: { type: "company", id: "00000000-0000-0000-0000-000000000001" },
      before: {
        name: before.name,
        legalName: before.legalName,
        phone: before.phone,
        email: before.email,
        website: before.website,
        timezone: before.timezone,
        address: before.address,
      },
      after: next,
    });
    await updateSettings(
      tx,
      {
        company: {
          business_hours: businessHours,
          weekends_after_hours: input.weekendsAfterHours,
          service_zips: zips,
          emergency_phone: cleanPhone(input.emergencyPhone, "emergencyPhone"),
          lead_response_minutes: input.leadResponseMinutes,
          ein: input.ein ?? null,
          license_numbers: input.licenses
            .filter((l) => l.number)
            .map((l) => ({ ...l, state: l.state.toUpperCase() })),
        },
        auth: { open_signup: input.openSignup },
        insights: { show_tech_rank: input.showTechRank },
      },
      actor,
    );
  },
  revalidate: () => [`${SETTINGS}/company`, SETTINGS],
});

/* ------------------------------------------------------------------ branding */

export const updateBrandingAction = action({
  name: "settings.branding",
  perm: "settings.manage",
  input: z.object({
    accentColor: z.string().trim().max(9).optional().default(""),
    appName: optText(40),
    invoiceHeaderStyle: z.enum(["standard", "centered", "minimal"]),
    defaultTheme: z.enum(["system", "light", "dark"]).default("system"),
  }),
  async run({ input, tx, actor }) {
    const hex = input.accentColor ? normalizeHex(input.accentColor) : null;
    if (input.accentColor && !hex)
      throw new ValidationError({
        accentColor: ["Use a hex color like #0A84FF."],
      });
    await updateSettings(
      tx,
      {
        branding: {
          accent_color: hex,
          app_name: input.appName ?? null,
          invoice_header_style: input.invoiceHeaderStyle,
        },
        ui: { default_theme: input.defaultTheme },
      },
      actor,
    );
  },
  revalidate: () => [`${SETTINGS}/branding`, "/"],
});

export const setLogoAction = action({
  name: "settings.logo",
  perm: "settings.manage",
  input: z.object({
    variant: z.enum(["light", "dark"]),
    mediaId: z.uuid().nullable(),
  }),
  audit: "company.logo_changed",
  async run({ input, tx, actor }) {
    if (input.variant === "light") {
      await tx
        .update(company)
        .set({ logoMediaId: input.mediaId, updatedAt: new Date() })
        .where(eq(company.id, 1));
    } else {
      await updateSettings(
        tx,
        { branding: { logo_dark_media_id: input.mediaId } },
        actor,
      );
    }
  },
  revalidate: () => [`${SETTINGS}/branding`],
});

/* ------------------------------------------------------------------ service types */

const serviceTypeInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(80),
  color: optText(9),
  icon: optText(30),
  aliases: z.string().max(1000).default(""),
  defaultDurationMin: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  defaultPriceCents: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(0).nullable(),
  ),
  contractKind: z.enum(["repair", "improvement"]),
  checklistTemplateId: z.preprocess(
    (v) => (v === "" ? null : v),
    z.uuid().nullable().optional(),
  ),
  photosRequiredBefore: z.coerce.number().int().min(0).max(20),
  photosRequiredAfter: z.coerce.number().int().min(0).max(20),
  photosOnInvoice: zf.checkbox(),
  requiresSignedEstimate: zf.checkbox(),
  requiresOwnershipCheck: zf.checkbox(),
  upsellCovered: zf.checkbox(),
  warrantyDays: z.coerce.number().int().min(0).max(3650),
  maintenanceIntervalMonths: zf.optionalInt(),
  sort: z.coerce.number().int().min(0).max(999).default(0),
  active: zf.checkbox(),
});

export const saveServiceTypeAction = action({
  name: "settings.service_type",
  perm: "settings.manage",
  input: serviceTypeInput,
  async run({ input, tx, audit }) {
    const color = input.color ? normalizeHex(input.color) : null;
    const values = {
      name: input.name,
      color,
      icon: input.icon ?? null,
      aliases: [
        ...new Set(
          input.aliases
            .split(/[,\n]/)
            .map((a) => a.trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
      defaultDurationMin: input.defaultDurationMin,
      defaultPriceCents: input.defaultPriceCents,
      contractKind: input.contractKind,
      checklistTemplateId: input.checklistTemplateId ?? null,
      photosRequiredBefore: input.photosRequiredBefore,
      photosRequiredAfter: input.photosRequiredAfter,
      photosOnInvoice: input.photosOnInvoice,
      requiresSignedEstimate: input.requiresSignedEstimate,
      requiresOwnershipCheck: input.requiresOwnershipCheck,
      upsellCovered: input.upsellCovered,
      warrantyDays: input.warrantyDays,
      maintenanceIntervalMonths: input.maintenanceIntervalMonths ?? null,
      sort: input.sort,
      active: input.active,
    };
    if (input.id) {
      const [before] = await tx
        .select()
        .from(serviceTypes)
        .where(eq(serviceTypes.id, input.id))
        .limit(1);
      if (!before) throw new NotFoundError("Service type");
      await tx
        .update(serviceTypes)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(serviceTypes.id, input.id));
      await audit({
        action: "service_type.updated",
        entity: { type: "setting", id: input.id },
        before,
        after: values,
      });
      return { id: input.id };
    }
    const [row] = await tx
      .insert(serviceTypes)
      .values(values)
      .returning({ id: serviceTypes.id });
    if (!row) throw new Error("insert failed");
    await audit({
      action: "service_type.created",
      entity: { type: "setting", id: row.id },
      after: values,
      full: true,
    });
    return { id: row.id };
  },
  revalidate: () => [`${SETTINGS}/services`],
});

export const setServiceTypeActiveAction = action({
  name: "settings.service_type_active",
  perm: "settings.manage",
  input: z.object({ id: z.uuid(), active: z.boolean() }),
  async run({ input, tx, audit }) {
    const res = await tx
      .update(serviceTypes)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(serviceTypes.id, input.id))
      .returning({ id: serviceTypes.id });
    if (!res.length) throw new NotFoundError("Service type");
    await audit({
      action: input.active ? "service_type.restored" : "service_type.archived",
      entity: { type: "setting", id: input.id },
      after: { active: input.active },
      full: true,
    });
  },
  revalidate: () => [`${SETTINGS}/services`],
});

/* ------------------------------------------------------------------ taxes */

export const saveTaxRateAction = action({
  name: "settings.tax_rate",
  perm: "settings.manage",
  input: z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Enter a name.").max(80),
    ratePercent: z.coerce
      .number({ error: "Enter a rate." })
      .min(0, "Rate can't be negative.")
      .max(30, "That rate looks too high."),
    isDefault: zf.checkbox(),
  }),
  async run({ input, tx, audit }) {
    // 8.25 % → 825 bps (3-decimal percents round half away to the nearest bp).
    const rateBps = Math.round(input.ratePercent * 100);
    let id = input.id;
    if (input.isDefault)
      await tx
        .update(taxRates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(taxRates.isDefault, true));
    if (id) {
      const [before] = await tx
        .select()
        .from(taxRates)
        .where(eq(taxRates.id, id))
        .limit(1);
      if (!before) throw new NotFoundError("Tax rate");
      await tx
        .update(taxRates)
        .set({
          name: input.name,
          rateBps,
          isDefault: input.isDefault || before.isDefault,
          updatedAt: new Date(),
        })
        .where(eq(taxRates.id, id));
      await audit({
        action: "tax_rate.updated",
        entity: { type: "setting", id },
        before: { name: before.name, rate_bps: before.rateBps },
        after: { name: input.name, rate_bps: rateBps },
        full: true,
      });
    } else {
      const [row] = await tx
        .insert(taxRates)
        .values({ name: input.name, rateBps, isDefault: input.isDefault })
        .returning({ id: taxRates.id });
      id = row?.id;
      await audit({
        action: "tax_rate.created",
        entity: id ? { type: "setting", id } : null,
        after: { name: input.name, rate_bps: rateBps },
        full: true,
      });
    }
    return { id };
  },
  revalidate: () => [`${SETTINGS}/taxes`],
});

export const setDefaultTaxRateAction = action({
  name: "settings.tax_default",
  perm: "settings.manage",
  input: z.object({ id: z.uuid() }),
  audit: "tax_rate.default_changed",
  async run({ input, tx }) {
    const [row] = await tx
      .select({ active: taxRates.active })
      .from(taxRates)
      .where(eq(taxRates.id, input.id))
      .limit(1);
    if (!row) throw new NotFoundError("Tax rate");
    if (!row.active)
      throw new ConflictError("archived", "Restore the rate first.");
    await tx
      .update(taxRates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(taxRates.isDefault, true), ne(taxRates.id, input.id)));
    await tx
      .update(taxRates)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(taxRates.id, input.id));
  },
  revalidate: () => [`${SETTINGS}/taxes`],
});

export const setTaxRateActiveAction = action({
  name: "settings.tax_active",
  perm: "settings.manage",
  input: z.object({ id: z.uuid(), active: z.boolean() }),
  audit: "tax_rate.active_changed",
  async run({ input, tx }) {
    const [row] = await tx
      .select()
      .from(taxRates)
      .where(eq(taxRates.id, input.id))
      .limit(1);
    if (!row) throw new NotFoundError("Tax rate");
    if (!input.active && row.isDefault)
      throw new ConflictError(
        "default_rate",
        "Pick another default before archiving this rate.",
      );
    await tx
      .update(taxRates)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(taxRates.id, input.id));
  },
  revalidate: () => [`${SETTINGS}/taxes`],
});

export const updateTaxDefaultsAction = action({
  name: "settings.tax_defaults",
  perm: "settings.manage",
  input: z.object({
    laborTaxable: zf.checkbox(),
    partsTaxable: zf.checkbox(),
    feesTaxable: zf.checkbox(),
    byServiceType: z.record(z.string(), z.string()).default({}),
  }),
  async run({ input, tx, actor }) {
    const by: Record<string, string | null> = {};
    for (const [st, rate] of Object.entries(input.byServiceType))
      if (rate) by[st] = rate;
    await updateSettings(
      tx,
      {
        taxes: {
          labor_taxable: input.laborTaxable,
          parts_taxable: input.partsTaxable,
          fees_taxable: input.feesTaxable,
          by_service_type: by,
        },
      },
      actor,
    );
  },
  revalidate: () => [`${SETTINGS}/taxes`],
});

/* ------------------------------------------------------------------ compliance ⚖️ */

export const updateComplianceAction = action({
  name: "settings.compliance",
  perm: "settings.manage",
  input: z.object({
    state: z.string().trim().length(2, "Pick a state."),
    contractTemplates: zf.checkbox(),
    depositCapWarnings: zf.checkbox(),
    surchargeRestrictions: zf.checkbox(),
    wageDeductionBlockedStates: zf.array(z.string().length(2)).default([]),
    quietStart: z.string().regex(HHMM),
    quietEnd: z.string().regex(HHMM),
    automatedPer24h: z.coerce.number().int().min(1).max(20),
    marketingPer7d: z.coerce.number().int().min(0).max(7),
    smsConsentText: z.string().trim().min(20).max(1000),
    marketingConsentText: z.string().trim().min(10).max(1000),
  }),
  async run({ input, tx, actor, audit }) {
    if (input.quietStart >= input.quietEnd)
      throw new ValidationError({
        quietEnd: ["Quiet hours must end after they start."],
      });
    if (!/stop/i.test(input.smsConsentText))
      throw new ValidationError({
        smsConsentText: [
          'Keep the opt-out instructions ("Reply STOP to opt out").',
        ],
      });
    const [before] = await tx
      .select({ state: company.state })
      .from(company)
      .where(eq(company.id, 1))
      .limit(1);
    const state = input.state.toUpperCase();
    if (before?.state !== state) {
      await tx
        .update(company)
        .set({ state, updatedAt: new Date() })
        .where(eq(company.id, 1));
      await audit({
        action: "company.state_changed",
        before: { state: before?.state ?? null },
        after: { state },
        full: true,
      });
    }
    await updateSettings(
      tx,
      {
        compliance: {
          contract_templates: input.contractTemplates,
          deposit_cap_warnings: input.depositCapWarnings,
          surcharge_restrictions: input.surchargeRestrictions,
          wage_deduction_blocked_states: [
            ...new Set(
              input.wageDeductionBlockedStates.map((s) => s.toUpperCase()),
            ),
          ].sort(),
          quiet_hours: { start: input.quietStart, end: input.quietEnd },
          frequency_caps: {
            automated_per_24h: input.automatedPer24h,
            marketing_per_7d: input.marketingPer7d,
          },
          sms_consent_text: input.smsConsentText,
          marketing_consent_text: input.marketingConsentText,
        },
      },
      actor,
    );
  },
  revalidate: () => [`${SETTINGS}/compliance`],
});

/** Publish a new version of the tech location-monitoring notice (⚖️ versioned, immutable). */
export const publishMonitoringNoticeAction = action({
  name: "settings.monitoring_notice",
  perm: "settings.manage",
  input: z.object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(40, "The notice needs a real explanation."),
  }),
  async run({ input, tx, actor }) {
    const row = await publishPolicyVersion(
      tx,
      { kind: "monitoring_notice", title: input.title, body: input.body },
      actor,
    );
    return { version: row.version };
  },
  revalidate: () => [`${SETTINGS}/compliance`],
});

/* ------------------------------------------------------------------ tags */

export const saveTagAction = action({
  name: "settings.tag",
  perm: "tags.manage",
  input: z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Enter a name.").max(40),
    color: z.string().max(20).default("gray"),
    appliesTo: zf
      .array(z.enum(TAG_TARGETS))
      .refine((a) => a.length > 0, "Pick where this tag can be used."),
  }),
  async run({ input, tx, audit }) {
    const values = {
      name: input.name,
      color: normalizeTagColor(input.color),
      appliesTo: [...new Set(input.appliesTo)],
    };
    const [clash] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          sql`lower(${tags.name}) = lower(${input.name})`,
          input.id ? ne(tags.id, input.id) : undefined,
        ),
      )
      .limit(1);
    if (clash)
      throw new ValidationError({ name: ["A tag with this name exists."] });
    if (input.id) {
      const [before] = await tx
        .select()
        .from(tags)
        .where(eq(tags.id, input.id))
        .limit(1);
      if (!before) throw new NotFoundError("Tag");
      await tx.update(tags).set(values).where(eq(tags.id, input.id));
      // Drop assignments the tag no longer applies to.
      const removed = before.appliesTo.filter(
        (t) => !values.appliesTo.includes(t as (typeof TAG_TARGETS)[number]),
      );
      if (removed.length)
        await tx
          .delete(entityTags)
          .where(
            and(
              eq(entityTags.tagId, input.id),
              inArray(entityTags.entityType, removed),
            ),
          );
      await audit({
        action: "tag.updated",
        entity: { type: "setting", id: input.id },
        before: {
          name: before.name,
          color: before.color,
          applies_to: before.appliesTo,
        },
        after: values,
      });
      return { id: input.id, name: values.name, color: values.color };
    }
    const [row] = await tx
      .insert(tags)
      .values(values)
      .returning({ id: tags.id });
    if (!row) throw new Error("insert failed");
    await audit({
      action: "tag.created",
      entity: { type: "setting", id: row.id },
      after: values,
      full: true,
    });
    return { id: row.id, name: values.name, color: values.color };
  },
  revalidate: () => [`${SETTINGS}/tags`],
});

export const deleteTagAction = action({
  name: "settings.tag_delete",
  perm: "tags.manage",
  input: z.object({ id: z.uuid() }),
  async run({ input, tx, audit }) {
    const [before] = await tx
      .select()
      .from(tags)
      .where(eq(tags.id, input.id))
      .limit(1);
    if (!before) throw new NotFoundError("Tag");
    const removed = await tx
      .delete(entityTags)
      .where(eq(entityTags.tagId, input.id))
      .returning({ id: entityTags.entityId });
    await tx.delete(tags).where(eq(tags.id, input.id));
    await audit({
      action: "tag.deleted",
      entity: { type: "setting", id: input.id },
      before: { name: before.name, uses: removed.length },
      full: true,
    });
  },
  revalidate: () => [`${SETTINGS}/tags`],
});

/** Entity edit permission that applying tags requires (BUILD_PLAN §6.8). */
const TAG_EDIT_PERM: Record<(typeof TAG_TARGETS)[number], Perm> = {
  customer: "customers.edit",
  job: "jobs.edit",
  lead: "leads.edit",
  estimate: "estimates.create",
  invoice: "invoices.create",
  vehicle: "vehicles.manage",
  tool: "tools.manage",
};

const TAG_REVALIDATE: Record<(typeof TAG_TARGETS)[number], string> = {
  customer: "/customers",
  job: "/jobs",
  lead: "/leads",
  estimate: "/estimates",
  invoice: "/invoices",
  vehicle: "/vehicles",
  tool: "/tools",
};

/** S55 TagEditor: replace an entity's tags (checks the entity's edit permission). */
export const setTagsAction = action({
  name: "settings.set_tags",
  input: z.object({
    entityType: z.enum(TAG_TARGETS),
    entityId: z.uuid(),
    tagIds: z.array(z.uuid()).max(50),
  }),
  async run({ input, tx, user, actor }) {
    const perm = TAG_EDIT_PERM[input.entityType];
    if (!user.perms.has(perm)) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, perm);
    }
    const { setEntityTags } = await import("./api");
    await setEntityTags(
      tx,
      { type: input.entityType, id: input.entityId },
      input.tagIds,
      actor,
    );
  },
  revalidate: ({ input }) => [
    TAG_REVALIDATE[input.entityType],
    `${TAG_REVALIDATE[input.entityType]}/${input.entityId}`,
  ],
});

/** S55 picker data: tags for an entity type, plus whether the viewer may create tags. */
export async function listTagOptionsAction(input: {
  entityType: (typeof TAG_TARGETS)[number];
}): Promise<
  ActionResult<{
    tags: { id: string; name: string; color: string }[];
    canManage: boolean;
    canEdit: boolean;
  }>
> {
  const user = await requireUser();
  const parsed = z.enum(TAG_TARGETS).safeParse(input?.entityType);
  if (!parsed.success) return { ok: false, error: "Unknown entity." };
  return {
    ok: true,
    data: {
      tags: await listTags(parsed.data),
      canManage: user.perms.has("tags.manage"),
      canEdit: user.perms.has(TAG_EDIT_PERM[parsed.data]),
    },
  };
}

/** S55 without `initial`: the entity's current tags. */
export async function getEntityTagsAction(input: {
  entityType: (typeof TAG_TARGETS)[number];
  entityId: string;
}): Promise<ActionResult<{ id: string; name: string; color: string }[]>> {
  await requireUser();
  const parsed = z
    .object({ entityType: z.enum(TAG_TARGETS), entityId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown entity." };
  const { getEntityTags } = await import("./api");
  const map = await getEntityTags([
    { type: parsed.data.entityType, id: parsed.data.entityId },
  ]);
  return { ok: true, data: map[parsed.data.entityId] ?? [] };
}

/* ------------------------------------------------------------------ custom fields */

export const saveCustomFieldAction = action({
  name: "settings.custom_field",
  perm: "custom_fields.manage",
  input: z.object({
    id: z.uuid().optional(),
    entityType: z.enum([
      "customer",
      "property",
      "job",
      "lead",
      "vehicle",
      "tool",
    ]),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "Lowercase letters, digits and _ only.")
      .optional(),
    label: z.string().trim().min(1, "Enter a label.").max(60),
    type: z.enum([
      "text",
      "number",
      "money",
      "date",
      "select",
      "multiselect",
      "boolean",
      "photo",
    ]),
    options: z.string().max(4000).default(""),
    required: zf.checkbox(),
    showOnInvoice: zf.checkbox(),
    active: zf.checkbox(),
    serviceTypeIds: zf.array(z.uuid()).default([]),
  }),
  async run({ input, tx, audit }) {
    const options =
      input.type === "select" || input.type === "multiselect"
        ? [
            ...new Set(
              input.options
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean),
            ),
          ]
        : null;
    if (options && options.length < 2)
      throw new ValidationError({ options: ["Add at least two options."] });
    const values = {
      label: input.label,
      type: input.type,
      options,
      required: input.required,
      showOnInvoice: input.showOnInvoice,
      active: input.active,
      serviceTypeIds:
        input.entityType === "job" ? [...new Set(input.serviceTypeIds)] : [],
    };
    if (input.id) {
      const [before] = await tx
        .select()
        .from(customFieldDefs)
        .where(eq(customFieldDefs.id, input.id))
        .limit(1);
      if (!before) throw new NotFoundError("Custom field");
      if (before.type !== input.type && before.active)
        throw new ValidationError({
          type: [
            "The type can't change once a field exists. Archive it and add a new one.",
          ],
        });
      await tx
        .update(customFieldDefs)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(customFieldDefs.id, input.id));
      await audit({
        action: "custom_field.updated",
        entity: { type: "setting", id: input.id },
        before,
        after: values,
      });
      return { id: input.id };
    }
    const { fieldKeyFromLabel } = await import("./custom-values");
    const key = input.key || fieldKeyFromLabel(input.label);
    const [clash] = await tx
      .select({ id: customFieldDefs.id })
      .from(customFieldDefs)
      .where(
        and(
          eq(customFieldDefs.entityType, input.entityType),
          eq(customFieldDefs.key, key),
        ),
      )
      .limit(1);
    if (clash)
      throw new ValidationError({
        key: [`"${key}" is already used on this record type.`],
      });
    const [{ maxSort } = { maxSort: 0 }] = await tx
      .select({
        maxSort: sql<number>`coalesce(max(${customFieldDefs.sort}), 0)::int`,
      })
      .from(customFieldDefs)
      .where(eq(customFieldDefs.entityType, input.entityType));
    const [row] = await tx
      .insert(customFieldDefs)
      .values({
        ...values,
        entityType: input.entityType,
        key,
        sort: Number(maxSort) + 10,
      })
      .returning({ id: customFieldDefs.id });
    if (!row) throw new Error("insert failed");
    await audit({
      action: "custom_field.created",
      entity: { type: "setting", id: row.id },
      after: { ...values, key, entity_type: input.entityType },
      full: true,
    });
    return { id: row.id };
  },
  revalidate: () => [`${SETTINGS}/custom-fields`],
});

export const setCustomFieldActiveAction = action({
  name: "settings.custom_field_active",
  perm: "custom_fields.manage",
  input: z.object({ id: z.uuid(), active: z.boolean() }),
  audit: "custom_field.active_changed",
  async run({ input, tx }) {
    const r = await tx
      .update(customFieldDefs)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(customFieldDefs.id, input.id))
      .returning({ id: customFieldDefs.id });
    if (!r.length) throw new NotFoundError("Custom field");
  },
  revalidate: () => [`${SETTINGS}/custom-fields`],
});

export const moveCustomFieldAction = action({
  name: "settings.custom_field_move",
  perm: "custom_fields.manage",
  input: z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) }),
  async run({ input, tx }) {
    const [me] = await tx
      .select()
      .from(customFieldDefs)
      .where(eq(customFieldDefs.id, input.id))
      .limit(1);
    if (!me) throw new NotFoundError("Custom field");
    const siblings = await tx
      .select({ id: customFieldDefs.id, sort: customFieldDefs.sort })
      .from(customFieldDefs)
      .where(eq(customFieldDefs.entityType, me.entityType))
      .orderBy(customFieldDefs.sort, customFieldDefs.label);
    const i = siblings.findIndex((s) => s.id === me.id);
    const j = input.direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return;
    const order = siblings.map((s) => s.id);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
    for (const [k, id] of order.entries())
      await tx
        .update(customFieldDefs)
        .set({ sort: (k + 1) * 10, updatedAt: new Date() })
        .where(eq(customFieldDefs.id, id));
  },
  revalidate: () => [`${SETTINGS}/custom-fields`],
});

/* ------------------------------------------------------------------ checklists */

const checklistItem = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, "Every item needs a label.").max(120),
  type: z.enum(["check", "text", "number", "photo", "signature", "select"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).optional(),
});

export const saveChecklistAction = action({
  name: "settings.checklist",
  perm: "custom_fields.manage",
  input: z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Enter a name.").max(80),
    items: z.array(checklistItem).min(1, "Add at least one item.").max(50),
  }),
  async run({ input, tx, audit }) {
    for (const [i, it] of input.items.entries())
      if (it.type === "select" && (it.options?.length ?? 0) < 2)
        throw new ValidationError({
          [`items.${i}.options`]: ["Add at least two options."],
        });
    const items = input.items.map((it) => ({
      id: it.id,
      label: it.label,
      type: it.type,
      required: it.required,
      ...(it.type === "select" ? { options: it.options ?? [] } : {}),
    }));
    if (input.id) {
      const [before] = await tx
        .select()
        .from(checklistTemplates)
        .where(eq(checklistTemplates.id, input.id))
        .limit(1);
      if (!before) throw new NotFoundError("Checklist");
      await tx
        .update(checklistTemplates)
        .set({ name: input.name, items, updatedAt: new Date() })
        .where(eq(checklistTemplates.id, input.id));
      await audit({
        action: "checklist.updated",
        entity: { type: "setting", id: input.id },
        before: { name: before.name, items: before.items },
        after: { name: input.name, items },
        full: true,
      });
      return { id: input.id };
    }
    const [row] = await tx
      .insert(checklistTemplates)
      .values({ name: input.name, items })
      .returning({ id: checklistTemplates.id });
    if (!row) throw new Error("insert failed");
    await audit({
      action: "checklist.created",
      entity: { type: "setting", id: row.id },
      after: { name: input.name, items },
      full: true,
    });
    return { id: row.id };
  },
  revalidate: () => [`${SETTINGS}/checklists`, `${SETTINGS}/services`],
});

export const deleteChecklistAction = action({
  name: "settings.checklist_delete",
  perm: "custom_fields.manage",
  input: z.object({ id: z.uuid() }),
  async run({ input, tx, audit }) {
    const used = await tx
      .select({ name: serviceTypes.name })
      .from(serviceTypes)
      .where(eq(serviceTypes.checklistTemplateId, input.id));
    if (used.length)
      throw new ConflictError(
        "in_use",
        `Used by ${used.map((u) => u.name).join(", ")}. Pick another checklist there first.`,
      );
    const [before] = await tx
      .delete(checklistTemplates)
      .where(eq(checklistTemplates.id, input.id))
      .returning();
    if (!before) throw new NotFoundError("Checklist");
    await audit({
      action: "checklist.deleted",
      entity: { type: "setting", id: input.id },
      before: { name: before.name },
      full: true,
    });
  },
  revalidate: () => [`${SETTINGS}/checklists`],
});

/* ------------------------------------------------------------------ features */

export const setFeatureFlagAction = action({
  name: "settings.feature",
  perm: "settings.features",
  input: z.object({ flag: z.string(), enabled: z.boolean() }),
  async run({ input, tx, actor }) {
    if (!isFeatureFlag(input.flag))
      throw new ValidationError({ flag: ["Unknown feature."] });
    await updateSettings(
      tx,
      { features: { [input.flag]: input.enabled } },
      actor,
    );
  },
  revalidate: () => [`${SETTINGS}/features`, SETTINGS, "/more"],
});

/* ------------------------------------------------------------------ permissions */

async function roleBase(tx: Tx, key: string) {
  const [r] = await tx
    .select({ baseRole: roles.baseRole })
    .from(roles)
    .where(eq(roles.key, key))
    .limit(1);
  if (!r) throw new NotFoundError("Role");
  return toBaseRole(r.baseRole);
}

export const setRolePermissionAction = action({
  name: "settings.role_perm",
  perm: "settings.permissions",
  input: z.object({
    role: z.string().min(1).max(40),
    perm: z.string().min(1),
    granted: z.boolean(),
  }),
  async run({ input, tx, user, emit, audit }) {
    if (!isPerm(input.perm))
      throw new ValidationError({ perm: ["Unknown permission."] });
    const base = await roleBase(tx, input.role);
    const lock = checkRoleGridChange(base, input.perm, input.granted);
    if (!lock.ok) throw new ConflictError("locked", lock.reason);
    const [before] = await tx
      .select({ granted: rolePermissions.granted })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.role, input.role),
          eq(rolePermissions.perm, input.perm),
        ),
      )
      .limit(1);
    await tx
      .insert(rolePermissions)
      .values({
        role: input.role,
        perm: input.perm,
        granted: input.granted,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [rolePermissions.role, rolePermissions.perm],
        set: {
          granted: input.granted,
          updatedBy: user.id,
          updatedAt: new Date(),
        },
      });
    await audit({
      action: "perm.changed",
      before: {
        role: input.role,
        perm: input.perm,
        granted: before?.granted ?? null,
      },
      after: { role: input.role, perm: input.perm, granted: input.granted },
      full: true,
    });
    await emit("permission.changed", null, {
      role: input.role,
      user_id: null,
      perm: input.perm,
    });
  },
  revalidate: () => [`${SETTINGS}/permissions`],
});

/** Restore a role's grid to the code defaults of its base role (locks preserved). */
export const resetRolePermissionsAction = action({
  name: "settings.role_reset",
  perm: "settings.permissions",
  input: z.object({ role: z.string().min(1).max(40) }),
  async run({ input, tx, user, emit, audit }) {
    const base = await roleBase(tx, input.role);
    const defaults = DEFAULT_GRANTS[base];
    const now = new Date();
    await tx
      .delete(rolePermissions)
      .where(eq(rolePermissions.role, input.role));
    await tx.insert(rolePermissions).values(
      ALL_PERMS.map((perm) => ({
        role: input.role,
        perm,
        granted: defaults.has(perm),
        updatedBy: user.id,
        updatedAt: now,
      })),
    );
    await audit({
      action: "perm.role_reset",
      after: { role: input.role, base_role: base },
      full: true,
    });
    await emit("permission.changed", null, {
      role: input.role,
      user_id: null,
      perm: "*",
    });
  },
  revalidate: () => [`${SETTINGS}/permissions`],
});

/** Add a custom role (e.g. dispatcher) inheriting a base role's defaults (SPEC §4.1). */
export const createRoleAction = action({
  name: "settings.role_create",
  perm: "settings.permissions",
  input: z.object({
    name: z.string().trim().min(2, "Enter a role name.").max(40),
    baseRole: z.enum(["admin", "office", "tech"]),
  }),
  async run({ input, tx, user, audit }) {
    const key = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 30);
    if (!key) throw new ValidationError({ name: ["Use letters or digits."] });
    const [exists] = await tx
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.key, key))
      .limit(1);
    if (exists)
      throw new ValidationError({ name: ["A role with this name exists."] });
    await tx.insert(roles).values({
      key,
      name: input.name,
      baseRole: input.baseRole,
      builtin: false,
    });
    const defaults = DEFAULT_GRANTS[input.baseRole];
    await tx.insert(rolePermissions).values(
      ALL_PERMS.map((perm) => ({
        role: key,
        perm,
        granted: defaults.has(perm),
        updatedBy: user.id,
      })),
    );
    await audit({
      action: "role.created",
      after: { key, name: input.name, base_role: input.baseRole },
      full: true,
    });
    return { key };
  },
  revalidate: () => [`${SETTINGS}/permissions`, "/team"],
});

export const setUserOverrideAction = action({
  name: "settings.user_override",
  perm: "settings.permissions",
  input: z.object({
    userId: z.uuid(),
    perm: z.string().min(1),
    effect: z.enum(["inherit", "allow", "deny"]),
    reason: z.string().trim().max(200).optional(),
  }),
  async run({ input, tx, user, emit, audit, activity }) {
    if (!isPerm(input.perm))
      throw new ValidationError({ perm: ["Unknown permission."] });
    const [target] = await tx
      .select({ id: users.id, role: users.role, name: users.name })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target) throw new NotFoundError("User");
    const base = await roleBase(tx, target.role);
    const effect = input.effect === "inherit" ? null : input.effect;
    const lock = checkOverrideChange(base, input.perm, effect);
    if (!lock.ok) throw new ConflictError("locked", lock.reason);
    if (
      target.id === user.id &&
      effect === "deny" &&
      input.perm === "settings.permissions"
    )
      throw new ConflictError(
        "self_lockout",
        "You can't remove your own access to permissions.",
      );
    const [before] = await tx
      .select({ effect: userPermissionOverrides.effect })
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, input.userId),
          eq(userPermissionOverrides.perm, input.perm),
        ),
      )
      .limit(1);
    if (effect === null) {
      await tx
        .delete(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, input.userId),
            eq(userPermissionOverrides.perm, input.perm),
          ),
        );
    } else {
      await tx
        .insert(userPermissionOverrides)
        .values({
          userId: input.userId,
          perm: input.perm,
          effect,
          reason: input.reason ?? null,
          createdBy: user.id,
        })
        .onConflictDoUpdate({
          target: [
            userPermissionOverrides.userId,
            userPermissionOverrides.perm,
          ],
          set: {
            effect,
            reason: input.reason ?? null,
            createdBy: user.id,
            createdAt: new Date(),
          },
        });
    }
    const entity = { type: "user" as const, id: input.userId };
    await audit({
      action: "perm.override_changed",
      entity,
      before: { perm: input.perm, effect: before?.effect ?? "inherit" },
      after: { perm: input.perm, effect: input.effect },
      full: true,
    });
    await emit("permission.changed", entity, {
      role: null,
      user_id: input.userId,
      perm: input.perm,
    });
    await activity({
      entity,
      kind: "permission.changed",
      summary: `${input.perm}: ${input.effect}`,
    });
  },
  revalidate: ({ input }) => [
    `${SETTINGS}/permissions`,
    `${SETTINGS}/permissions/users/${input.userId}`,
    `/team/${input.userId}`,
  ],
});

/* ------------------------------------------------------------------ integrations */

export const setSecretAction = action({
  name: "settings.secret",
  perm: "settings.integrations",
  input: z.object({
    key: z.enum(SECRET_KEYS),
    value: z.string().trim().max(4000).default(""),
  }),
  async run({ input, tx, actor }) {
    if (process.env[input.key])
      throw new ConflictError(
        "env",
        "This value is set by the server environment, which always wins.",
      );
    await setSecret(tx, input.key, input.value || null, actor);
  },
  revalidate: () => [`${SETTINGS}/integrations`],
});

/** Send yourself a test email or push through the real pipelines (enqueueMessage / notify). */
export const sendTestMessageAction = action({
  name: "settings.test_message",
  perm: "settings.integrations",
  input: z.object({ channel: z.enum(["email", "push"]) }),
  audit: "integration.tested",
  async run({ input, tx, user, actor }) {
    if (input.channel === "email") {
      const r = await enqueueMessage(
        tx,
        {
          channel: "email",
          purpose: "internal",
          audience: { type: "user", userId: user.id },
          subject: "Test email",
          body: `Hi ${user.firstName}, this is a test email from Settings → Integrations. If you can read this, email delivery works.`,
          entity: { type: "user", id: user.id },
        },
        actor,
      );
      return { status: r.status, to: user.email };
    }
    const r = await notify(tx, {
      to: { userIds: [user.id] },
      type: "staff.generic",
      title: "Test notification",
      body: "Push notifications are working.",
      url: "/settings/integrations",
      channels: ["push", "in_app"],
    });
    return { status: r.notified ? "queued" : "none", to: user.email };
  },
});

/**
 * Provider health checks (storage round-trip, geocoder lookup). Not a mutation, and it
 * calls providers, so it runs outside action()'s transaction (PGlite has one connection).
 */
export async function testProviderAction(input: {
  kind: "storage" | "geocode";
}): Promise<ActionResult<{ message: string }>> {
  await requireUser("settings.integrations");
  try {
    if (input?.kind === "storage") {
      const { getStorage } = await import("@/adapters/storage");
      const s = getStorage();
      const key = `healthcheck/${crypto.randomUUID()}.txt`;
      const body = new TextEncoder().encode("ok");
      await s.put(key, body, "text/plain");
      const back = await s.get(key);
      await s.delete(key);
      if (new TextDecoder().decode(back) !== "ok")
        return { ok: false, error: "Storage returned different bytes." };
      return { ok: true, data: { message: `Storage (${s.id}) works.` } };
    }
    if (input?.kind === "geocode") {
      const { getGeocoder } = await import("@/adapters/geocode");
      const g = getGeocoder();
      if (g.id === "none")
        return { ok: false, error: "No geocoder configured (GEOCODER)." };
      const r = await g.geocode({
        street: "1600 Pennsylvania Ave NW",
        city: "Washington",
        state: "DC",
        zip: "20500",
      });
      return r
        ? {
            ok: true,
            data: {
              message: `${g.id}: ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`,
            },
          }
        : { ok: false, error: `${g.id} found no match for the test address.` };
    }
    return { ok: false, error: "Unknown test." };
  } catch (e) {
    console.error("[integrations] test failed", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Test failed.",
    };
  }
}

/* ------------------------------------------------------------------ setup checklist (M01) */

export const setSetupItemAction = action({
  name: "settings.setup_item",
  perm: "settings.manage",
  input: z.object({ key: z.string().min(1).max(40), done: z.boolean() }),
  async run({ input, tx, actor }) {
    const s = await readSettingsTx(tx);
    const set = new Set(s.company.setup_checklist_done);
    if (input.done) set.add(input.key);
    else set.delete(input.key);
    await updateSettings(
      tx,
      { company: { setup_checklist_done: [...set].sort() } },
      actor,
    );
  },
  revalidate: () => ["/today", "/insights"],
});

export const dismissSetupChecklistAction = action({
  name: "settings.setup_dismiss",
  perm: "settings.manage",
  input: z.object({ dismissed: z.boolean() }),
  async run({ input, tx, actor }) {
    await updateSettings(
      tx,
      { company: { setup_checklist_dismissed: input.dismissed } },
      actor,
    );
  },
  revalidate: () => ["/today", "/insights"],
});

/* ------------------------------------------------------------------ own profile */

export const updateMyProfileAction = action({
  name: "settings.my_profile",
  input: z.object({
    name: z.string().trim().min(1, "Enter your name.").max(120),
    phone: optText(40),
    email: z.email("Enter a valid email."),
  }),
  async run({ input, tx, user, audit }) {
    const email = input.email.toLowerCase();
    const [clash] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, user.id)))
      .limit(1);
    if (clash)
      throw new ValidationError({
        email: ["Another account uses this email."],
      });
    const [before] = await tx
      .select({ name: users.name, phone: users.phone, email: users.email })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const next = {
      name: input.name,
      phone: cleanPhone(input.phone, "phone"),
      email,
    };
    await tx
      .update(users)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await audit({
      action: "user.profile_updated",
      entity: { type: "user", id: user.id },
      before,
      after: next,
    });
  },
  revalidate: () => [`${SETTINGS}/profile`, "/team"],
});

export const setMyAvatarAction = action({
  name: "settings.my_avatar",
  input: z.object({ mediaId: z.uuid().nullable() }),
  audit: "user.avatar_changed",
  async run({ input, tx, user }) {
    await tx
      .update(users)
      .set({ avatarMediaId: input.mediaId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  },
  revalidate: () => [`${SETTINGS}/profile`, "/team"],
});

/** "Sign out other devices" (SPEC M01): revokes every session except this one. */
export const signOutOtherDevicesAction = action({
  name: "settings.sign_out_others",
  input: z.object({}),
  async run({ tx, user, audit }) {
    const n = await revokeAllSessions(tx, user.id, {
      exceptSessionId: user.sessionId,
    });
    await audit({
      action: "user.sessions_revoked",
      entity: { type: "user", id: user.id },
      after: { revoked: n, kept: user.sessionId },
      full: true,
    });
    return { revoked: n };
  },
  revalidate: () => [`${SETTINGS}/profile`],
});

/**
 * Change my password. F's changePassword() opens its own transaction (and revokes my
 * other sessions), so this runs outside action() — PGlite has a single connection.
 */
export async function changeMyPasswordAction(
  _prev: ActionResult | null,
  input: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      currentPassword: z.string().min(1, "Enter your current password."),
      newPassword: z.string().min(1, "Enter a new password."),
      confirmPassword: z.string(),
    })
    .safeParse(Object.fromEntries(input.entries()));
  if (!parsed.success)
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: flattenZodError(parsed.error),
    };
  const v = parsed.data;
  if (v.newPassword !== v.confirmPassword)
    return {
      ok: false,
      error: "The new passwords don't match.",
      fieldErrors: { confirmPassword: ["Doesn't match the new password."] },
    };
  try {
    await changePassword(
      user.id,
      v.currentPassword,
      v.newPassword,
      user.sessionId,
      await requestMeta(),
    );
    return { ok: true };
  } catch (e) {
    return actionFailure(e);
  }
}
