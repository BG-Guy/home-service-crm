"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { execRows, type Tx } from "@/db";
import {
  calls,
  consentEvents,
  customers,
  entityTags,
  leadEvents,
  leads,
  properties,
} from "@/db/schema";
import { markLeadResponded } from "@/features/leads/api";
import { consentWithCompany } from "@/features/leads/consent-text";
import {
  anonymizeCustomerMessages,
  deriveSmsStatus,
  type RecordConsentInput,
  recordConsent,
} from "@/features/messaging/api";
import { setEntityTags, validateCustomValues } from "@/features/settings/api";
import { action, zf } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { encrypt } from "@/lib/crypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { findCompany, getSettings } from "@/lib/settings";
import type { Actor, SessionUser } from "@/lib/types";
import { timezoneForZip } from "@/lib/zip-tz";
import {
  assertCustomerAccess,
  canSeeCustomer,
  contactRevealedFor,
  ensureProperty,
  logCall,
  queueGeocode,
  setCustomerFlags,
} from "./api";
import type {
  CustomerFlags,
  DuplicateCandidate,
  PickerCustomer,
  SearchHit,
  SmsStatus,
} from "./contracts";
import {
  displayNameOf,
  maskEmail,
  maskPhone,
  normEmail,
  normStreet,
  normZip,
  parseAddressLine,
} from "./normalize";
import {
  findDuplicates,
  getMergePreview,
  listCustomers,
  pickerSearch,
} from "./queries";
import { globalSearch } from "./search";

// Mutations for customers & properties (SPEC M03). Every write goes through action():
// perm → zod → one transaction (write + emit + audit + activity) → revalidate.

const uuid = z.string().uuid();
const CUSTOMER_TYPES = [
  "residential",
  "commercial",
  "property_manager",
  "home_warranty",
] as const;
const CHANNELS = ["sms", "whatsapp", "email", "call"] as const;

const optText = (max = 200) => zf.optionalText(max);
const phoneField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine(
      (v) => !v || normalizePhone(v) !== null,
      "Enter a valid phone number.",
    ),
);
const emailField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || normEmail(v) !== null, "Enter a valid email."),
);

const addressSchema = z.object({
  label: optText(60),
  street: optText(200),
  unit: optText(40),
  city: optText(80),
  state: optText(2),
  zip: optText(10),
  propertyType: optText(20),
  accessNotes: optText(1000),
  gateCode: optText(60),
  pets: optText(200),
  siteContactName: optText(120),
  siteContactPhone: phoneField,
});

type AddressForm = z.output<typeof addressSchema>;

function addressComplete(a: AddressForm | undefined): boolean {
  return !!(a?.street && a.city && a.state && normZip(a.zip).length === 5);
}

function addressErrors(
  a: AddressForm | undefined,
  prefix = "address",
): Record<string, string[]> {
  const k = (f: string) => (prefix ? `${prefix}.${f}` : f);
  const e: Record<string, string[]> = {};
  if (!a?.street) e[k("street")] = ["Enter the street address."];
  if (!a?.city) e[k("city")] = ["Enter the city."];
  if (!a?.state || a.state.length !== 2)
    e[k("state")] = ["Use the 2-letter state."];
  if (normZip(a?.zip).length !== 5) e[k("zip")] = ["Enter a 5-digit ZIP."];
  return e;
}

async function customValues(
  entity: "customer" | "property",
  values: unknown,
  prefix = "custom",
): Promise<Record<string, unknown>> {
  const v =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};
  const res = await validateCustomValues(entity, v);
  if (!res.ok) {
    const fe: Record<string, string[]> = {};
    for (const [k, msgs] of Object.entries(res.fieldErrors))
      fe[k.replace(/^custom\./, `${prefix}.`)] = msgs;
    throw new ValidationError(fe);
  }
  return res.values;
}

const paths = (id?: string) =>
  id ? ["/customers", `/customers/${id}`] : ["/customers"];

// ------------------------------------------------------------------ reads for client islands

/** S3 CustomerPicker search (customers.view; row-scoped). */
export async function searchCustomersForPicker(
  q: string,
): Promise<PickerCustomer[]> {
  const user = await requireUser("customers.view");
  return pickerSearch(user, String(q ?? "").slice(0, 100));
}

/** Duplicate prompt for the new-customer form (exact phone/email; fuzzy street+ZIP). */
export async function checkCustomerDuplicates(i: {
  phone?: string;
  email?: string;
  street?: string;
  zip?: string;
  excludeId?: string;
}): Promise<DuplicateCandidate[]> {
  await requireUser("customers.view");
  return findDuplicates({
    phoneE164: i.phone ? normalizePhone(i.phone) : null,
    email: i.email,
    street: i.street,
    zip: i.zip,
    excludeId:
      i.excludeId && /^[0-9a-f-]{36}$/i.test(i.excludeId) ? i.excludeId : null,
  });
}

/** Global search for client search fields / ⌘K (row-scoped). */
export async function searchEverything(q: string): Promise<SearchHit[]> {
  const user = await requireUser();
  return globalSearch(String(q ?? ""), user, 20);
}

// ------------------------------------------------------------------ create / edit

const customerFields = {
  type: z.enum(CUSTOMER_TYPES).default("residential"),
  firstName: optText(80),
  lastName: optText(80),
  companyName: optText(120),
  phone: phoneField,
  phoneAlt: phoneField,
  email: emailField,
  preferredChannel: z.enum(CHANNELS).default("sms"),
  language: z.preprocess(
    (v) => (v === "" || v == null ? "en" : v),
    z.string().trim().min(2).max(10),
  ),
  notes: optText(5000),
  custom: z.record(z.string(), z.unknown()).optional(),
};

