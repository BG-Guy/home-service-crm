import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db, execRows } from "@/db";
import { leadEvents, leadSources, sourceSpend } from "@/db/schema";
import { isJobKind } from "@/features/jobs/kinds";
import { NotFoundError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { addDaysToKey, dateKey, formatDateKey, zonedParts } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type {
  CallerOpenLead,
  IntegrationKind,
  LeadBoxData,
  LeadCardData,
  LeadListItem,
  LeadPriority,
  LeadSourceListItem,
  LeadStatus,
  LeadView,
} from "./contracts";
import {
  isFlagged,
  isOpenStatus,
  previousOpenStatus,
  reopenRule,
  type StatusHop,
  shortName,
} from "./rules";

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
  /** Older single filter links (?filter=mine|breached|check). */
  filter?: "check" | "breached" | "mine";
  /** Filter sheet: assigned to me. */
  mine?: boolean;
  /** Filter sheet: new, unanswered, past the reply target. */
  overdue?: boolean;
  q?: string;
  offset?: number;
}

const OPEN = ["new", "contacted", "qualified"];

function assertViewer(user: SessionUser) {
  if (!user.perms.has("leads.view")) throw new NotFoundError("Lead");
}

/**
 * The one lead count (build SPEC fix "one count everywhere"): the Leads badge on
 * the tab bar and sidebar and the New chip both count leads with status `new`
 * outside "Check". TS twin: `countsAsNew` in rules.ts (golden-tested).
 */
