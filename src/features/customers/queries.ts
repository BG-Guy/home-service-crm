import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db, execRows } from "@/db";
import { customers, leadSources, properties } from "@/db/schema";
import { getEntityTags } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { decryptOrNull } from "@/lib/crypto";
import { ForbiddenError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import type { SessionUser } from "@/lib/types";
import {
  auditCustomerView,
  canSeeCustomer,
  contactRevealedFor,
  flagsOf,
  getCustomerBalances,
} from "./api";
import type {
  CustomerEditable,
  CustomerFlags,
  CustomerListItem,
  CustomerType,
  DuplicateCandidate,
  PickerCustomer,
  PropertyView,
} from "./contracts";
import {
  addressLine,
  addressShort,
  maskEmail,
  maskPhone,
  maskStreet,
  normEmail,
  normStreet,
  normZip,
} from "./normalize";

// Read DAL for customers (SPEC M03). requireUser() first; row scope enforced here
// (techs: customers of their assigned jobs or ones they created) — never only in the UI.

export const PAGE_SIZE = 40;

export type CustomerFilter = {
  q?: string;
  type?: string;
  tag?: string;
  flag?: string;
  cursor?: string;
};

const FLAG_COLUMNS: Record<string, string> = {
  vip: "vip",
  do_not_service: "do_not_service",
  prepay_required: "prepay_required",
  dispute_history: "dispute_history",
  tax_exempt: "tax_exempt",
  do_not_text: "do_not_text",
};

export function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name, id])).toString("base64url");
}
function decodeCursor(c: string | undefined): [string, string] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    return Array.isArray(v) &&
      typeof v[0] === "string" &&
      typeof v[1] === "string"
      ? [v[0], v[1]]
      : null;
  } catch {
    return null;
  }
}

function scopeSql(user: SessionUser) {
  return user.perms.has("customers.view_all")
    ? sql`true`
    : sql`(c.created_by = ${user.id} or exists (
        select 1 from jobs j join job_assignments a on a.job_id = j.id
        where j.customer_id = c.id and a.user_id = ${user.id}))`;
}

function phoneOut(phone: string | null, revealed: boolean): string | null {
  if (!phone) return null;
  return revealed ? formatPhone(phone) : maskPhone(phone);
}