const createCustomerInput = z.object({
  ...customerFields,
  address: addressSchema.optional(),
  leadSourceId: z.preprocess(
    (v) => (v === "" ? undefined : v),
    uuid.optional(),
  ),
  smsConsent: zf.checkbox(),
  /** Set after the user saw the duplicate prompt and chose "Create anyway". */
  force: zf.checkbox(),
  clientId: z.string().uuid().optional(),
});

async function insertCustomer(
  tx: Tx,
  input: z.output<typeof createCustomerInput>,
  user: SessionUser,
  actor: Actor,
  emitFn: (customerId: string) => Promise<void>,
): Promise<{ customerId: string; propertyId: string | null }> {
  const displayName = displayNameOf(input);
  if (!displayName)
    throw new ValidationError({
      firstName: ["Enter a name or a company name."],
    });
  const custom = await customValues("customer", input.custom);
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const [row] = await tx
    .insert(customers)
    .values({
      type: input.type,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      displayName,
      companyName: input.companyName ?? null,
      phone,
      phoneAlt: input.phoneAlt ? normalizePhone(input.phoneAlt) : null,
      email: normEmail(input.email),
      preferredChannel: input.preferredChannel,
      language: input.language,
      notes: input.notes ?? null,
      custom,
      leadSourceId: input.leadSourceId ?? null,
      createdBy: user.id,
    })
    .returning({ id: customers.id });
  if (!row) throw new Error("insert failed");
  await emitFn(row.id);
  let propertyId: string | null = null;
  if (input.address && addressComplete(input.address)) {
    const a = input.address;
    const p = await ensureProperty(
      tx,
      row.id,
      {
        street: a.street as string,
        unit: a.unit,
        city: a.city as string,
        state: a.state as string,
        zip: a.zip as string,
        label: a.label,
      },
      actor,
    );
    propertyId = p.propertyId;
    await tx
      .update(properties)
      .set({
        propertyType: a.propertyType ?? null,
        accessNotes: a.accessNotes ?? null,
        gateCodeEnc: a.gateCode ? encrypt(a.gateCode) : null,
        pets: a.pets ?? null,
        siteContactName: a.siteContactName ?? null,
        siteContactPhone: a.siteContactPhone
          ? normalizePhone(a.siteContactPhone)
          : null,
        isPrimary: true,
        updatedAt: new Date(),
      })
      .where(eq(properties.id, p.propertyId));
  }
  if (input.smsConsent && phone) {
    const [s, company] = await Promise.all([getSettings(), findCompany()]);
    await recordConsent(
      tx,
      {
        customerId: row.id,
        address: phone,
        channel: "sms",
        purpose: "transactional",
        action: "grant",
        source: "verbal",
        textShown: consentWithCompany(
          s.compliance.sms_consent_text,
          s.branding.app_name || company?.name || "",
        ),
        actorUserId: user.id,
      },
      actor,
    );
  }
  return { customerId: row.id, propertyId };
}

export const createCustomer = action({
  name: "customers.create",
  perm: "customers.create",
  input: createCustomerInput,
  audit: "customer.created",
  async run({ input, tx, user, actor, emit, activity }) {
    if (
      input.address &&
      (input.address.street || input.address.zip) &&
      !addressComplete(input.address)
    )
      throw new ValidationError(addressErrors(input.address));
    if (!input.force) {
      const dups = await findDuplicates({
        phoneE164: input.phone ? normalizePhone(input.phone) : null,
        email: input.email,
        street: input.address?.street,
        zip: input.address?.zip,
      });
      if (dups.length > 0)
        return { customerId: null, propertyId: null, duplicates: dups };
    }
    const r = await insertCustomer(tx, input, user, actor, async (id) => {
      await emit(
        "customer.created",
        { type: "customer", id },
        { customer_id: id },
      );
      await activity({
        entity: { type: "customer", id },
        kind: "customer.created",
        summary: "Customer created",
      });
    });
    return { ...r, duplicates: [] as DuplicateCandidate[] };
  },
  auditEntity: ({ data }) =>
    data.customerId ? { type: "customer", id: data.customerId } : null,
  revalidate: ({ data }) => paths(data.customerId ?? undefined),
});

/** S3 inline quick-create (name + phone/email + optional one-line address). */
export const quickCreateCustomer = action({
  name: "customers.quick_create",
  perm: "customers.create",
  input: z.object({
    name: z.string().trim().min(1, "Enter a name.").max(120),
    phone: phoneField,
    email: emailField,
    address: optText(300),
    force: zf.checkbox(),
  }),
  audit: "customer.created",
  async run({ input, tx, user, actor, emit, activity }) {
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const addr = input.address ? parseAddressLine(input.address) : null;
    if (input.address && (!addr || !addr.city || !addr.state))
      throw new ValidationError({
        address: ["Use “Street, City, ST 12345”."],
      });
    if (!input.force) {
      const dups = await findDuplicates({
        phoneE164: phone,
        email: input.email,
        street: addr?.street,
        zip: addr?.zip,
      });
      if (dups.length)
        return { customerId: null, propertyId: null, duplicates: dups };
    }
    const r = await insertCustomer(
      tx,
      {
        type: "residential",
        firstName: input.name.split(/\s+/)[0],
        lastName: input.name.split(/\s+/).slice(1).join(" ") || undefined,
        phone: input.phone,
        email: input.email,
        preferredChannel: phone ? "sms" : "email",
        language: "en",
        address: addr
          ? {
              street: addr.street,
              unit: addr.unit ?? undefined,
              city: addr.city,
              state: addr.state,
              zip: addr.zip,
            }
          : undefined,
        smsConsent: false,
        force: true,
      } as z.output<typeof createCustomerInput>,
      user,
      actor,
      async (id) => {
        await emit(
          "customer.created",
          { type: "customer", id },
          { customer_id: id },
        );
        await activity({
          entity: { type: "customer", id },
          kind: "customer.created",
          summary: "Customer created",
        });
      },
    );
    return { ...r, duplicates: [] as DuplicateCandidate[] };
  },
  auditEntity: ({ data }) =>
    data.customerId ? { type: "customer", id: data.customerId } : null,
  revalidate: () => ["/customers"],
});

