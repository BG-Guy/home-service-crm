import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import { calls, customers, leadEvents, properties } from "@/db/schema";
import { getContactWindowJob } from "@/features/jobs/api";
import { getEntityTags } from "@/features/settings/api";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { decryptOrNull } from "@/lib/crypto";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { normalizePhone } from "@/lib/phone";
import { enqueueJob } from "@/lib/queue";
import type { Actor, SessionUser } from "@/lib/types";
import { timezoneForZip } from "@/lib/zip-tz";
import type {
  AddressInput,
  CustomerBrief,
  CustomerFlags,
  FindOrCreateCustomerInput,
  FindOrCreateCustomerResult,
  PropertyBrief,
  SmsStatus,
} from "./contracts";
import {
  addressShort,
  displayNameOf,
  maskPhone,
  maskStreet,
  normEmail,
  normStreet,
  normZip,
  splitName,
} from "./normalize";

// B1 customers API (BUILD_PLAN §6.1). Writes take `tx` first and `actor` last and run
// inside the caller's transaction. No permission checks unless a viewer is passed.

export type * from "./contracts";

type CustomerRow = typeof customers.$inferSelect;
type PropertyRow = typeof properties.$inferSelect;

const live = and(isNull(customers.mergedIntoId), isNull(customers.deletedAt));

// ------------------------------------------------------------------ matching

async function matchCustomer(
  exec: Tx,
  phone: string | null,
  email: string | null,
): Promise<{ customerId: string; matchedBy: "phone" | "email" } | null> {
  if (phone) {
    const [r] = await exec
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          or(eq(customers.phone, phone), eq(customers.phoneAlt, phone)),
          live,
        ),
      )
      .orderBy(customers.createdAt)
      .limit(1);
    if (r) return { customerId: r.id, matchedBy: "phone" };
  }
  if (email) {
    const [r] = await exec
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.email, email), live))
      .orderBy(customers.createdAt)
      .limit(1);
    if (r) return { customerId: r.id, matchedBy: "email" };
  }
  return null;
}

/** Match by E.164 phone (phone or phone_alt), then email. Never returns merged/deleted rows. */
export async function findCustomerMatch(
  q: { phone?: string | null; email?: string | null },
  opts?: { tx?: Tx },
): Promise<{ customerId: string; matchedBy: "phone" | "email" } | null> {
  const phone = q.phone ? normalizePhone(q.phone) : null;
  return matchCustomer(opts?.tx ?? db, phone, normEmail(q.email));
}

/**
 * Match by E.164 (phone or phone_alt), then email. Never merges, never overwrites
 * non-empty fields (fills blanks). Property matched by normalized street+zip else
 * created (timezone from ZIP + a `geocode` job). Emits customer.created on create.
 */
