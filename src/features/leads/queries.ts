import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db, execRows } from "@/db";
import { leadEvents, leadSources, sourceSpend } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import type {
  IntegrationKind,
  LeadListItem,
  LeadSourceListItem,
  LeadStatus,
  LeadView,
} from "./contracts";

// Read side of the leads module. Every entry point checks `leads.view` (or
// `settings.api_keys` for sources/keys) via the caller's requireUser — the pages
// pass the viewer in so the check is never only in the UI.

export const LEAD_PAGE_SIZE = 60;

export interface LeadFilter {
  view?: LeadView;
  status?: string[];
  source?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  filter?: "check" | "breached" | "mine";
  q?: string;
  offset?: number;
}

const OPEN = ["new", "contacted", "qualified"];

function assertViewer(user: SessionUser) {
  if (!user.perms.has("leads.view")) throw new NotFoundError("Lead");
}

type LeadRow = {
  id: string;
  status: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  service_text: string | null;
  service_name: string | null;
  source_name: string | null;
  source_kind: string | null;
  quoted_price_cents: number | null;
  preferred_date: string | null;
  preferred_window: string | null;
  created_at: Date | string;
  first_response_at: Date | string | null;
  spam_score: number;
  is_returning: boolean;
  is_test: boolean;
  assigned_user_id: string | null;
  assigned_name: string | null;
  customer_id: string | null;
  zip: string | null;
  lost_reason: string | null;
  notes: string | null;
};

const iso = (d: Date | string | null): string | null =>
  d == null ? null : new Date(d).toISOString();

export function toLeadItem(
  r: LeadRow,
  threshold: number,
  serviceZips: readonly string[],
): LeadListItem {
  const zip = r.zip ? (/\d{5}/.exec(r.zip)?.[0] ?? null) : null;
  return {
    id: r.id,
    status: r.status as LeadStatus,
    name:
      r.name?.trim() ||
      (r.phone ? formatPhone(r.phone) : null) ||
      r.email ||
      "Unknown",
    phoneDisplay: r.phone ? formatPhone(r.phone) : null,
    hasPhone: !!r.phone,
    email: r.email,
    service: r.service_name ?? r.service_text,
    sourceName: r.source_name,
    sourceKind: r.source_kind,
    quotedPriceCents:
      r.quoted_price_cents == null ? null : Number(r.quoted_price_cents),
    preferredDate: r.preferred_date,
    preferredWindow: r.preferred_window,
    createdAt: iso(r.created_at) as string,
    firstResponseAt: iso(r.first_response_at),
    spamScore: Number(r.spam_score),
    flagged:
      r.status !== "spam" &&
      OPEN.includes(r.status) &&
      Number(r.spam_score) >= threshold,
    isReturning: r.is_returning,
    isTest: r.is_test,
    assignedUserId: r.assigned_user_id,
    assignedName: r.assigned_name,
    customerId: r.customer_id,
    zip,
    inServiceArea:
      serviceZips.length === 0 || !zip ? null : serviceZips.includes(zip),
    lostReason: r.lost_reason,
    notes: r.notes,
  };
}

const LEAD_SELECT = sql`
  select l.id, l.status, l.name, l.phone, l.email, l.service_text,
    st.name as service_name, s.name as source_name, s.kind as source_kind,
    l.quoted_price_cents, l.preferred_date::text as preferred_date, l.preferred_window,
    l.created_at, l.first_response_at, l.spam_score, l.is_returning, l.is_test,
    l.assigned_user_id, u.name as assigned_name, l.customer_id,
    coalesce(l.address->>'zip', p.zip) as zip, l.lost_reason, left(l.notes, 240) as notes
  from leads l
  left join lead_sources s on s.id = l.lead_source_id
  left join service_types st on st.id = l.service_type_id
  left join users u on u.id = l.assigned_user_id
  left join properties p on p.id = l.property_id`;