export const updateCustomer = action({
  name: "customers.update",
  perm: "customers.edit",
  input: z.object({ id: uuid, ...customerFields }),
  async run({ input, tx, user, emit, activity, audit }) {
    await assertCustomerAccess(user, input.id, "write");
    const [before] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, input.id))
      .limit(1);
    if (!before) throw new NotFoundError("Customer");
    if (before.anonymizedAt)
      throw new ConflictError("anonymized", "This customer was anonymized.");
    const displayName = displayNameOf(input);
    if (!displayName)
      throw new ValidationError({
        firstName: ["Enter a name or a company name."],
      });
    const custom = await customValues("customer", input.custom);
    const next = {
      type: input.type,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      displayName,
      companyName: input.companyName ?? null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      phoneAlt: input.phoneAlt ? normalizePhone(input.phoneAlt) : null,
      email: normEmail(input.email),
      preferredChannel: input.preferredChannel,
      language: input.language,
      notes: input.notes ?? null,
      custom: { ...(before.custom ?? {}), ...custom },
    };
    const fields = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]),
    );
    if (fields.length === 0) return { id: input.id, changed: 0 };
    await tx
      .update(customers)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(customers.id, input.id));
    await audit({
      action: "customer.updated",
      entity: { type: "customer", id: input.id },
      before: Object.fromEntries(fields.map((k) => [k, before[k]])),
      after: Object.fromEntries(fields.map((k) => [k, next[k]])),
    });
    await emit(
      "customer.updated",
      { type: "customer", id: input.id },
      { customer_id: input.id, fields },
    );
    await activity({
      entity: { type: "customer", id: input.id },
      kind: "customer.updated",
      summary: `Updated ${fields.length === 1 ? "1 field" : `${fields.length} fields`}`,
      data: { fields },
    });
    return { id: input.id, changed: fields.length };
  },
  revalidate: ({ input }) => paths(input.id),
});

export const setCustomerFlagsAction = action({
  name: "customers.flags",
  perm: "customers.flags_manage",
  input: z.object({
    id: uuid,
    flag: z.enum([
      "doNotService",
      "prepayRequired",
      "disputeHistory",
      "vip",
      "taxExempt",
      "doNotText",
      "doNotContact",
    ]),
    value: z.boolean(),
    reason: optText(300),
  }),
  async run({ input, tx, user, actor }) {
    if (!(await canSeeCustomer(user, input.id)))
      throw new NotFoundError("Customer");
    await setCustomerFlags(
      tx,
      input.id,
      { [input.flag]: input.value } as Partial<CustomerFlags>,
      actor,
      input.reason,
    );
    return { id: input.id };
  },
  revalidate: ({ input }) => paths(input.id),
});

// ------------------------------------------------------------------ properties

const propertyInput = addressSchema.extend({
  customerId: uuid,
  id: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
  isPrimary: zf.checkbox(),
  custom: z.record(z.string(), z.unknown()).optional(),
  /** Gate code field left untouched (masked) when editing. */
  keepGateCode: zf.checkbox(),
});

export const saveProperty = action({
  name: "customers.property_save",
  anyPerm: ["customers.create", "customers.edit"],
  input: propertyInput,
  async run({ input, tx, user, actor, activity, audit }) {
    if (!(await canSeeCustomer(user, input.customerId)))
      throw new NotFoundError("Customer");
    if (input.id && !user.perms.has("customers.edit"))
      throw new ValidationError({ _: ["You can't edit addresses."] });
    if (!addressComplete(input))
      throw new ValidationError(addressErrors(input, ""));
    const custom = await customValues("property", input.custom);
    const zip = normZip(input.zip);
    const base = {
      label: input.label ?? null,
      street: (input.street as string).trim(),
      unit: input.unit ?? null,
      city: (input.city as string).trim(),
      state: (input.state as string).toUpperCase(),
      zip,
      propertyType: input.propertyType ?? null,
      accessNotes: input.accessNotes ?? null,
      pets: input.pets ?? null,
      siteContactName: input.siteContactName ?? null,
      siteContactPhone: input.siteContactPhone
        ? normalizePhone(input.siteContactPhone)
        : null,
      custom,
    };
    let propertyId: string;
    if (input.id) {
      const [before] = await tx
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.id, input.id),
            eq(properties.customerId, input.customerId),
          ),
        )
        .limit(1);
      if (!before) throw new NotFoundError("Address");
      const moved =
        normStreet(before.street) !== normStreet(base.street) ||
        before.zip !== zip ||
        before.city.toLowerCase() !== base.city.toLowerCase();
      await tx
        .update(properties)
        .set({
          ...base,
          custom: { ...(before.custom ?? {}), ...custom },
          ...(input.keepGateCode
            ? {}
            : { gateCodeEnc: input.gateCode ? encrypt(input.gateCode) : null }),
          ...(moved
            ? {
                lat: null,
                lng: null,
                geocodeStatus: "pending",
                timezone: timezoneForZip(zip),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(properties.id, input.id));
      if (moved) await queueGeocode(tx, input.id, String(Date.now()));
      propertyId = input.id;
      await audit({
        action: "property.updated",
        entity: { type: "customer", id: input.customerId },
        before: { ...before, gateCodeEnc: before.gateCodeEnc ? "[set]" : null },
        after: { ...base, gate_code_changed: !input.keepGateCode },
      });
      await activity({
        entity: { type: "customer", id: input.customerId },
        kind: "property.updated",
        summary: "Service address updated",
        data: { property_id: input.id },
      });
    } else {
      const p = await ensureProperty(
        tx,
        input.customerId,
        { ...base, unit: base.unit, label: base.label },
        actor,
      );
      propertyId = p.propertyId;
      await tx
        .update(properties)
        .set({
          ...base,
          gateCodeEnc: input.gateCode ? encrypt(input.gateCode) : null,
          updatedAt: new Date(),
        })
        .where(eq(properties.id, propertyId));
      await audit({
        action: "property.created",
        entity: { type: "customer", id: input.customerId },
        after: { ...base, property_id: propertyId },
      });
    }
    if (input.isPrimary) await makePrimary(tx, input.customerId, propertyId);
    return { propertyId };
  },
  revalidate: ({ input }) => paths(input.customerId),
});