export function newLeadsWhere(threshold: number, alias = "l") {
  const a = sql.raw(alias);
  return sql`${a}.status = 'new' and ${a}.spam_score < ${threshold}`;
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

// ------------------------------------------------------------------ lead boxes

type BoxRow = LeadRow & {
  service_kind: string | null;
  street: string | null;
  unit: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  overdue: boolean;
  converted_job_id: string | null;
  job_number: string | null;
  job_status: string | null;
  window_start: Date | string | null;
  window_end: Date | string | null;
  scheduled_start: Date | string | null;
};

/** The box columns (one row per lead, every join 1:1). */
const boxSelect = (sla: number) => sql`
  select l.id, l.status, l.name, l.phone, l.email, l.service_text,
    st.name as service_name, st.kind as service_kind,
    s.name as source_name, s.kind as source_kind,
    l.quoted_price_cents, l.preferred_date::text as preferred_date, l.preferred_window,
    l.created_at, l.first_response_at, l.spam_score, l.is_returning, l.is_test,
    l.assigned_user_id, u.name as assigned_name, l.customer_id,
    coalesce(nullif(l.address->>'zip', ''), p.zip) as zip,
    coalesce(nullif(l.address->>'street', ''), p.street) as street,
    case when nullif(l.address->>'street', '') is not null
      then nullif(l.address->>'unit', '') else p.unit end as unit,
    coalesce(nullif(l.address->>'city', ''), p.city) as city,
    p.lat, p.lng,
    (l.status = 'new' and l.first_response_at is null
      and l.created_at < now() - make_interval(mins => ${sla})) as overdue,
    l.lost_reason, left(l.notes, 240) as notes,
    l.converted_job_id, j.number as job_number, j.status as job_status,
    j.window_start, j.window_end, j.scheduled_start
  from leads l
  left join lead_sources s on s.id = l.lead_source_id
  left join service_types st on st.id = l.service_type_id
  left join users u on u.id = l.assigned_user_id
  left join properties p on p.id = l.property_id
  left join jobs j on j.id = l.converted_job_id`;

const clock = (h24: number, m: number) => {
  const h = h24 % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")}` : String(h);
};
const half = (h24: number) => (h24 < 12 ? "AM" : "PM");

/** "Today", "Tomorrow", else "Fri, Oct 23" (`short`: "Fri" within a week). */
function dayWord(key: string, todayKey: string, short = false): string {
  if (key === todayKey) return "Today";
  if (key === addDaysToKey(todayKey, 1)) return "Tomorrow";
  const soon = key > todayKey && key <= addDaysToKey(todayKey, 6);
  return formatDateKey(
    key,
    "en-US",
    short && soon
      ? { weekday: "short" }
      : { weekday: "short", month: "short", day: "numeric" },
  );
}

/** Arrival window "8–10 AM" / "11 AM–1 PM" in the company zone. */
function windowText(
  start: Date | string,
  end: Date | string | null,
  tz: string,
) {
  const a = zonedParts(start, tz);
  if (!end) return `${clock(a.hour, a.minute)} ${half(a.hour)}`;
  const b = zonedParts(end, tz);
  const to = `${clock(b.hour, b.minute)} ${half(b.hour)}`;
  return half(a.hour) === half(b.hour)
    ? `${clock(a.hour, a.minute)}–${to}`
    : `${clock(a.hour, a.minute)} ${half(a.hour)}–${to}`;
}

/** Booked: the job's arrival window; open: the day they asked for. */
function whenOf(r: BoxRow, tz: string, todayKey: string): LeadBoxData["when"] {
  const start = r.window_start ?? r.scheduled_start;
  if (r.status === "booked" && start) {
    const day = dateKey(start, tz);
    const w = windowText(start, r.window_end, tz);
    const a = zonedParts(start, tz);
    const b = r.window_end ? zonedParts(r.window_end, tz) : null;
    const compact = b
      ? `${clock(a.hour, a.minute)}–${clock(b.hour, b.minute)}`
      : `${clock(a.hour, a.minute)} ${half(a.hour)}`;
    const inWeek = day > todayKey && day <= addDaysToKey(todayKey, 6);
    const shortDay =
      day === todayKey
        ? "Today"
        : formatDateKey(
            day,
            "en-US",
            inWeek ? { weekday: "short" } : { month: "short", day: "numeric" },
          );
    return {
      kind: "arrival",
      label: `${dayWord(day, todayKey)} · ${w}`,
      short: `${shortDay} ${compact}`,
      date: day,
    };
  }
  const win = r.preferred_window?.trim() || null;
  if (!r.preferred_date && !win) return null;
  const parts = [
    r.preferred_date ? dayWord(r.preferred_date, todayKey) : null,
    win,
  ].filter(Boolean);
  return {
    kind: "requested",
    label: parts.join(" · "),
    short: r.preferred_date
      ? dayWord(r.preferred_date, todayKey, true)
      : (win as string),
    date: r.preferred_date,
  };
}

function initialsOf(name: string): string {
  if (/^[\d\s()+.-]+$/.test(name)) return "#";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last =
    parts.length > 1
      ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "")
      : "";
  return (first + last).toUpperCase() || "?";
}

interface BoxCtx {
  threshold: number;
  serviceZips: readonly string[];
  tz: string;
  todayKey: string;
  viewerId: string;
}

export function toLeadBox(r: BoxRow, c: BoxCtx): LeadBoxData {
  const zip = r.zip ? (/\d{5}/.exec(r.zip)?.[0] ?? null) : null;
  const name =
    r.name?.trim() ||
    (r.phone ? formatPhone(r.phone) : null) ||
    r.email ||
    "Unknown";
  const spamScore = Number(r.spam_score);
  return {
    id: r.id,
    name,
    shortName: shortName(name),
    initials: initialsOf(name),
    status: r.status as LeadStatus,
    kind: isJobKind(r.service_kind) ? r.service_kind : null,
    serviceName: r.service_name ?? r.service_text,
    street: r.street ? `${r.street}${r.unit ? ` ${r.unit}` : ""}` : null,
    city: r.city || null,
    zip,
    phone: r.phone ? formatPhone(r.phone) : null,
    phoneE164: r.phone,
    email: r.email,
    customerId: r.customer_id,
    when: whenOf(r, c.tz, c.todayKey),
    slaStart: iso(r.created_at) as string,
    respondedAt: iso(r.first_response_at),
    source: r.source_name,
    sourceKind: r.source_kind,
    quoteCents:
      r.quoted_price_cents == null ? null : Number(r.quoted_price_cents),
    lostReason: r.lost_reason,
    job: r.converted_job_id
      ? {
          id: r.converted_job_id,
          number: r.job_number,
          status: r.job_status ?? "unknown",
          cancelled: r.job_status === "cancelled",
        }
      : null,
    assignedUserId: r.assigned_user_id,
    assignedName: r.assigned_name,
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    spamScore,
    flags: {
      check: isFlagged({ status: r.status, spamScore }, c.threshold),
      returning: r.is_returning,
      test: r.is_test,
      outsideArea:
        c.serviceZips.length > 0 && !!zip && !c.serviceZips.includes(zip),
      mine: !!r.assigned_user_id && r.assigned_user_id === c.viewerId,
      overdue: !!r.overdue,
    },
  };
}