export async function findOrCreateCustomer(
  tx: Tx,
  input: FindOrCreateCustomerInput,
  actor: Actor,
): Promise<FindOrCreateCustomerResult> {
  const warnings: string[] = [];
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) warnings.push("invalid_phone");
  const email = normEmail(input.email);
  if (input.email?.trim() && !email) warnings.push("invalid_email");
  const match = await matchCustomer(tx, phone, email);
  let customerId: string;
  let created = false;
  const split =
    !input.firstName &&
    !input.lastName &&
    input.displayName &&
    !input.companyName
      ? splitName(input.displayName)
      : { first: null, last: null };
  const firstName = input.firstName?.trim() || split.first;
  const lastName = input.lastName?.trim() || split.last;

  if (match) {
    customerId = match.customerId;
    const [c] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (c) {
      const patch: Partial<CustomerRow> = {};
      if (!c.firstName && firstName) patch.firstName = firstName;
      if (!c.lastName && lastName) patch.lastName = lastName;
      if (!c.companyName && input.companyName?.trim())
        patch.companyName = input.companyName.trim();
      if (!c.email && email) patch.email = email;
      if (phone && c.phone !== phone && c.phoneAlt !== phone) {
        if (!c.phone) patch.phone = phone;
        else if (!c.phoneAlt) patch.phoneAlt = phone;
      }
      if (!c.leadSourceId && input.leadSourceId)
        patch.leadSourceId = input.leadSourceId;
      if (!c.source && input.source) patch.source = input.source;
      if (!c.firstTouch && input.firstTouch)
        patch.firstTouch = input.firstTouch;
      const fields = Object.keys(patch);
      if (fields.length) {
        await tx
          .update(customers)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(customers.id, customerId));
        await emit(
          tx,
          "customer.updated",
          { type: "customer", id: customerId },
          { customer_id: customerId, fields },
          { actor },
        );
        await writeActivity(tx, {
          entity: { type: "customer", id: customerId },
          kind: "customer.updated",
          summary: `Filled in ${fields.length === 1 ? "1 missing field" : `${fields.length} missing fields`}`,
          data: { fields },
          actorUserId: actor.userId,
        });
      }
    }
  } else {
    const displayName =
      displayNameOf({
        displayName: input.displayName,
        firstName,
        lastName,
        companyName: input.companyName,
      }) ||
      phone ||
      email ||
      "Unknown customer";
    const [row] = await tx
      .insert(customers)
      .values({
        type: input.type ?? "residential",
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        displayName,
        companyName: input.companyName?.trim() || null,
        phone,
        email,
        preferredChannel: phone ? "sms" : email ? "email" : "sms",
        leadSourceId: input.leadSourceId ?? null,
        source: input.source ?? null,
        firstTouch: input.firstTouch ?? null,
        isTest: input.isTest ?? false,
        createdBy: actor.userId,
      })
      .returning({ id: customers.id });
    if (!row) throw new Error("customer insert failed");
    customerId = row.id;
    created = true;
    await emit(
      tx,
      "customer.created",
      { type: "customer", id: customerId },
      { customer_id: customerId },
      { actor },
    );
    await writeActivity(tx, {
      entity: { type: "customer", id: customerId },
      kind: "customer.created",
      summary: input.source
        ? `Customer created (${input.source})`
        : "Customer created",
      actorUserId: actor.userId,
    });
  }

  let propertyId: string | null = null;
  let propertyCreated = false;
  if (input.address?.street?.trim() && normZip(input.address.zip)) {
    const p = await ensureProperty(tx, customerId, input.address, actor);
    propertyId = p.propertyId;
    propertyCreated = p.created;
  } else if (input.address) {
    warnings.push("incomplete_address");
  }
  return {
    customerId,
    created,
    matchedBy: match?.matchedBy ?? null,
    propertyId,
    propertyCreated,
    warnings,
  };
}

/** Match the customer's property by normalized street + ZIP, else insert (TZ from ZIP; geocode job). */
export async function ensureProperty(
  tx: Tx,
  customerId: string,
  address: AddressInput,
  actor: Actor,
): Promise<{ propertyId: string; created: boolean }> {
  const zip = normZip(address.zip);
  const existing = await tx
    .select({
      id: properties.id,
      street: properties.street,
      unit: properties.unit,
    })
    .from(properties)
    .where(
      and(
        eq(properties.customerId, customerId),
        eq(properties.zip, zip),
        isNull(properties.deletedAt),
      ),
    );
  const want = normStreet(address.street);
  const wantUnit = normStreet(address.unit);
  const hit = existing.find(
    (p) =>
      normStreet(p.street) === want &&
      (!wantUnit || !p.unit || normStreet(p.unit) === wantUnit),
  );
  if (hit) return { propertyId: hit.id, created: false };
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(properties)
    .where(
      and(eq(properties.customerId, customerId), isNull(properties.deletedAt)),
    );
  const hasGeo = address.lat != null && address.lng != null;
  const [row] = await tx
    .insert(properties)
    .values({
      customerId,
      label: address.label?.trim() || null,
      street: address.street.trim(),
      unit: address.unit?.trim() || null,
      city: address.city.trim(),
      state: address.state.trim().toUpperCase().slice(0, 2),
      zip,
      lat: address.lat ?? null,
      lng: address.lng ?? null,
      geocodeStatus: hasGeo ? "manual" : "pending",
      timezone: timezoneForZip(zip),
      isPrimary: Number(n) === 0,
    })
    .returning({ id: properties.id });
  if (!row) throw new Error("property insert failed");
  if (!hasGeo) await queueGeocode(tx, row.id);
  await writeActivity(tx, {
    entity: { type: "customer", id: customerId },
    kind: "property.added",
    summary: "Service address added",
    data: { property_id: row.id },
    actorUserId: actor.userId,
  });
  return { propertyId: row.id, created: true };
}