async function makePrimary(tx: Tx, customerId: string, propertyId: string) {
  await tx
    .update(properties)
    .set({
      isPrimary: sql`${properties.id} = ${propertyId}`,
      updatedAt: new Date(),
    })
    .where(eq(properties.customerId, customerId));
}

export const setPrimaryProperty = action({
  name: "customers.property_primary",
  perm: "customers.edit",
  input: z.object({ customerId: uuid, propertyId: uuid }),
  audit: "property.primary",
  async run({ input, tx, user }) {
    await assertCustomerAccess(user, input.customerId, "write");
    await makePrimary(tx, input.customerId, input.propertyId);
    return { ok: true };
  },
  auditEntity: ({ input }) => ({ type: "customer", id: input.customerId }),
  revalidate: ({ input }) => paths(input.customerId),
});

export const deleteProperty = action({
  name: "customers.property_delete",
  perm: "customers.edit",
  input: z.object({ customerId: uuid, propertyId: uuid }),
  audit: "property.deleted",
  async run({ input, tx, user, activity }) {
    await assertCustomerAccess(user, input.customerId, "write");
    const open =
      await execRows(sql`select 1 from jobs where property_id = ${input.propertyId}
      and status not in ('completed','closed','cancelled') limit 1`);
    if (open.length)
      throw new ConflictError(
        "property_in_use",
        "This address has open jobs. Finish or move them first.",
      );
    await tx
      .update(properties)
      .set({ deletedAt: new Date(), isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(properties.id, input.propertyId),
          eq(properties.customerId, input.customerId),
        ),
      );
    await activity({
      entity: { type: "customer", id: input.customerId },
      kind: "property.deleted",
      summary: "Service address removed",
      data: { property_id: input.propertyId },
    });
    return { ok: true };
  },
  auditEntity: ({ input }) => ({ type: "customer", id: input.customerId }),
  revalidate: ({ input }) => paths(input.customerId),
});

// ------------------------------------------------------------------ calls & email

/**
 * Returns the dial string after the access checks. Techs without `contact_view` get
 * the number only inside the contact window of one of their jobs for this customer
 * (SPEC §4.2; QA2 T5-07), and every such dial is audited. A site-contact number must
 * belong to one of this customer's addresses.
 */