/** Leads inbox (SLA-sorted): unanswered new leads first (longest waiting on top). */
export async function listLeads(
  viewer: SessionUser,
  f: LeadFilter,
): Promise<{ items: LeadListItem[]; hasMore: boolean }> {
  assertViewer(viewer);
  const s = await getSettings();
  const threshold = s.leads.spam_review_threshold;
  const sla = s.company.lead_response_minutes;
  const conds = [sql`true`];
  const view = f.view ?? (f.status?.length || f.filter ? "all" : "inbox");
  if (f.status?.length)
    conds.push(
      sql`l.status in (${sql.join(
        f.status.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
  switch (view) {
    case "inbox":
      conds.push(
        sql`l.status in ('new','contacted','qualified') and l.spam_score < ${threshold}`,
      );
      break;
    case "check":
      conds.push(
        sql`l.status in ('new','contacted','qualified') and l.spam_score >= ${threshold}`,
      );
      break;
    case "booked":
      conds.push(sql`l.status = 'booked'`);
      break;
    case "lost":
      conds.push(sql`l.status = 'lost'`);
      break;
    case "spam":
      conds.push(sql`l.status = 'spam'`);
      break;
    default:
      if (!f.status?.length) conds.push(sql`l.status <> 'spam'`);
  }
  if (f.filter === "check")
    conds.push(
      sql`l.spam_score >= ${threshold} and l.status in ('new','contacted','qualified')`,
    );
  if (f.filter === "mine") conds.push(sql`l.assigned_user_id = ${viewer.id}`);
  if (f.filter === "breached")
    conds.push(
      sql`l.status = 'new' and l.first_response_at is null and l.created_at < now() - make_interval(mins => ${Math.max(1, sla)})`,
    );
  if (f.source) conds.push(sql`l.lead_source_id::text = ${f.source}`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from))
    conds.push(sql`l.created_at >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to))
    conds.push(sql`l.created_at < (${f.to}::date + 1)`);
  if (f.q?.trim()) {
    const q = `%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = f.q.replace(/\D/g, "");
    conds.push(
      sql`(l.name ilike ${q} or l.email ilike ${q} or l.service_text ilike ${q}${
        digits.length >= 4 ? sql` or l.phone like ${`%${digits}%`}` : sql``
      })`,
    );
  }
  const offset = Math.max(0, f.offset ?? 0);
  const rows = await execRows<LeadRow>(sql`${LEAD_SELECT}
    where ${sql.join(conds, sql` and `)}
    order by (l.status = 'new' and l.first_response_at is null) desc,
      case when l.status = 'new' and l.first_response_at is null then l.created_at end asc,
      l.created_at desc, l.id
    limit ${LEAD_PAGE_SIZE + 1} offset ${offset}`);
  const items = rows
    .slice(0, LEAD_PAGE_SIZE)
    .map((r) => toLeadItem(r, threshold, s.company.service_zips));
  return { items, hasMore: rows.length > LEAD_PAGE_SIZE };
}

/** Segment counts for the inbox header. */
export async function leadCounts(
  viewer: SessionUser,
): Promise<Record<LeadView | "breached" | "mine", number>> {
  assertViewer(viewer);
  const s = await getSettings();
  const t = s.leads.spam_review_threshold;
  const sla = Math.max(1, s.company.lead_response_minutes);
  const [r] = await execRows<Record<string, number>>(sql`
    select
      count(*) filter (where status in ('new','contacted','qualified') and spam_score < ${t})::int as inbox,
      count(*) filter (where status in ('new','contacted','qualified') and spam_score >= ${t})::int as check,
      count(*) filter (where status = 'booked')::int as booked,
      count(*) filter (where status = 'lost')::int as lost,
      count(*) filter (where status = 'spam')::int as spam,
      count(*) filter (where status <> 'spam')::int as all,
      count(*) filter (where status = 'new' and first_response_at is null
        and created_at < now() - make_interval(mins => ${sla}))::int as breached,
      count(*) filter (where assigned_user_id = ${viewer.id} and status in ('new','contacted','qualified'))::int as mine
    from leads`);
  return {
    inbox: Number(r?.inbox ?? 0),
    check: Number(r?.check ?? 0),
    booked: Number(r?.booked ?? 0),
    lost: Number(r?.lost ?? 0),
    spam: Number(r?.spam ?? 0),
    all: Number(r?.all ?? 0),
    breached: Number(r?.breached ?? 0),
    mine: Number(r?.mine ?? 0),
  };
}

export interface LeadDetail extends LeadListItem {
  address: {
    street?: string;
    unit?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  propertyId: string | null;
  serviceTypeId: string | null;
  leadSourceId: string | null;
  externalId: string | null;
  attribution: Record<string, unknown>;
  extra: Record<string, unknown>;
  custom: Record<string, unknown>;
  sourceCostCents: number | null;
  smsConsent: boolean;
  marketingConsent: boolean;
  firstResponseBy: string | null;
  firstResponseByName: string | null;
  spamReason: string | null;
  convertedJobId: string | null;
  convertedJobNumber: string | null;
  convertedEstimateId: string | null;
  convertedEstimateNumber: string | null;
  notesFull: string | null;
  phone: string | null;
  events: {
    id: string;
    kind: string;
    outcome: string | null;
    createdAt: string;
    actorName: string | null;
    raw: unknown;
  }[];
}

/** Full lead (inbox detail). Throws NotFound when missing or not visible. */
export const getLeadDetail = cache(
  async (viewer: SessionUser, leadId: string): Promise<LeadDetail> => {
    assertViewer(viewer);
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new NotFoundError("Lead");
    const s = await getSettings();
    const [r] = await execRows<
      LeadRow & {
        address: LeadDetail["address"];
        property_id: string | null;
        service_type_id: string | null;
        lead_source_id: string | null;
        external_id: string | null;
        attribution: Record<string, unknown>;
        extra: Record<string, unknown>;
        custom: Record<string, unknown> | null;
        source_cost_cents: number | null;
        sms_consent: boolean;
        marketing_consent: boolean;
        first_response_by: string | null;
        responder_name: string | null;
        spam_reason: string | null;
        converted_job_id: string | null;
        job_number: string | null;
        converted_estimate_id: string | null;
        estimate_number: string | null;
        notes_full: string | null;
      }
    >(sql`
      select x.*, l.address, l.property_id, l.service_type_id, l.lead_source_id, l.external_id,
        l.attribution, l.extra, l.custom, l.source_cost_cents, l.sms_consent, l.marketing_consent,
        l.first_response_by, ru.name as responder_name, l.spam_reason,
        l.converted_job_id, j.number as job_number, l.converted_estimate_id,
        e.number as estimate_number, l.notes as notes_full
      from (${LEAD_SELECT} where l.id = ${leadId}) x
      join leads l on l.id = x.id
      left join users ru on ru.id = l.first_response_by
      left join jobs j on j.id = l.converted_job_id
      left join estimates e on e.id = l.converted_estimate_id`);
    if (!r) throw new NotFoundError("Lead");
    const events = await execRows<{
      id: string;
      kind: string;
      outcome: string | null;
      created_at: Date | string;
      actor_name: string | null;
      raw: unknown;
    }>(sql`
      select e.id, e.kind, e.outcome, e.created_at, u.name as actor_name, e.raw
      from lead_events e left join users u on u.id = e.actor_user_id
      where e.lead_id = ${leadId} order by e.created_at desc limit 50`);
    return {
      ...toLeadItem(r, s.leads.spam_review_threshold, s.company.service_zips),
      address: r.address,
      propertyId: r.property_id,
      serviceTypeId: r.service_type_id,
      leadSourceId: r.lead_source_id,
      externalId: r.external_id,
      attribution: r.attribution ?? {},
      extra: r.extra ?? {},
      // Older rows kept custom values in extra.custom.
      custom: {
        ...((r.extra?.custom as Record<string, unknown> | undefined) ?? {}),
        ...(r.custom ?? {}),
      },
      sourceCostCents:
        r.source_cost_cents == null ? null : Number(r.source_cost_cents),
      smsConsent: r.sms_consent,
      marketingConsent: r.marketing_consent,
      firstResponseBy: r.first_response_by,
      firstResponseByName: r.responder_name,
      spamReason: r.spam_reason,
      convertedJobId: r.converted_job_id,
      convertedJobNumber: r.job_number,
      convertedEstimateId: r.converted_estimate_id,
      convertedEstimateNumber: r.estimate_number,
      notesFull: r.notes_full,
      phone: r.phone,
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        outcome: e.outcome,
        createdAt: new Date(e.created_at).toISOString(),
        actorName: e.actor_name,
        raw: e.raw,
      })),
    };
  },
);

// ------------------------------------------------------------------ sources

export async function listActiveSources(): Promise<
  { id: string; name: string; kind: string }[]
> {
  return db
    .select({
      id: leadSources.id,
      name: leadSources.name,
      kind: leadSources.kind,
    })
    .from(leadSources)
    .where(eq(leadSources.active, true))
    .orderBy(leadSources.name);
}

function assertKeysViewer(user: SessionUser) {
  if (!user.perms.has("settings.api_keys")) throw new NotFoundError("Source");
}

/** Sources with 30-day volume (settings list). */
export async function listLeadSources(
  viewer: SessionUser,
): Promise<LeadSourceListItem[]> {
  assertKeysViewer(viewer);
  const rows = await execRows<{
    id: string;
    name: string;
    kind: string;
    integration_kind: string;
    preset: string;
    public_key: string | null;
    active: boolean;
    leads30: number;
    booked30: number;
    last_at: Date | string | null;
    has_secret: boolean;
    has_hook: boolean;
  }>(sql`
    select s.id, s.name, s.kind, s.integration_kind, s.preset, s.public_key, s.active,
      count(l.id) filter (where l.created_at > now() - interval '30 days' and l.status <> 'spam')::int as leads30,
      count(l.id) filter (where l.created_at > now() - interval '30 days' and l.status = 'booked')::int as booked30,
      max(l.created_at) as last_at,
      (s.secret_hash is not null) as has_secret, (s.hook_secret_hash is not null) as has_hook
    from lead_sources s left join leads l on l.lead_source_id = s.id
    group by s.id order by s.active desc, s.name`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    integrationKind: r.integration_kind as IntegrationKind,
    preset: r.preset,
    publicKey: r.public_key,
    active: r.active,
    leads30d: Number(r.leads30),
    booked30d: Number(r.booked30),
    lastLeadAt: iso(r.last_at),
    hasSecret: r.has_secret,
    hasHookSecret: r.has_hook,
  }));
}

export type LeadSourceRow = typeof leadSources.$inferSelect;

export async function getLeadSource(
  viewer: SessionUser,
  id: string,
): Promise<LeadSourceRow> {
  assertKeysViewer(viewer);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Source");
  const [s] = await db
    .select()
    .from(leadSources)
    .where(eq(leadSources.id, id))
    .limit(1);
  if (!s) throw new NotFoundError("Source");
  return s;
}

/** Last N raw payloads received by a source (test console). */
export async function recentPayloads(
  viewer: SessionUser,
  sourceId: string,
  limit = 20,
): Promise<
  {
    id: string;
    kind: string;
    outcome: string | null;
    leadId: string | null;
    createdAt: string;
    raw: unknown;
    ip: string | null;
  }[]
> {
  assertKeysViewer(viewer);
  const rows = await db
    .select({
      id: leadEvents.id,
      kind: leadEvents.kind,
      outcome: leadEvents.outcome,
      leadId: leadEvents.leadId,
      createdAt: leadEvents.createdAt,
      raw: leadEvents.raw,
      ip: leadEvents.ip,
    })
    .from(leadEvents)
    .where(
      and(
        eq(leadEvents.leadSourceId, sourceId),
        sql`${leadEvents.kind} in ('received','spam','touch')`,
      ),
    )
    .orderBy(desc(leadEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    raw:
      r.kind === "touch" && r.raw && typeof r.raw === "object"
        ? ((r.raw as { payload?: unknown }).payload ?? r.raw)
        : r.raw,
  }));
}

export async function listSourceSpend(sourceId: string) {
  return db
    .select()
    .from(sourceSpend)
    .where(eq(sourceSpend.leadSourceId, sourceId))
    .orderBy(desc(sourceSpend.month))
    .limit(24);
}

/** ROI per source over the last N months: spend (per-lead + monthly) vs booked revenue. */
export async function sourceRoi(sourceId: string, months = 3) {
  const [r] = await execRows<{
    leads: number;
    booked: number;
    per_lead: number;
    monthly: number;
    revenue: number;
  }>(sql`
    select
      (select count(*) from leads where lead_source_id = ${sourceId} and status <> 'spam'
         and created_at > now() - make_interval(months => ${months}))::int as leads,
      (select count(*) from leads where lead_source_id = ${sourceId} and status = 'booked'
         and created_at > now() - make_interval(months => ${months}))::int as booked,
      (select coalesce(sum(source_cost_cents), 0) from leads where lead_source_id = ${sourceId}
         and created_at > now() - make_interval(months => ${months}))::bigint as per_lead,
      (select coalesce(sum(amount_cents), 0) from source_spend where lead_source_id = ${sourceId}
         and month > (now() - make_interval(months => ${months}))::date)::bigint as monthly,
      (select coalesce(sum(i.total_cents), 0) from leads l join invoices i on i.job_id = l.converted_job_id
         where l.lead_source_id = ${sourceId} and i.status not in ('draft','void')
         and l.created_at > now() - make_interval(months => ${months}))::bigint as revenue`).catch(
    () => [],
  );
  return {
    leads: Number(r?.leads ?? 0),
    booked: Number(r?.booked ?? 0),
    spendCents: Number(r?.per_lead ?? 0) + Number(r?.monthly ?? 0),
    revenueCents: Number(r?.revenue ?? 0),
  };
}

// ------------------------------------------------------------------ api keys

export async function listApiKeys(viewer: SessionUser) {
  assertKeysViewer(viewer);
  const rows = await execRows<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    last_used_at: Date | string | null;
    created_at: Date | string;
    revoked_at: Date | string | null;
    created_by_name: string | null;
  }>(sql`
    select k.id, k.name, k.prefix, k.scopes, k.last_used_at, k.created_at, k.revoked_at,
      u.name as created_by_name
    from api_keys k left join users u on u.id = k.created_by
    order by k.revoked_at nulls first, k.created_at desc`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes ?? [],
    lastUsedAt: iso(r.last_used_at),
    createdAt: iso(r.created_at) as string,
    revokedAt: iso(r.revoked_at),
    createdByName: r.created_by_name,
  }));
}