/** Queue a geocode for a property (deduped per property; the worker throttles to 1 req/s). */
export async function queueGeocode(
  tx: Tx,
  propertyId: string,
  version = "v0",
): Promise<void> {
  await enqueueJob(
    tx,
    "geocode",
    { propertyId },
    { dedupeKey: `geocode:${propertyId}:${version}` },
  );
}

// ------------------------------------------------------------------ access

/** True when the viewer may see this customer at all (row scope §4.2). */
export async function canSeeCustomer(
  user: SessionUser,
  customerId: string,
): Promise<boolean> {
  if (!user.perms.has("customers.view")) return false;
  if (user.perms.has("customers.view_all")) return true;
  const rows = await execRows(sql`
    select 1 from jobs j join job_assignments a on a.job_id = j.id
    where j.customer_id = ${customerId} and a.user_id = ${user.id}
    union all
    select 1 from customers c where c.id = ${customerId} and c.created_by = ${user.id}
    limit 1`);
  return rows.length > 0;
}

/** customers.view_all, or a tech with an assigned job for the customer. Throws ForbiddenError. */
export async function assertCustomerAccess(
  user: SessionUser,
  customerId: string,
  mode: "read" | "write",
): Promise<void> {
  if (mode === "write" && !user.perms.has("customers.edit"))
    throw new ForbiddenError(undefined, "customers.edit");
  if (!(await canSeeCustomer(user, customerId))) throw new ForbiddenError();
}

/** Is the viewer allowed to see unmasked contact details right now? */
export async function contactRevealedFor(
  viewer: SessionUser,
  customerId: string,
): Promise<{ revealed: boolean; windowJobId: string | null }> {
  if (viewer.perms.has("customers.contact_view"))
    return { revealed: true, windowJobId: null };
  try {
    const w = await getContactWindowJob(viewer.id, customerId);
    return { revealed: !!w, windowJobId: w?.jobId ?? null };
  } catch {
    return { revealed: false, windowJobId: null };
  }
}

const viewedAt = new Map<string, number>();

/** Audit `customer.viewed` for tech views (throttled per user+customer, 10 min). */
export async function auditCustomerView(
  viewer: SessionUser,
  customerId: string,
  jobId?: string | null,
): Promise<void> {
  if (viewer.baseRole !== "tech") return;
  const key = `${viewer.id}:${customerId}`;
  const now = Date.now();
  if ((viewedAt.get(key) ?? 0) > now - 10 * 60_000) return;
  viewedAt.set(key, now);
  if (viewedAt.size > 5000) viewedAt.clear();
  try {
    await writeAudit(db, {
      actor: { kind: "user", userId: viewer.id },
      action: "customer.viewed",
      entity: { type: "customer", id: customerId },
      after: { job_id: jobId ?? null },
      full: true,
    });
  } catch (err) {
    console.error("[customers] view audit failed:", err);
  }
}

// ------------------------------------------------------------------ briefs

export const flagsOf = (c: CustomerRow): CustomerFlags => ({
  doNotService: c.doNotService,
  prepayRequired: c.prepayRequired,
  disputeHistory: c.disputeHistory,
  vip: c.vip,
  taxExempt: c.taxExempt,
  doNotText: c.doNotText,
  doNotContact: c.doNotContact,
});