export const startCustomerCall = action({
  name: "customers.call_start",
  perm: "customers.view",
  input: z.object({
    customerId: uuid,
    jobId: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
    which: z.enum(["phone", "phoneAlt", "site"]).default("phone"),
    propertyId: z.preprocess(
      (v) => (v === "" ? undefined : v),
      uuid.optional(),
    ),
  }),
  async run({ input, tx, user, audit }) {
    if (!(await canSeeCustomer(user, input.customerId)))
      throw new NotFoundError("Customer");
    if (input.jobId)
      await assertJobOfCustomer(user, input.jobId, input.customerId);
    const fullContact = user.perms.has("customers.contact_view");
    if (!fullContact) {
      const { revealed } = await contactRevealedFor(user, input.customerId);
      if (!revealed)
        throw new ForbiddenError(
          "You can call this customer from 2 hours before your visit until a day after it. Ask the office to call.",
        );
    }
    const [c] = await tx
      .select({
        phone: customers.phone,
        phoneAlt: customers.phoneAlt,
        dnc: customers.doNotContact,
      })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    let number: string | null = null;
    if (input.which === "site") {
      if (!input.propertyId) throw new NotFoundError("Address");
      const [p] = await tx
        .select({ phone: properties.siteContactPhone })
        .from(properties)
        .where(
          and(
            eq(properties.id, input.propertyId),
            eq(properties.customerId, input.customerId),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1);
      if (!p) throw new NotFoundError("Address");
      number = p.phone ?? null;
    } else
      number = (input.which === "phoneAlt" ? c?.phoneAlt : c?.phone) ?? null;
    if (!number)
      throw new ConflictError("no_phone", "No phone number on file.");
    if (!fullContact)
      await audit({
        action: "customer.contact_dialed",
        entity: { type: "customer", id: input.customerId },
        after: {
          job_id: input.jobId ?? null,
          which: input.which,
          property_id: input.propertyId ?? null,
        },
        full: true,
      });
    return { tel: `tel:${number}`, doNotContact: !!c?.dnc };
  },
});

/** The job must belong to this customer, and to the viewer unless they see all jobs. */
async function assertJobOfCustomer(
  user: SessionUser,
  jobId: string,
  customerId: string,
): Promise<void> {
  const rows = await execRows<{ customer_id: string; mine: boolean }>(sql`
    select j.customer_id,
      exists (select 1 from job_assignments a where a.job_id = j.id and a.user_id = ${user.id}) as mine
    from jobs j where j.id = ${jobId}`);
  const j = rows[0];
  if (!j || j.customer_id !== customerId) throw new NotFoundError("Job");
  if (!user.perms.has("jobs.view_all") && !j.mine)
    throw new NotFoundError("Job");
}

export const logCustomerCall = action({
  name: "customers.call_log",
  perm: "customers.view",
  input: z.object({
    customerId: uuid,
    jobId: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
    direction: z.enum(["out", "in"]).default("out"),
    outcome: z.enum([
      "connected",
      "no_answer",
      "voicemail",
      "wrong_number",
      "busy",
    ]),
    notes: optText(1000),
    clientId: z.string().uuid().optional(),
  }),
  async run({ input, tx, user, actor }) {
    // QA2 T5-08: a jobId never skips the customer check; it must be this
    // customer's job (and the caller's, unless they see all jobs).
    if (!(await canSeeCustomer(user, input.customerId)))
      throw new NotFoundError("Customer");
    if (input.jobId)
      await assertJobOfCustomer(user, input.jobId, input.customerId);
    const r = await logCall(
      tx,
      {
        customerId: input.customerId,
        jobId: input.jobId ?? null,
        userId: user.id,
        direction: input.direction,
        outcome: input.outcome,
        notes: input.notes ?? null,
      },
      actor,
    );
    // An outbound call answers any open lead of this customer (speed-to-lead).
    if (input.direction === "out") {
      const open = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.customerId, input.customerId),
            inArray(leads.status, ["new", "contacted", "qualified"]),
            isNull(leads.firstResponseAt),
          ),
        );
      for (const l of open)
        await markLeadResponded(
          tx,
          l.id,
          { userId: user.id, channel: "call" },
          actor,
        );
    }
    return r;
  },
  revalidate: ({ input }) => [
    `/customers/${input.customerId}`,
    ...(input.jobId ? [`/jobs/${input.jobId}`] : []),
  ],
});

export const logCustomerEmail = action({
  name: "customers.email_log",
  perm: "customers.view",
  input: z.object({ customerId: uuid }),
  async run({ input, user, activity, tx }) {
    if (!(await canSeeCustomer(user, input.customerId)))
      throw new NotFoundError("Customer");
    const [c] = await tx
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    if (!c?.email) throw new ConflictError("no_email", "No email on file.");
    await activity({
      entity: { type: "customer", id: input.customerId },
      kind: "message.mailto",
      summary: "Email opened from the app",
    });
    return { mailto: `mailto:${c.email}` };
  },
  revalidate: ({ input }) => [`/customers/${input.customerId}`],
});

// ------------------------------------------------------------------ delete / anonymize

export const deleteCustomer = action({
  name: "customers.delete",
  perm: "customers.delete",
  input: z.object({ id: uuid, restore: zf.checkbox() }),
  async run({ input, tx, emit, activity, audit }) {
    const [c] = await tx
      .select({ id: customers.id, deletedAt: customers.deletedAt })
      .from(customers)
      .where(eq(customers.id, input.id))
      .limit(1);
    if (!c) throw new NotFoundError("Customer");
    const deletedAt = input.restore ? null : new Date();
    await tx
      .update(customers)
      .set({ deletedAt, updatedAt: new Date() })
      .where(eq(customers.id, input.id));
    await audit({
      action: input.restore ? "customer.restored" : "customer.deleted",
      entity: { type: "customer", id: input.id },
      before: { deleted_at: c.deletedAt },
      after: { deleted_at: deletedAt },
    });
    await emit(
      "customer.updated",
      { type: "customer", id: input.id },
      { customer_id: input.id, fields: ["deleted_at"] },
    );
    await activity({
      entity: { type: "customer", id: input.id },
      kind: "customer.updated",
      summary: input.restore ? "Customer restored" : "Customer archived",
    });
    return { id: input.id };
  },
  revalidate: ({ input }) => paths(input.id),
});