/** Customer list with search, chips and keyset pagination (lower(display_name), id). */
export async function listCustomers(f: CustomerFilter): Promise<{
  items: CustomerListItem[];
  nextCursor: string | null;
  total: number | null;
}> {
  const user = await requireUser("customers.view");
  const reveal = user.perms.has("customers.contact_view");
  const conds = [
    sql`c.deleted_at is null`,
    sql`c.merged_into_id is null`,
    scopeSql(user),
  ];
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const like = `${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, "");
    const ors = [
      sql`lower(c.display_name) like ${like}`,
      sql`lower(c.display_name) like ${`% ${like}`}`,
      sql`lower(coalesce(c.company_name, '')) like ${like}`,
      sql`c.email like ${like}`,
      sql`exists (select 1 from properties p where p.customer_id = c.id and p.deleted_at is null
            and (lower(p.street) like ${`%${q}%`} or p.zip = ${q}))`,
    ];
    if (digits.length >= 4) {
      ors.push(sql`c.phone like ${`%${digits}%`}`);
      ors.push(sql`c.phone_alt like ${`%${digits}%`}`);
    }
    conds.push(sql`(${sql.join(ors, sql` or `)})`);
  }
  if (f.type && /^[a-z_]+$/.test(f.type)) conds.push(sql`c.type = ${f.type}`);
  if (f.flag && FLAG_COLUMNS[f.flag])
    conds.push(sql`${sql.raw(`c.${FLAG_COLUMNS[f.flag]}`)} = true`);
  if (f.tag)
    conds.push(sql`exists (select 1 from entity_tags et where et.entity_type = 'customer'
      and et.entity_id = c.id and et.tag_id::text = ${f.tag})`);
  const cur = decodeCursor(f.cursor);
  if (cur)
    conds.push(
      sql`(lower(c.display_name), c.id::text) > (${cur[0]}, ${cur[1]})`,
    );
  const rows = await execRows<{
    id: string;
    display_name: string;
    type: string;
    phone: string | null;
    email: string | null;
    vip: boolean;
    do_not_service: boolean;
    prepay_required: boolean;
    dispute_history: boolean;
    tax_exempt: boolean;
    do_not_text: boolean;
    do_not_contact: boolean;
    created_at: string;
    street: string | null;
    unit: string | null;
  }>(sql`
    select c.id, c.display_name, c.type, c.phone, c.email, c.vip, c.do_not_service, c.prepay_required,
      c.dispute_history, c.tax_exempt, c.do_not_text, c.do_not_contact, c.created_at,
      p.street, p.unit
    from customers c
    left join lateral (
      select street, unit from properties p where p.customer_id = c.id and p.deleted_at is null
      order by p.is_primary desc, p.created_at limit 1
    ) p on true
    where ${sql.join(conds, sql` and `)}
    order by lower(c.display_name), c.id
    limit ${PAGE_SIZE + 1}`);
  const page = rows.slice(0, PAGE_SIZE);
  const tags = await getEntityTags(
    page.map((r) => ({ type: "customer" as const, id: r.id })),
  ).catch(() => ({}) as Record<string, CustomerListItem["tags"]>);
  const items: CustomerListItem[] = page.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    type: r.type as CustomerType,
    phoneDisplay: phoneOut(r.phone, reveal),
    email: reveal ? r.email : maskEmail(r.email),
    addressShort: r.street
      ? reveal
        ? addressShort({ street: r.street, unit: r.unit })
        : maskStreet(r.street)
      : null,
    flags: {
      doNotService: r.do_not_service,
      prepayRequired: r.prepay_required,
      disputeHistory: r.dispute_history,
      vip: r.vip,
      taxExempt: r.tax_exempt,
      doNotText: r.do_not_text,
      doNotContact: r.do_not_contact,
    },
    tags: tags[r.id] ?? [],
    createdAt: new Date(r.created_at).toISOString(),
  }));
  const last = page[page.length - 1];
  return {
    items,
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? encodeCursor(last.display_name.toLowerCase(), last.id)
        : null,
    total: null,
  };
}

/** Count per chip (cheap aggregate; only for viewers who see all customers). */
export async function customerCounts(): Promise<Record<string, number>> {
  const user = await requireUser("customers.view");
  const rows = await execRows<Record<string, number>>(sql`
    select count(*)::int as all,
      count(*) filter (where c.type = 'residential')::int as residential,
      count(*) filter (where c.type <> 'residential')::int as business,
      count(*) filter (where c.vip)::int as vip,
      count(*) filter (where c.do_not_service or c.prepay_required or c.dispute_history)::int as flagged
    from customers c
    where c.deleted_at is null and c.merged_into_id is null and ${scopeSql(user)}`);
  const r = rows[0] ?? {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

export interface CustomerDetail {
  id: string;
  displayName: string;
  type: CustomerType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  phoneAlt: string | null;
  phoneAltDisplay: string | null;
  email: string | null;
  contactRevealed: boolean;
  preferredChannel: string;
  language: string;
  smsStatus: string;
  flags: CustomerFlags;
  notes: string | null;
  source: string | null;
  sourceName: string | null;
  firstTouch: Record<string, unknown> | null;
  custom: Record<string, unknown>;
  createdAt: Date;
  anonymizedAt: Date | null;
  deletedAt: Date | null;
  mergedIntoId: string | null;
  balanceCents: number | null;
  lifetimeCents: number;
  jobCount: number;
  openLeadCount: number;
  properties: PropertyView[];
  tags: { id: string; name: string; color: string }[];
}

function toPropertyView(
  p: typeof properties.$inferSelect,
  canEdit: boolean,
  revealed = true,
): PropertyView {
  if (!revealed) {
    // Outside the contact window (SPEC §4.2): street without the house number,
    // no unit, pin, access notes, gate code or site phone.
    const street = maskStreet(p.street);
    return {
      id: p.id,
      label: p.label,
      street,
      unit: null,
      city: p.city,
      state: p.state,
      zip: p.zip,
      addressLine: `${street}, ${p.city}, ${p.state} ${p.zip}`,
      lat: null,
      lng: null,
      geocodeStatus: p.geocodeStatus,
      accessNotes: null,
      hasGateCode: false,
      gateCode: null,
      pets: p.pets,
      siteContactName: p.siteContactName,
      siteContactPhone: maskPhone(p.siteContactPhone),
      propertyType: p.propertyType,
      isPrimary: p.isPrimary,
      custom: p.custom ?? {},
      masked: true,
    };
  }
  return {
    id: p.id,
    label: p.label,
    street: p.street,
    unit: p.unit,
    city: p.city,
    state: p.state,
    zip: p.zip,
    addressLine: addressLine(p),
    lat: p.lat,
    lng: p.lng,
    geocodeStatus: p.geocodeStatus,
    accessNotes: p.accessNotes,
    hasGateCode: !!p.gateCodeEnc,
    gateCode: canEdit ? decryptOrNull(p.gateCodeEnc) : null,
    pets: p.pets,
    siteContactName: p.siteContactName,
    siteContactPhone: p.siteContactPhone,
    propertyType: p.propertyType,
    isPrimary: p.isPrimary,
    custom: p.custom ?? {},
  };
}

/** Full customer record for /customers/[id]. 404 when missing; 403 outside the row scope. */
export const getCustomerDetail = cache(
  async (id: string): Promise<CustomerDetail> => {
    const user = await requireUser("customers.view");
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [row] = await db
      .select({ c: customers, sourceName: leadSources.name })
      .from(customers)
      .leftJoin(leadSources, eq(leadSources.id, customers.leadSourceId))
      .where(eq(customers.id, id))
      .limit(1);
    if (!row) notFound();
    if (!(await canSeeCustomer(user, id))) throw new ForbiddenError();
    const c = row.c;
    const [{ revealed }, props, tagMap, balances, stats] = await Promise.all([
      contactRevealedFor(user, id),
      db
        .select()
        .from(properties)
        .where(and(eq(properties.customerId, id), isNull(properties.deletedAt)))
        .orderBy(sql`${properties.isPrimary} desc`, properties.createdAt),
      getEntityTags([{ type: "customer", id }]).catch(
        () => ({}) as Record<string, CustomerDetail["tags"]>,
      ),
      user.perms.has("invoices.view")
        ? getCustomerBalances([id]).catch(() => ({}) as Record<string, number>)
        : Promise.resolve(null),
      execRows<{ jobs: number; ltv: number; leads: number }>(sql`
        select
          (select count(*)::int from jobs j where j.customer_id = ${id} and j.status <> 'cancelled') as jobs,
          (select coalesce(sum(p.amount_cents), 0)::bigint from payments p
             where p.customer_id = ${id} and p.status in ('succeeded','partially_refunded','refunded','disputed'))
          - (select coalesce(sum(r.amount_cents), 0)::bigint from refunds r join payments p on p.id = r.payment_id
             where p.customer_id = ${id} and r.status = 'succeeded') as ltv,
          (select count(*)::int from leads l where l.customer_id = ${id} and l.status in ('new','contacted','qualified')) as leads`),
    ]);
    await auditCustomerView(user, id);
    const canEdit = user.perms.has("customers.edit");
    const s = stats[0];
    const anonymized = !!c.anonymizedAt;
    return {
      id: c.id,
      displayName: c.displayName,
      type: c.type as CustomerType,
      firstName: c.firstName,
      lastName: c.lastName,
      companyName: c.companyName,
      phone: revealed && !anonymized ? c.phone : null,
      phoneDisplay: phoneOut(c.phone, revealed && !anonymized),
      phoneAlt: revealed && !anonymized ? c.phoneAlt : null,
      phoneAltDisplay: phoneOut(c.phoneAlt, revealed && !anonymized),
      email: revealed && !anonymized ? c.email : maskEmail(c.email),
      contactRevealed: revealed,
      preferredChannel: c.preferredChannel,
      language: c.language,
      smsStatus: c.smsStatus,
      flags: flagsOf(c),
      notes: c.notes,
      source: c.source,
      sourceName: row.sourceName,
      firstTouch: c.firstTouch ?? null,
      custom: c.custom ?? {},
      createdAt: c.createdAt,
      anonymizedAt: c.anonymizedAt,
      deletedAt: c.deletedAt,
      mergedIntoId: c.mergedIntoId,
      balanceCents: balances ? (balances[id] ?? 0) : null,
      lifetimeCents: Number(s?.ltv ?? 0),
      jobCount: Number(s?.jobs ?? 0),
      openLeadCount: Number(s?.leads ?? 0),
      properties: props.map((p) => toPropertyView(p, canEdit, revealed)),
      tags: tagMap[id] ?? [],
    };
  },
);

/** Editable fields (customers.edit). */
export async function getCustomerEditable(
  id: string,
): Promise<CustomerEditable | null> {
  await requireUser("customers.edit");
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!c) return null;
  return {
    id: c.id,
    type: c.type as CustomerType,
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: c.displayName,
    companyName: c.companyName,
    phone: c.phone,
    phoneAlt: c.phoneAlt,
    email: c.email,
    preferredChannel:
      c.preferredChannel as CustomerEditable["preferredChannel"],
    language: c.language,
    notes: c.notes,
    custom: c.custom ?? {},
  };
}

/**
 * Duplicate candidates (M03): exact E.164 phone or email, plus a fuzzy same-address
 * prompt (normalized street + ZIP). Excludes merged/deleted rows and `excludeId`.
 */
export async function findDuplicates(i: {
  phoneE164?: string | null;
  email?: string | null;
  street?: string | null;
  zip?: string | null;
  excludeId?: string | null;
}): Promise<DuplicateCandidate[]> {
  const user = await requireUser("customers.view");
  const reveal = user.perms.has("customers.contact_view");
  const out = new Map<string, DuplicateCandidate>();
  const email = normEmail(i.email);
  const exclude = i.excludeId ?? "00000000-0000-0000-0000-000000000000";
  const base = sql`c.deleted_at is null and c.merged_into_id is null and c.id <> ${exclude}::uuid and ${scopeSql(user)}`;
  type R = {
    id: string;
    display_name: string;
    phone: string | null;
    email: string | null;
    street: string | null;
    unit: string | null;
    reason: "phone" | "email" | "address";
  };
  const queries = [];
  if (i.phoneE164)
    queries.push(
      sql`(select c.id, c.display_name, c.phone, c.email, null::text as street, null::text as unit, 'phone'::text as reason
          from customers c where (c.phone = ${i.phoneE164} or c.phone_alt = ${i.phoneE164}) and ${base} limit 5)`,
    );
  if (email)
    queries.push(
      sql`(select c.id, c.display_name, c.phone, c.email, null::text as street, null::text as unit, 'email'::text as reason
          from customers c where c.email = ${email} and ${base} limit 5)`,
    );
  const zip = normZip(i.zip);
  const street = normStreet(i.street);
  if (zip && street) {
    // Fuzzy: same ZIP and the same house number + first street word.
    const [num, word] = street.split(" ");
    if (num && word)
      queries.push(
        sql`(select c.id, c.display_name, c.phone, c.email, p.street, p.unit, 'address'::text as reason
            from properties p join customers c on c.id = p.customer_id
            where p.zip = ${zip} and p.deleted_at is null and lower(p.street) like ${`${num} ${word}%`} and ${base} limit 5)`,
      );
  }
  if (queries.length === 0) return [];
  // Each branch is parenthesized: a bare `... limit 5 union all ...` is a syntax error (T2-02).
  const rows = await execRows<R>(sql.join(queries, sql` union all `));
  for (const r of rows) {
    if (out.has(r.id)) continue;
    out.set(r.id, {
      id: r.id,
      displayName: r.display_name,
      phoneDisplay: phoneOut(r.phone, reveal),
      email: reveal ? r.email : maskEmail(r.email),
      addressShort: r.street
        ? reveal
          ? addressShort({ street: r.street, unit: r.unit })
          : maskStreet(r.street)
        : null,
      reason: r.reason,
    });
  }
  return [...out.values()];
}

/** Customers for the S3 picker (search by name/phone/email/street). */
export async function pickerSearch(
  user: SessionUser,
  q: string,
  limit = 12,
): Promise<PickerCustomer[]> {
  const reveal = user.perms.has("customers.contact_view");
  const text = q.trim().toLowerCase();
  const conds = [
    sql`c.deleted_at is null`,
    sql`c.merged_into_id is null`,
    sql`c.anonymized_at is null`,
    scopeSql(user),
  ];
  if (text) {
    const like = `${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = text.replace(/\D/g, "");
    const ors = [
      sql`lower(c.display_name) like ${like}`,
      sql`lower(c.display_name) like ${`% ${like}`}`,
      sql`c.email like ${like}`,
      sql`exists (select 1 from properties p where p.customer_id = c.id and p.deleted_at is null and lower(p.street) like ${`%${text}%`})`,
    ];
    if (digits.length >= 4) ors.push(sql`c.phone like ${`%${digits}%`}`);
    conds.push(sql`(${sql.join(ors, sql` or `)})`);
  }
  const rows = await execRows<{
    id: string;
    display_name: string;
    phone: string | null;
    email: string | null;
  }>(sql`
    select c.id, c.display_name, c.phone, c.email from customers c
    where ${sql.join(conds, sql` and `)}
    order by ${text ? sql`lower(c.display_name)` : sql`c.updated_at desc`} limit ${limit}`);
  if (rows.length === 0) return [];
  const props = await db
    .select()
    .from(properties)
    .where(
      and(
        sql`${properties.customerId} in (${sql.join(
          rows.map((r) => sql`${r.id}::uuid`),
          sql`, `,
        )})`,
        isNull(properties.deletedAt),
      ),
    )
    .orderBy(sql`${properties.isPrimary} desc`, properties.createdAt);
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    subtitle:
      [phoneOut(r.phone, reveal), reveal ? r.email : null]
        .filter(Boolean)
        .join(" · ") || "No contact info",
    properties: props
      .filter((p) => p.customerId === r.id)
      .map((p) => ({
        id: p.id,
        label: p.label,
        addressLine: reveal
          ? addressLine(p)
          : `${maskStreet(p.street)}, ${p.city}, ${p.state} ${p.zip}`,
      })),
  }));
}