/** Open balance (issued + partially paid invoices) per customer, in cents. */
export async function getCustomerBalances(
  customerIds: string[],
): Promise<Record<string, number>> {
  if (customerIds.length === 0) return {};
  const rows = await execRows<{ customer_id: string; balance: number }>(sql`
    select i.customer_id,
      coalesce(sum(b.total_cents - b.credited_cents - (b.paid_cents - b.refunded_cents)), 0)::bigint as balance
    from invoices i join invoice_balances b on b.invoice_id = i.id
    where i.customer_id in (${sql.join(
      customerIds.map((id) => sql`${id}`),
      sql`, `,
    )}) and i.status in ('issued', 'partially_paid')
    group by i.customer_id`);
  return Object.fromEntries(
    rows.map((r) => [r.customer_id, Number(r.balance)]),
  );
}

/** Viewer-aware brief (masking §4.2 via B2 getContactWindowJob). null when not visible. */
export async function getCustomerBrief(
  customerId: string,
  viewer: SessionUser,
  opts?: { jobId?: string },
): Promise<CustomerBrief | null> {
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) return null;
  if (!(await canSeeCustomer(viewer, customerId))) {
    // A tech viewing a job they are assigned to may always see its customer card.
    if (!opts?.jobId || !viewer.perms.has("customers.view")) return null;
    const rows = await execRows(sql`
      select 1 from job_assignments a join jobs j on j.id = a.job_id
      where a.job_id = ${opts.jobId} and a.user_id = ${viewer.id} and j.customer_id = ${customerId} limit 1`);
    if (rows.length === 0) return null;
  }
  const [{ revealed }, tagMap, balances] = await Promise.all([
    contactRevealedFor(viewer, customerId),
    getEntityTags([{ type: "customer", id: customerId }]).catch(() => ({})),
    viewer.perms.has("invoices.view")
      ? getCustomerBalances([customerId]).catch(() => ({}))
      : Promise.resolve(null),
  ]);
  const anonymized = !!c.anonymizedAt;
  return {
    id: c.id,
    displayName: c.displayName,
    firstName: c.firstName,
    type: c.type as CustomerBrief["type"],
    phone: revealed && !anonymized ? c.phone : null,
    phoneMasked: maskPhone(c.phone),
    email: revealed && !anonymized ? c.email : null,
    contactRevealed: revealed,
    preferredChannel: c.preferredChannel as CustomerBrief["preferredChannel"],
    smsStatus: c.smsStatus as SmsStatus,
    flags: flagsOf(c),
    balanceCents: balances
      ? ((balances as Record<string, number>)[c.id] ?? 0)
      : null,
    tags: (tagMap as Record<string, CustomerBrief["tags"]>)[c.id] ?? [],
  };
}

function toPropertyBrief(
  p: PropertyRow,
  reveal: boolean,
  contactRevealed = true,
): PropertyBrief {
  if (!contactRevealed) {
    // Outside the job's contact window (SPEC §4.2): no house number, unit, pin,
    // access notes, gate code or site phone. City/state/ZIP stay for day planning.
    const street = maskStreet(p.street);
    return {
      id: p.id,
      customerId: p.customerId,
      label: p.label,
      street,
      unit: null,
      city: p.city,
      state: p.state,
      zip: p.zip,
      addressShort: street,
      lat: null,
      lng: null,
      timezone: p.timezone,
      accessNotes: null,
      gateCode: null,
      pets: p.pets,
      siteContactName: p.siteContactName,
      siteContactPhone: maskPhone(p.siteContactPhone),
      masked: true,
    };
  }
  return {
    id: p.id,
    customerId: p.customerId,
    label: p.label,
    street: p.street,
    unit: p.unit,
    city: p.city,
    state: p.state,
    zip: p.zip,
    addressShort: addressShort(p),
    lat: p.lat,
    lng: p.lng,
    timezone: p.timezone,
    accessNotes: p.accessNotes,
    gateCode: reveal ? decryptOrNull(p.gateCodeEnc) : null,
    pets: p.pets,
    siteContactName: p.siteContactName,
    siteContactPhone: p.siteContactPhone,
  };
}