async function boxCtx(viewer: SessionUser): Promise<BoxCtx & { sla: number }> {
  const [s, tz] = await Promise.all([getSettings(), getCompanyTimezone()]);
  return {
    threshold: s.leads.spam_review_threshold,
    serviceZips: s.company.service_zips,
    tz,
    todayKey: dateKey(new Date(), tz),
    viewerId: viewer.id,
    sla: Math.max(1, s.company.lead_response_minutes),
  };
}

/** View → status condition (`inbox` = every open lead outside "Check"). */
function viewWhere(view: LeadView, t: number) {
  switch (view) {
    case "inbox":
      return sql`l.status in ('new','contacted','qualified') and l.spam_score < ${t}`;
    case "new":
      return newLeadsWhere(t);
    case "contacted":
    case "qualified":
      return sql`l.status = ${view} and l.spam_score < ${t}`;
    case "check":
      return sql`l.status in ('new','contacted','qualified') and l.spam_score >= ${t}`;
    case "booked":
    case "lost":
    case "spam":
      return sql`l.status = ${view}`;
    default:
      return sql`l.status <> 'spam'`;
  }
}

/** The WHERE of the inbox list (and its count) for a filter. */
function listWhere(
  viewer: SessionUser,
  f: LeadFilter,
  c: BoxCtx & { sla: number },
) {
  const conds = [sql`true`];
  const view: LeadView =
    f.view ?? (f.status?.length || f.filter === "check" ? "all" : "inbox");
  if (f.status?.length)
    conds.push(
      sql`l.status in (${sql.join(
        f.status.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
  if (!(f.status?.length && view === "all"))
    conds.push(viewWhere(view, c.threshold));
  if (f.filter === "check")
    conds.push(
      sql`l.spam_score >= ${c.threshold} and l.status in ('new','contacted','qualified')`,
    );
  if (f.mine || f.filter === "mine")
    conds.push(sql`l.assigned_user_id = ${viewer.id}`);
  if (f.overdue || f.filter === "breached")
    conds.push(
      sql`l.status = 'new' and l.first_response_at is null and l.created_at < now() - make_interval(mins => ${c.sla})`,
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
  return sql.join(conds, sql` and `);
}

/** Leads inbox (SLA-sorted): unanswered new leads first (longest waiting on top). */
export async function listLeads(
  viewer: SessionUser,
  f: LeadFilter,
): Promise<{ items: LeadBoxData[]; hasMore: boolean }> {
  assertViewer(viewer);
  const c = await boxCtx(viewer);
  const offset = Math.max(0, f.offset ?? 0);
  const rows = await execRows<BoxRow>(sql`${boxSelect(c.sla)}
    where ${listWhere(viewer, f, c)}
    order by (l.status = 'new' and l.first_response_at is null) desc,
      case when l.status = 'new' and l.first_response_at is null then l.created_at end asc,
      l.created_at desc, l.id
    limit ${LEAD_PAGE_SIZE + 1} offset ${offset}`);
  const items = rows.slice(0, LEAD_PAGE_SIZE).map((r) => toLeadBox(r, c));
  return { items, hasMore: rows.length > LEAD_PAGE_SIZE };
}

/** How many leads a filter matches (the inbox's count line). */
export async function countLeads(
  viewer: SessionUser,
  f: LeadFilter,
): Promise<number> {
  assertViewer(viewer);
  const c = await boxCtx(viewer);
  const [r] = await execRows<{ n: number }>(
    sql`select count(*)::int as n from leads l where ${listWhere(viewer, f, c)}`,
  );
  return Number(r?.n ?? 0);
}

export type LeadCounts = Record<LeadView | "breached" | "mine", number>;

/** Chip counts. `new` is the one count (= the Leads badge, see newLeadsWhere). */
export async function leadCounts(viewer: SessionUser): Promise<LeadCounts> {
  assertViewer(viewer);
  const s = await getSettings();
  const t = s.leads.spam_review_threshold;
  const sla = Math.max(1, s.company.lead_response_minutes);
  const [r] = await execRows<Record<string, number>>(sql`
    select
      count(*) filter (where l.status in ('new','contacted','qualified') and l.spam_score < ${t})::int as inbox,
      count(*) filter (where ${newLeadsWhere(t)})::int as new,
      count(*) filter (where l.status = 'contacted' and l.spam_score < ${t})::int as contacted,
      count(*) filter (where l.status = 'qualified' and l.spam_score < ${t})::int as qualified,
      count(*) filter (where l.status in ('new','contacted','qualified') and l.spam_score >= ${t})::int as check,
      count(*) filter (where l.status = 'booked')::int as booked,
      count(*) filter (where l.status = 'lost')::int as lost,
      count(*) filter (where l.status = 'spam')::int as spam,
      count(*) filter (where l.status <> 'spam')::int as all,
      count(*) filter (where l.status = 'new' and l.first_response_at is null
        and l.created_at < now() - make_interval(mins => ${sla}))::int as breached,
      count(*) filter (where l.assigned_user_id = ${viewer.id} and l.status in ('new','contacted','qualified'))::int as mine
    from leads l`);
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    inbox: n("inbox"),
    new: n("new"),
    contacted: n("contacted"),
    qualified: n("qualified"),
    check: n("check"),
    booked: n("booked"),
    lost: n("lost"),
    spam: n("spam"),
    all: n("all"),
    breached: n("breached"),
    mine: n("mine"),
  };
}

/** The badge count (tab bar + sidebar): the same number as the New chip. */
export async function newLeadCount(): Promise<number> {
  const s = await getSettings();
  const [r] = await execRows<{ n: number }>(
    sql`select count(*)::int as n from leads l where ${newLeadsWhere(s.leads.spam_review_threshold)}`,
  );
  return Number(r?.n ?? 0);
}

// ------------------------------------------------------------------ lead card

/** Status changes of a lead, newest first (Reopen goes back along them). */
export async function leadStatusHistory(leadId: string): Promise<StatusHop[]> {
  const rows = await execRows<{ raw: { from?: string; to?: string } | null }>(
    sql`select raw from lead_events where lead_id = ${leadId} and kind = 'status'
        order by created_at desc, id desc limit 40`,
  );
  return rows
    .map((r) => ({
      from: String(r.raw?.from ?? ""),
      to: String(r.raw?.to ?? ""),
    }))
    .filter((h) => h.from && h.to);
}

const AUTOMATED_TEMPLATES = [
  "lead.ack",
  "lead.ack_after_hours",
  "lead.not_reached",
];

/**
 * The lead card's data (sheet and /leads/[id]): the box plus address, notes,
 * last contact, photos and the way back. One query for the lead, then small
 * lookups in parallel. Throws NotFound when missing or not visible.
 */
export const getLeadCard = cache(
  async (viewer: SessionUser, leadId: string): Promise<LeadCardData> => {
    assertViewer(viewer);
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new NotFoundError("Lead");
    const c = await boxCtx(viewer);
    const [r] = await execRows<
      BoxRow & {
        address: {
          street?: string;
          unit?: string;
          city?: string;
          state?: string;
          zip?: string;
        } | null;
        p_street: string | null;
        p_unit: string | null;
        p_city: string | null;
        p_state: string | null;
        p_zip: string | null;
        address_text: string | null;
        notes_full: string | null;
        service_type_id: string | null;
        lead_source_id: string | null;
        booking: {
          kind?: string;
          priority?: string;
          after_hours?: boolean;
        } | null;
        sms_consent: boolean;
        spam_reason: string | null;
        responder_name: string | null;
        converted_estimate_id: string | null;
        estimate_number: string | null;
      }
    >(sql`
      select x.*, l.address, p.street as p_street, p.unit as p_unit, p.city as p_city,
        p.state as p_state, p.zip as p_zip, l.extra->>'_address_text' as address_text,
        l.notes as notes_full, l.service_type_id, l.lead_source_id,
        l.extra->'_booking' as booking, l.sms_consent, l.spam_reason,
        ru.name as responder_name, l.converted_estimate_id, e.number as estimate_number
      from (${boxSelect(c.sla)} where l.id = ${leadId}) x
      join leads l on l.id = x.id
      left join properties p on p.id = l.property_id
      left join users ru on ru.id = l.first_response_by
      left join estimates e on e.id = l.converted_estimate_id`);
    if (!r) throw new NotFoundError("Lead");
    const box = toLeadBox(r, c);
    const created = new Date(r.created_at);
    const [history, lastCall, lastMsg, photos] = await Promise.all([
      leadStatusHistory(leadId),
      execRows<{
        outcome: string;
        at: Date | string;
        by_name: string | null;
      }>(sql`
        select c.outcome, c.created_at as at, u.name as by_name
        from calls c left join users u on u.id = c.user_id
        where c.lead_id = ${leadId}
          ${r.customer_id ? sql`or (c.customer_id = ${r.customer_id} and c.created_at >= ${created})` : sql``}
        order by c.created_at desc limit 1`),
      r.customer_id
        ? execRows<{
            channel: string;
            at: Date | string;
            by_name: string | null;
          }>(sql`
            select m.channel, m.created_at as at, u.name as by_name
            from messages m left join users u on u.id = coalesce(m.sent_by_user_id, m.user_id)
            where m.direction = 'out' and coalesce(m.sent_by_user_id, m.user_id) is not null
              and (m.template_key is null or m.template_key not in (${sql.join(
                AUTOMATED_TEMPLATES.map((k) => sql`${k}`),
                sql`, `,
              )}))
              and (m.lead_id = ${leadId} or (m.customer_id = ${r.customer_id} and m.created_at >= ${created}))
            order by m.created_at desc limit 1`)
        : Promise.resolve([]),
      leadPhotos(viewer, leadId, r.customer_id),
    ]);
    const call = lastCall[0];
    const msg = lastMsg[0];
    const callAt = call ? new Date(call.at).getTime() : 0;
    const msgAt = msg ? new Date(msg.at).getTime() : 0;
    const lastContact: LeadCardData["lastContact"] =
      call && callAt >= msgAt
        ? {
            channel: "call",
            outcome: call.outcome,
            at: iso(call.at) as string,
            byName: call.by_name,
          }
        : msg
          ? {
              channel: msg.channel === "email" ? "email" : "text",
              outcome: null,
              at: iso(msg.at) as string,
              byName: msg.by_name,
            }
          : null;
    const a = r.address;
    const address = a?.street
      ? {
          street: a.street,
          unit: a.unit ?? null,
          city: a.city ?? "",
          state: a.state ?? "",
          zip: a.zip ?? "",
        }
      : r.p_street
        ? {
            street: r.p_street,
            unit: r.p_unit,
            city: r.p_city ?? "",
            state: r.p_state ?? "",
            zip: r.p_zip ?? "",
          }
        : null;
    const addressText = address
      ? `${address.street}${address.unit ? ` ${address.unit}` : ""}, ${[
          address.city,
          [address.state, address.zip].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")}`
      : (r.address_text ?? null);
    const status = r.status as LeadStatus;
    const answered = !!r.first_response_at;
    const reopen = reopenRule({ status, jobStatus: r.job_status });
    const prev = isOpenStatus(status)
      ? null
      : previousOpenStatus(history, status, answered);
    const b = r.booking ?? {};
    const priority = ["normal", "urgent", "emergency"].includes(
      String(b.priority),
    )
      ? (b.priority as LeadPriority)
      : null;
    return {
      ...box,
      kind: box.kind ?? (isJobKind(b.kind) ? b.kind : null),
      address,
      addressText,
      notes: r.notes_full,
      serviceTypeId: r.service_type_id,
      sourceId: r.lead_source_id,
      preferredDate: r.preferred_date,
      preferredWindow: r.preferred_window,
      priority,
      afterHours: b.after_hours === true,
      createdAt: iso(r.created_at) as string,
      respondedByName: r.responder_name,
      lastContact,
      photos,
      spamReason: r.spam_reason,
      estimate: r.converted_estimate_id
        ? { id: r.converted_estimate_id, number: r.estimate_number }
        : null,
      smsConsent: r.sms_consent,
      reopen: reopen
        ? reopen.ok
          ? { ok: true, to: prev ?? "contacted" }
          : reopen
        : null,
      previousStatus: prev,
    };
  },
);

/**
 * Up to 6 photos for the card: ones filed on the lead, then (a returning
 * customer) their latest job photos. Signed 10-minute URLs.
 */
async function leadPhotos(
  viewer: SessionUser,
  leadId: string,
  customerId: string | null,
): Promise<LeadCardData["photos"]> {
  const withCustomer = !!customerId && viewer.perms.has("customers.view");
  const rows = await execRows<{ id: string }>(sql`
    select m.id from media m
    where m.kind = 'photo' and m.deleted_at is null
      and ((m.entity_type = 'lead' and m.entity_id = ${leadId})
        ${withCustomer ? sql`or (m.customer_id = ${customerId} and m.tag in ('before','during','after','problem','other'))` : sql``})
    order by (m.entity_type = 'lead') desc, m.server_received_at desc
    limit 6`).catch(() => []);
  if (rows.length === 0) return [];
  const { getMediaUrls } = await import("@/features/media/api");
  const ids = rows.map((x) => x.id);
  const [full, thumb] = await Promise.all([
    getMediaUrls(ids, "full"),
    getMediaUrls(ids, "thumb"),
  ]);
  return ids
    .filter((id) => full[id])
    .map((id) => ({
      id,
      url: full[id] as string,
      thumbUrl: thumb[id] ?? (full[id] as string),
    }));
}

/** Open leads for a phone number (contract 3.2: repeat callers), newest first. */
export async function openLeadsForPhone(
  e164: string,
  opts: { customerIds?: string[]; limit?: number } = {},
): Promise<CallerOpenLead[]> {
  const ids = opts.customerIds ?? [];
  const rows = await execRows<{
    id: string;
    status: string;
    service: string | null;
    created_at: Date | string;
    street: string | null;
    city: string | null;
  }>(sql`
    select l.id, l.status, coalesce(st.name, l.service_text) as service, l.created_at,
      coalesce(nullif(l.address->>'street', ''), p.street) as street,
      coalesce(nullif(l.address->>'city', ''), p.city) as city
    from leads l
    left join service_types st on st.id = l.service_type_id
    left join properties p on p.id = l.property_id
    where l.status in ('new','contacted','qualified')
      and (l.phone = ${e164}${
        ids.length
          ? sql` or l.customer_id in (${sql.join(
              ids.map((x) => sql`${x}`),
              sql`, `,
            )})`
          : sql``
      })
    order by l.created_at desc
    limit ${opts.limit ?? 3}`);
  return rows.map((x) => ({
    id: x.id,
    service: x.service,
    status: x.status as LeadStatus,
    createdAt: iso(x.created_at) as string,
    address: x.street ? [x.street, x.city].filter(Boolean).join(", ") : null,
  }));
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