/** Side-by-side merge preview (both rows + related counts). */
export async function getMergePreview(aId: string, bId: string) {
  await requireUser("customers.merge");
  const rows = await db
    .select()
    .from(customers)
    .where(sql`${customers.id} in (${aId}::uuid, ${bId}::uuid)`);
  const a = rows.find((r) => r.id === aId);
  const b = rows.find((r) => r.id === bId);
  if (!a || !b) return null;
  const counts = await execRows<{
    id: string;
    jobs: number;
    invoices: number;
    props: number;
    leads: number;
  }>(sql`
    select c.id,
      (select count(*)::int from jobs j where j.customer_id = c.id) as jobs,
      (select count(*)::int from invoices i where i.customer_id = c.id) as invoices,
      (select count(*)::int from properties p where p.customer_id = c.id and p.deleted_at is null) as props,
      (select count(*)::int from leads l where l.customer_id = c.id) as leads
    from customers c where c.id in (${aId}::uuid, ${bId}::uuid)`);
  const countOf = (id: string) => counts.find((c) => c.id === id);
  return { a, b, countsA: countOf(aId), countsB: countOf(bId) };
}

/** All rows for the CSV export (customers.export). */
export async function exportCustomerRows() {
  await requireUser("customers.export");
  return execRows<Record<string, unknown>>(sql`
    select c.id, c.type, c.display_name, c.first_name, c.last_name, c.company_name, c.phone, c.phone_alt,
      c.email, c.preferred_channel, c.sms_status, c.vip, c.do_not_service, c.prepay_required, c.dispute_history,
      c.tax_exempt, c.do_not_text, c.source, c.notes, c.created_at,
      p.street, p.unit, p.city, p.state, p.zip
    from customers c
    left join lateral (select * from properties p where p.customer_id = c.id and p.deleted_at is null
      order by p.is_primary desc, p.created_at limit 1) p on true
    where c.deleted_at is null and c.merged_into_id is null and c.anonymized_at is null
    order by lower(c.display_name)`);
}