/** Viewer-aware property brief; the gate code is decrypted only inside the job window. */
export async function getPropertyBrief(
  propertyId: string,
  viewer: SessionUser,
  opts?: { jobId?: string },
): Promise<PropertyBrief | null> {
  const [p] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (!p) return null;
  let visible = await canSeeCustomer(viewer, p.customerId);
  if (!visible && opts?.jobId && viewer.perms.has("customers.view")) {
    const rows = await execRows(sql`
      select 1 from job_assignments a join jobs j on j.id = a.job_id
      where a.job_id = ${opts.jobId} and a.user_id = ${viewer.id} and j.property_id = ${propertyId} limit 1`);
    visible = rows.length > 0;
  }
  if (!visible) return null;
  const { revealed, windowJobId } = await contactRevealedFor(
    viewer,
    p.customerId,
  );
  const inWindow =
    windowJobId != null || (revealed && viewer.perms.has("customers.edit"));
  return toPropertyBrief(p, inWindow && !!p.gateCodeEnc, revealed);
}

// ------------------------------------------------------------------ setters

const FLAG_LABEL: Record<keyof CustomerFlags, string> = {
  doNotService: "Do not service",
  prepayRequired: "Prepay required",
  disputeHistory: "Dispute history",
  vip: "VIP",
  taxExempt: "Tax exempt",
  doNotText: "Do not text",
  doNotContact: "Do not contact",
};

/** System setter (caller checked perms). Audited; emits customer.updated. */
export async function setCustomerFlags(
  tx: Tx,
  customerId: string,
  patch: Partial<CustomerFlags>,
  actor: Actor,
  reason?: string,
): Promise<void> {
  const [before] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!before) throw new NotFoundError("Customer");
  const prev = flagsOf(before);
  const changed = (Object.keys(patch) as (keyof CustomerFlags)[]).filter(
    (k) => patch[k] !== undefined && patch[k] !== prev[k],
  );
  if (changed.length === 0) return;
  const clean = Object.fromEntries(changed.map((k) => [k, patch[k]]));
  await tx
    .update(customers)
    .set({ ...clean, updatedAt: new Date() })
    .where(eq(customers.id, customerId));
  await writeAudit(tx, {
    actor,
    action: "customer.flags_changed",
    entity: { type: "customer", id: customerId },
    before: prev,
    after: { ...prev, ...clean, reason: reason ?? null },
  });
  await emit(
    tx,
    "customer.updated",
    { type: "customer", id: customerId },
    { customer_id: customerId, fields: changed },
    { actor },
  );
  await writeActivity(tx, {
    entity: { type: "customer", id: customerId },
    kind: "customer.updated",
    summary: changed
      .map((k) => `${FLAG_LABEL[k]} ${clean[k] ? "on" : "off"}`)
      .join(", "),
    data: { flags: clean, reason: reason ?? null },
    actorUserId: actor.userId,
  });
}

/** Stripe card fingerprint for risk matching (B4). Idempotent. */
export async function addCardFingerprint(
  tx: Tx,
  customerId: string,
  fingerprint: string,
): Promise<void> {
  if (!fingerprint) return;
  await tx
    .update(customers)
    .set({
      cardFingerprints: sql`(select array(select distinct unnest(${customers.cardFingerprints} || array[${fingerprint}]::text[])))`,
    })
    .where(
      and(
        eq(customers.id, customerId),
        sql`not (${fingerprint} = any(${customers.cardFingerprints}))`,
      ),
    );
}

/** ONLY B5 recordConsent calls this (sms_status is derived from the consent ledger). */
export async function setCustomerSmsStatus(
  tx: Tx,
  customerId: string,
  status: SmsStatus,
): Promise<void> {
  await tx
    .update(customers)
    .set({ smsStatus: status, updatedAt: new Date() })
    .where(eq(customers.id, customerId));
}