/** GDPR/CCPA-style request: replaces PII with placeholders, keeps financial records. */
export const anonymizeCustomer = action({
  name: "customers.anonymize",
  perm: "customers.delete",
  input: z.object({ id: uuid, confirm: z.literal("ANONYMIZE") }),
  async run({ input, tx, actor, emit, activity, audit }) {
    const [c] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, input.id))
      .limit(1);
    if (!c) throw new NotFoundError("Customer");
    if (c.anonymizedAt) return { id: input.id };
    const now = new Date();
    const label = `Anonymized customer ${input.id.slice(0, 6)}`;
    await tx
      .update(customers)
      .set({
        displayName: label,
        firstName: null,
        lastName: null,
        companyName: null,
        phone: null,
        phoneAlt: null,
        email: null,
        notes: null,
        firstTouch: null,
        custom: {},
        cardFingerprints: [],
        doNotContact: true,
        doNotText: true,
        anonymizedAt: now,
        updatedAt: now,
      })
      .where(eq(customers.id, input.id));
    await tx
      .update(properties)
      .set({
        label: null,
        street: "Address removed",
        unit: null,
        lat: null,
        lng: null,
        accessNotes: null,
        gateCodeEnc: null,
        pets: null,
        siteContactName: null,
        siteContactPhone: null,
        custom: {},
        updatedAt: now,
      })
      .where(eq(properties.customerId, input.id));
    await tx
      .update(leads)
      .set({
        name: label,
        phone: null,
        email: null,
        address: null,
        notes: null,
        attribution: {},
        extra: {},
        updatedAt: now,
      })
      .where(eq(leads.customerId, input.id));
    const leadIds = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.customerId, input.id));
    if (leadIds.length)
      await tx
        .update(leadEvents)
        .set({ raw: null, ip: null, userAgent: null })
        .where(
          inArray(
            leadEvents.leadId,
            leadIds.map((l) => l.id),
          ),
        );
    await tx
      .update(calls)
      .set({ notes: null })
      .where(eq(calls.customerId, input.id));
    await anonymizeCustomerMessages(tx, input.id, actor);
    await audit({
      action: "customer.anonymized",
      entity: { type: "customer", id: input.id },
      before: { display_name: "[redacted]" },
      after: { anonymized_at: now.toISOString() },
      full: true,
    });
    await emit(
      "customer.updated",
      { type: "customer", id: input.id },
      { customer_id: input.id, fields: ["anonymized_at"] },
    );
    await activity({
      entity: { type: "customer", id: input.id },
      kind: "customer.updated",
      summary: "Customer anonymized (privacy request)",
    });
    return { id: input.id };
  },
  revalidate: ({ input }) => paths(input.id),
});

// ------------------------------------------------------------------ merge

const MERGE_FIELDS = [
  "displayName",
  "type",
  "firstName",
  "lastName",
  "companyName",
  "phone",
  "phoneAlt",
  "email",
  "preferredChannel",
  "notes",
] as const;

/** Tables re-pointed on merge (BUILD_PLAN §11.2). consent_events is append-only: rows stay on the tombstone and carryConsentOnMerge appends copies to the survivor. */
const MERGE_TABLES: { table: string; column: string }[] = [
  { table: "jobs", column: "customer_id" },
  { table: "leads", column: "customer_id" },
  { table: "estimates", column: "customer_id" },
  { table: "invoices", column: "customer_id" },
  { table: "payments", column: "customer_id" },
  { table: "messages", column: "customer_id" },
  { table: "media", column: "customer_id" },
  { table: "notes", column: "customer_id" },
  { table: "activity", column: "customer_id" },
  { table: "tasks", column: "customer_id" },
  { table: "review_requests", column: "customer_id" },
  { table: "public_tokens", column: "customer_id" },
  { table: "calls", column: "customer_id" },
  { table: "properties", column: "customer_id" },
  { table: "scheduled_messages", column: "recipient_customer_id" },
];
const POLY_TABLES = ["activity", "notes", "media", "tasks"];

type LedgerRow = typeof consentEvents.$inferSelect;
const SMS_RANK: Record<SmsStatus, number> = {
  unknown: 0,
  transactional: 1,
  marketing: 2,
  opted_out: 3,
};

/**
 * Carry the merged record's consent onto the survivor (append-only: new rows on the
 * survivor via B5 `recordConsent`, copying the original evidence). Opt-outs win: an
 * SMS opt-out or email-marketing revoke on either record ends up on the survivor;
 * grants carry over only when the survivor has no newer decision of its own.
 */
async function carryConsentOnMerge(
  tx: Tx,
  survivorId: string,
  mergedId: string,
  actor: Actor,
): Promise<string[]> {
  const ledger = await tx
    .select()
    .from(consentEvents)
    .where(inArray(consentEvents.customerId, [survivorId, mergedId]))
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id));
  const of = (id: string) => ledger.filter((e) => e.customerId === id);
  const sLedger = of(survivorId);
  const mLedger = of(mergedId);
  if (mLedger.length === 0) return [];
  const text = (rows: LedgerRow[]) =>
    rows.filter((e) => e.channel === "sms" || e.channel === "whatsapp");
  const sStatus = deriveSmsStatus(text(sLedger));
  const mStatus = deriveSmsStatus(text(mLedger));
  const copies: LedgerRow[] = [];
  const latest = (rows: LedgerRow[], channel: string[], purpose: string) =>
    rows.find((e) => channel.includes(e.channel) && e.purpose === purpose);
  if (sStatus !== "opted_out") {
    if (mStatus === "opted_out") {
      const r = latest(mLedger, ["sms", "whatsapp"], "transactional");
      if (r) copies.push(r);
    } else if (SMS_RANK[mStatus] > SMS_RANK[sStatus]) {
      for (const purpose of ["transactional", "marketing"]) {
        const r = latest(mLedger, ["sms", "whatsapp"], purpose);
        const mine = latest(sLedger, ["sms", "whatsapp"], purpose);
        if (r?.action === "grant" && (!mine || mine.createdAt < r.createdAt))
          copies.push(r);
      }
    }
  }
  const mEmail = latest(mLedger, ["email"], "marketing");
  const sEmail = latest(sLedger, ["email"], "marketing");
  if (
    mEmail &&
    sEmail?.action !== "revoke" &&
    (mEmail.action === "revoke" || !sEmail)
  )
    copies.push(mEmail);
  // Oldest first so the survivor's newest row is the decisive one.
  copies.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const e of copies)
    await recordConsent(
      tx,
      {
        customerId: survivorId,
        address: e.address,
        channel: e.channel as RecordConsentInput["channel"],
        purpose: e.purpose as RecordConsentInput["purpose"],
        action: e.action as RecordConsentInput["action"],
        source: e.source as RecordConsentInput["source"],
        textShown: e.textShown,
        pageUrl: e.pageUrl,
        ip: e.ip,
        userAgent: e.userAgent,
        actorUserId: e.actorUserId,
        messageId: e.messageId,
      },
      actor,
    );
  return copies.map((e) => `${e.channel}:${e.purpose}:${e.action}`);
}