const OUTCOME_LABEL = {
  connected: "connected",
  no_answer: "no answer",
  voicemail: "left voicemail",
  wrong_number: "wrong number",
  busy: "busy",
} as const;

/** Manual call log (tel: links). Activity 'call.logged'; lead calls also get a lead_events row. */
export async function logCall(
  tx: Tx,
  input: {
    customerId?: string | null;
    leadId?: string | null;
    jobId?: string | null;
    userId: string;
    direction: "out" | "in";
    outcome: "connected" | "no_answer" | "voicemail" | "wrong_number" | "busy";
    notes?: string | null;
  },
  actor: Actor,
): Promise<{ callId: string }> {
  const [row] = await tx
    .insert(calls)
    .values({
      customerId: input.customerId ?? null,
      leadId: input.leadId ?? null,
      jobId: input.jobId ?? null,
      userId: input.userId,
      direction: input.direction,
      outcome: input.outcome,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: calls.id });
  if (!row) throw new Error("call insert failed");
  if (input.leadId) {
    await tx.insert(leadEvents).values({
      leadId: input.leadId,
      kind: "call_attempt",
      outcome: input.outcome,
      actorUserId: actor.userId,
      raw: input.notes ? { notes: input.notes } : null,
    });
  }
  const summary = `Call ${input.direction === "out" ? "to" : "from"} ${input.leadId ? "lead" : "customer"}: ${OUTCOME_LABEL[input.outcome]}`;
  const data = { call_id: row.id, outcome: input.outcome };
  // One activity row per call (QA2 T2-24): a lead call is filed on the lead and
  // carries customer_id, so it shows once in both the lead and customer timelines.
  if (input.leadId) {
    await writeActivity(tx, {
      entity: { type: "lead", id: input.leadId },
      customerId: input.customerId ?? null,
      jobId: input.jobId ?? null,
      kind: "call.logged",
      summary,
      data,
      actorUserId: actor.userId,
    });
  } else if (input.customerId) {
    await writeActivity(tx, {
      entity: { type: "customer", id: input.customerId },
      customerId: input.customerId,
      jobId: input.jobId ?? null,
      kind: "call.logged",
      summary,
      data,
      actorUserId: actor.userId,
    });
  } else if (input.jobId) {
    await writeActivity(tx, {
      entity: { type: "job", id: input.jobId },
      jobId: input.jobId,
      kind: "call.logged",
      summary,
      data,
      actorUserId: actor.userId,
    });
  }
  return { callId: row.id };
}

// ------------------------------------------------------------------ internal helpers

/** Property rows for many customers (one query). */
export async function propertiesFor(
  customerIds: string[],
): Promise<Record<string, PropertyRow[]>> {
  if (customerIds.length === 0) return {};
  const rows = await db
    .select()
    .from(properties)
    .where(
      and(
        inArray(properties.customerId, customerIds),
        isNull(properties.deletedAt),
      ),
    )
    .orderBy(properties.createdAt);
  const out: Record<string, PropertyRow[]> = {};
  for (const r of rows) {
    const list = out[r.customerId] ?? [];
    list.push(r);
    out[r.customerId] = list;
  }
  return out;
}

/**
 * Count one waived cancellation/no-show fee on the customer (SPEC M05: the office sees
 * how often a customer's fee was waived). Called by B2's cancel flow inside its
 * transaction; audited, no event.
 */
export async function incrementWaivedFeeCount(
  tx: Tx,
  customerId: string,
  actor: Actor,
): Promise<void> {
  const [row] = await tx
    .update(customers)
    .set({
      waivedFeeCount: sql`${customers.waivedFeeCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId))
    .returning({ n: customers.waivedFeeCount });
  if (!row) return;
  await writeAudit(tx, {
    actor,
    action: "customer.fee_waived",
    entity: { type: "customer", id: customerId },
    after: { waived_fee_count: row.n },
  });
}