export const mergeCustomers = action({
  name: "customers.merge",
  perm: "customers.merge",
  input: z.object({
    survivorId: uuid,
    mergedId: uuid,
    pick: z
      .record(z.string(), z.enum(["survivor", "merged"]))
      .optional()
      .default({}),
  }),
  async run({ input, tx, user, actor, emit, activity, audit }) {
    if (input.survivorId === input.mergedId)
      throw new ValidationError({ _: ["Pick two different customers."] });
    const rows = await tx
      .select()
      .from(customers)
      .where(inArray(customers.id, [input.survivorId, input.mergedId]))
      .for("update");
    const s = rows.find((r) => r.id === input.survivorId);
    const m = rows.find((r) => r.id === input.mergedId);
    if (!s || !m) throw new NotFoundError("Customer");
    if (
      !(await canSeeCustomer(user, s.id)) ||
      !(await canSeeCustomer(user, m.id))
    )
      throw new NotFoundError("Customer");
    if (s.mergedIntoId || m.mergedIntoId)
      throw new ConflictError(
        "already_merged",
        "One of these was already merged.",
      );
    // 1. surviving fields
    const patch: Record<string, unknown> = {};
    for (const f of MERGE_FIELDS) {
      const choice = input.pick[f];
      const useMerged =
        choice === "merged" ||
        (choice == null && (s[f] == null || s[f] === ""));
      if (useMerged && m[f] != null && m[f] !== "") patch[f] = m[f];
    }
    const finalPhone = (patch.phone as string | undefined) ?? s.phone;
    const finalAlt = (patch.phoneAlt as string | undefined) ?? s.phoneAlt;
    const leftover = [s.phone, m.phone, s.phoneAlt, m.phoneAlt].find(
      (p) => p && p !== finalPhone && p !== finalAlt,
    );
    if (leftover && !finalAlt) patch.phoneAlt = leftover;
    const mergedNotes = [s.notes, m.notes].filter(Boolean);
    if (!input.pick.notes && mergedNotes.length > 1)
      patch.notes = mergedNotes.join("\n\n");
    for (const flag of [
      "doNotService",
      "prepayRequired",
      "disputeHistory",
      "vip",
      "taxExempt",
      "doNotText",
      "doNotContact",
    ] as const)
      if (m[flag] && !s[flag]) patch[flag] = true;
    patch.cardFingerprints = [
      ...new Set([...s.cardFingerprints, ...m.cardFingerprints]),
    ];
    patch.custom = { ...(m.custom ?? {}), ...(s.custom ?? {}) };
    patch.waivedFeeCount = s.waivedFeeCount + m.waivedFeeCount;
    if (!s.leadSourceId && m.leadSourceId) patch.leadSourceId = m.leadSourceId;
    if (!s.firstTouch && m.firstTouch) patch.firstTouch = m.firstTouch;
    if (m.createdAt < s.createdAt) patch.createdAt = m.createdAt;
    // 2. duplicate addresses → re-point property_id to the survivor's matching row
    const props = await tx
      .select()
      .from(properties)
      .where(
        and(
          inArray(properties.customerId, [s.id, m.id]),
          isNull(properties.deletedAt),
        ),
      );
    const keyOf = (p: (typeof props)[number]) =>
      `${normStreet(p.street)}|${normStreet(p.unit)}|${p.zip}`;
    const survivorByKey = new Map(
      props.filter((p) => p.customerId === s.id).map((p) => [keyOf(p), p.id]),
    );
    const dupProps: [string, string][] = [];
    for (const p of props.filter((x) => x.customerId === m.id)) {
      const target = survivorByKey.get(keyOf(p));
      if (target) dupProps.push([p.id, target]);
    }
    const existing = await execRows<{
      table_name: string;
      column_name: string;
    }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = current_schema()
        and column_name in ('customer_id','recipient_customer_id','property_id','entity_type','entity_id')`);
    const has = (t: string, c: string) =>
      existing.some((e) => e.table_name === t && e.column_name === c);
    for (const [from, to] of dupProps) {
      for (const t of ["jobs", "leads", "estimates", "invoices"])
        if (has(t, "property_id"))
          await tx.execute(
            sql`update ${sql.identifier(t)} set property_id = ${to} where property_id = ${from}`,
          );
      await tx
        .update(properties)
        .set({ deletedAt: new Date(), isPrimary: false, updatedAt: new Date() })
        .where(eq(properties.id, from));
    }
    // 3. re-point every FK (documented exception §11.2)
    const moved: Record<string, number> = {};
    for (const { table, column } of MERGE_TABLES) {
      if (!has(table, column)) continue;
      const r = await execRows<{ n: number }>(sql`
        with u as (update ${sql.identifier(table)} set ${sql.identifier(column)} = ${s.id}
          where ${sql.identifier(column)} = ${m.id} returning 1)
        select count(*)::int as n from u`);
      moved[table] = Number(r[0]?.n ?? 0);
    }
    for (const t of POLY_TABLES)
      if (has(t, "entity_type") && has(t, "entity_id"))
        await tx.execute(
          sql`update ${sql.identifier(t)} set entity_id = ${s.id}
              where entity_type = 'customer' and entity_id = ${m.id}`,
        );
    // properties: the survivor keeps its own primary address
    const mergedPropIds = props
      .filter(
        (p) => p.customerId === m.id && !dupProps.some(([f]) => f === p.id),
      )
      .map((p) => p.id);
    if (
      mergedPropIds.length &&
      props.some((p) => p.customerId === s.id && p.isPrimary)
    )
      await tx
        .update(properties)
        .set({ isPrimary: false })
        .where(inArray(properties.id, mergedPropIds));
    // tags: union
    const tagRows = await tx
      .select({ tagId: entityTags.tagId })
      .from(entityTags)
      .where(
        and(
          eq(entityTags.entityType, "customer"),
          inArray(entityTags.entityId, [s.id, m.id]),
        ),
      );
    if (tagRows.length)
      await setEntityTags(
        tx,
        { type: "customer", id: s.id },
        [...new Set(tagRows.map((t) => t.tagId))],
        actor,
      );
    // 4. ⚖️ consent follows the person (QA2 T2-09): the merged record's opt-out
    // (or consent the survivor lacks) is appended to the survivor's ledger with the
    // original evidence, so sms_status re-derives with opted_out winning.
    const consentCarried = await carryConsentOnMerge(tx, s.id, m.id, actor);
    // 5. survivor fields, tombstone
    await tx
      .update(customers)
      .set({
        ...(patch as Partial<typeof customers.$inferInsert>),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, s.id));
    await tx
      .update(customers)
      .set({
        mergedIntoId: s.id,
        phone: null,
        phoneAlt: null,
        email: null,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, m.id));
    await audit({
      action: "customer.merged",
      entity: { type: "customer", id: s.id },
      before: { survivor: s, merged: m },
      after: {
        patch,
        moved,
        duplicate_properties: dupProps,
        consent_carried: consentCarried,
      },
      full: true,
    });
    await emit(
      "customer.merged",
      { type: "customer", id: s.id },
      { customer_id: s.id, merged_from: [m.id] },
    );
    await activity({
      entity: { type: "customer", id: s.id },
      kind: "customer.merged",
      summary: `Merged duplicate “${m.displayName}” into this customer`,
      data: { merged_from: m.id, moved },
    });
    return { survivorId: s.id, moved };
  },
  revalidate: ({ input }) => [
    "/customers",
    `/customers/${input.survivorId}`,
    `/customers/${input.mergedId}`,
  ],
});

/** Merge-tool search: other customers to merge into this one. */
export async function searchMergeCandidates(
  excludeId: string,
  q: string,
): Promise<PickerCustomer[]> {
  const user = await requireUser("customers.merge");
  const res = await pickerSearch(user, q, 10);
  return res.filter((r) => r.id !== excludeId);
}

/** Customers list for a tag/flag filter sheet (tags that apply to customers). */
export async function customerTagOptions(): Promise<
  { id: string; name: string; color: string }[]
> {
  await requireUser("customers.view");
  return execRows(
    sql`select id, name, color from tags where 'customer' = any(applies_to) order by lower(name)`,
  );
}

/** One customer for the S3 picker's initial value (row-scoped). */
export async function getPickerCustomer(
  id: string,
): Promise<PickerCustomer | null> {
  const user = await requireUser("customers.view");
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  if (!(await canSeeCustomer(user, id))) return null;
  const [c] = await execRows<{ display_name: string }>(
    sql`select display_name from customers where id = ${id}`,
  );
  if (!c) return null;
  const res = await pickerSearch(user, c.display_name, 25);
  return res.find((r) => r.id === id) ?? null;
}

/** Next keyset page for the customer list (infinite scroll). */
export async function loadMoreCustomers(f: {
  q?: string;
  type?: string;
  tag?: string;
  flag?: string;
  cursor?: string;
}) {
  return listCustomers({
    q: f.q?.slice(0, 100),
    type: f.type,
    tag: f.tag,
    flag: f.flag,
    cursor: f.cursor,
  });
}

export interface MergeSide {
  id: string;
  displayName: string;
  createdAt: string;
  values: Record<string, string | null>;
  counts: { jobs: number; invoices: number; props: number; leads: number };
}

/** Merge preview for the merge tool (customers.merge). */
export async function previewMerge(
  aId: string,
  bId: string,
): Promise<{ a: MergeSide; b: MergeSide } | null> {
  const user = await requireUser("customers.merge");
  if (!(await canSeeCustomer(user, aId)) || !(await canSeeCustomer(user, bId)))
    return null;
  const r = await getMergePreview(aId, bId);
  if (!r) return null;
  const reveal = user.perms.has("customers.contact_view");
  const side = (c: typeof r.a, counts: typeof r.countsA): MergeSide => ({
    id: c.id,
    displayName: c.displayName,
    createdAt: c.createdAt.toISOString(),
    values: {
      displayName: c.displayName,
      type: c.type,
      firstName: c.firstName,
      lastName: c.lastName,
      companyName: c.companyName,
      phone: reveal ? c.phone : maskPhone(c.phone),
      phoneAlt: reveal ? c.phoneAlt : maskPhone(c.phoneAlt),
      email: reveal ? c.email : maskEmail(c.email),
      preferredChannel: c.preferredChannel,
      notes: c.notes,
    },
    counts: {
      jobs: Number(counts?.jobs ?? 0),
      invoices: Number(counts?.invoices ?? 0),
      props: Number(counts?.props ?? 0),
      leads: Number(counts?.leads ?? 0),
    },
  });
  return { a: side(r.a, r.countsA), b: side(r.b, r.countsB) };
}
