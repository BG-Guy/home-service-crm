import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import { normalizePhone } from "@/lib/phone";
import type { SessionUser } from "@/lib/types";
import type { SearchHit } from "./contracts";
import { maskEmail, maskPhone } from "./normalize";

// Global search (BUILD_PLAN §4, §6.1) for the shell ⌘K and list search fields. Owner: B1.
// One round trip: a UNION of small, index-friendly lookups (prefix LIKE on
// lower(display_name) uses customers_name_idx; E.164 equality uses the phone indexes),
// each capped, then ranked. Row-scoped: techs only see customers/jobs/invoices of jobs
// they are assigned to (or customers they created).

export type { SearchHit } from "./contracts";

export interface SearchQuery {
  /** Lower-cased trimmed text. */
  text: string;
  /** LIKE-escaped lower-case text. */
  like: string;
  /** Digits only (≥ 3) or null. */
  digits: string | null;
  /** E.164 when the query parses as a phone number. */
  e164: string | null;
  /** A document number fragment like "1042" or "j-1042". */
  number: string | null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Parse a search string (pure apart from libphonenumber). */
export function parseSearchQuery(q: string): SearchQuery | null {
  const text = q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
  if (text.length < 2) return null;
  const digitsOnly = text.replace(/\D/g, "");
  const looksPhone = /^[+\d\s().-]+$/.test(text) && digitsOnly.length >= 7;
  const e164 = looksPhone ? normalizePhone(text) : null;
  const numM = /^(?:[a-z]{1,4}-?)?(\d{2,})$/.exec(text.replace(/\s/g, ""));
  return {
    text,
    like: escapeLike(text),
    digits: digitsOnly.length >= 3 ? digitsOnly : null,
    e164,
    number: numM ? (numM[1] as string) : null,
  };
}

type Row = {
  type: SearchHit["type"];
  id: string;
  title: string;
  subtitle: string | null;
  rank: number;
};

/** Matches name/phone (any format → E.164)/email/address/job #/invoice #; row-scoped for techs. */
export async function globalSearch(
  q: string,
  viewer: SessionUser,
  limit = 20,
): Promise<SearchHit[]> {
  const sq = parseSearchQuery(q);
  if (!sq) return [];
  const perms = viewer.perms;
  const seeAllCustomers = perms.has("customers.view_all");
  const seeAllJobs = perms.has("jobs.view_all");
  const revealContact = perms.has("customers.contact_view");
  const per = Math.max(5, Math.min(limit, 25));
  const prefix = `${sq.like}%`;
  const word = `% ${sq.like}%`;
  const contains = `%${sq.like}%`;
  const parts = [];

  const customerScope = seeAllCustomers
    ? sql`true`
    : sql`(c.created_by = ${viewer.id} or exists (
        select 1 from jobs j join job_assignments a on a.job_id = j.id
        where j.customer_id = c.id and a.user_id = ${viewer.id}))`;
  const jobScope = seeAllJobs
    ? sql`true`
    : sql`exists (select 1 from job_assignments a where a.job_id = j.id and a.user_id = ${viewer.id})`;

  if (perms.has("customers.view")) {
    const conds = [
      sql`lower(c.display_name) like ${prefix}`,
      sql`lower(c.display_name) like ${word}`,
      sql`lower(coalesce(c.company_name, '')) like ${prefix}`,
    ];
    if (sq.text.includes("@") || /^[a-z0-9._-]+$/.test(sq.text))
      conds.push(sql`c.email like ${prefix}`);
    if (sq.e164)
      conds.push(sql`c.phone = ${sq.e164}`, sql`c.phone_alt = ${sq.e164}`);
    else if (sq.digits && sq.digits.length >= 4)
      conds.push(sql`c.phone like ${`%${sq.digits}%`}`);
    parts.push(sql`(
      select 'customer' as type, c.id::text as id, c.display_name as title,
        coalesce(c.phone, c.email, '') as subtitle,
        case when lower(c.display_name) like ${prefix} then 0
             when ${sq.e164 ?? ""} <> '' and c.phone = ${sq.e164 ?? ""} then 0 else 1 end as rank
      from customers c
      where c.deleted_at is null and c.merged_into_id is null
        and (${sql.join(conds, sql` or `)}) and ${customerScope}
      order by rank, c.display_name limit ${per})`);
    // Address matches (street prefix or contains for multi-word queries).
    if (sq.text.length >= 3 && !sq.e164) {
      parts.push(sql`(
        select 'customer' as type, c.id::text as id, c.display_name as title,
          ${
            revealContact
              ? sql`(p.street || coalesce(' ' || p.unit, '') || ', ' || p.city)`
              : sql`(p.city || ', ' || p.state || ' ' || p.zip)`
          } as subtitle, 2 as rank
        from properties p join customers c on c.id = p.customer_id
        where p.deleted_at is null and c.deleted_at is null and c.merged_into_id is null
          and (lower(p.street) like ${prefix} or lower(p.street) like ${contains} or p.zip = ${sq.text})
          and ${customerScope}
        limit ${per})`);
    }
  }

  if (perms.has("jobs.view_own") || seeAllJobs) {
    const conds = [sql`lower(j.title) like ${prefix}`];
    if (sq.number) conds.push(sql`j.number ilike ${`%${sq.number}%`}`);
    parts.push(sql`(
      select 'job' as type, j.id::text as id, j.number || ' · ' || j.title as title,
        c.display_name || ' · ' || replace(j.status, '_', ' ') as subtitle,
        case when ${sq.number ?? ""} <> '' and j.number ilike ${`%${sq.number ?? "~"}`} then 0 else 3 end as rank
      from jobs j join customers c on c.id = j.customer_id
      where (${sql.join(conds, sql` or `)}) and ${jobScope}
      order by j.created_at desc limit ${per})`);
  }

  if (perms.has("invoices.view") && sq.number) {
    parts.push(sql`(
      select 'invoice' as type, i.id::text as id, i.number as title,
        c.display_name || ' · ' || replace(i.status, '_', ' ') as subtitle, 0 as rank
      from invoices i join customers c on c.id = i.customer_id
      left join jobs j on j.id = i.job_id
      where i.number ilike ${`%${sq.number}%`}
        and (${seeAllJobs ? sql`true` : sql`(j.id is not null and ${jobScope})`})
      order by i.created_at desc limit ${per})`);
  }

  if (perms.has("estimates.view") && sq.number) {
    parts.push(sql`(
      select 'estimate' as type, e.id::text as id, e.number as title,
        c.display_name || ' · ' || e.status as subtitle, 1 as rank
      from estimates e join customers c on c.id = e.customer_id
      left join jobs j on j.id = e.job_id
      where e.number ilike ${`%${sq.number}%`}
        and (${seeAllJobs ? sql`true` : sql`(j.id is not null and ${jobScope})`})
      order by e.created_at desc limit ${per})`);
  }

  if (perms.has("leads.view")) {
    const conds = [sql`lower(coalesce(l.name, '')) like ${prefix}`];
    if (sq.e164) conds.push(sql`l.phone = ${sq.e164}`);
    if (sq.text.includes("@")) conds.push(sql`l.email like ${prefix}`);
    parts.push(sql`(
      select 'lead' as type, l.id::text as id, coalesce(l.name, 'Lead') as title,
        coalesce(l.service_text, '') || ' · ' || l.status as subtitle, 4 as rank
      from leads l
      where l.status not in ('spam', 'booked') and (${sql.join(conds, sql` or `)})
      order by l.created_at desc limit ${per})`);
  }

  if (parts.length === 0) return [];
  const rows = await execRows<Row>(
    sql`select * from (${sql.join(parts, sql` union all `)}) s order by rank limit ${limit * 2}`,
  );
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let subtitle = r.subtitle ?? "";
    if (r.type === "customer" && !revealContact && subtitle.startsWith("+"))
      subtitle = maskPhone(subtitle) ?? "";
    if (r.type === "customer" && !revealContact && subtitle.includes("@"))
      subtitle = maskEmail(subtitle) ?? "";
    if (r.type === "customer" && subtitle.startsWith("+"))
      subtitle = formatUsPhone(subtitle);
    hits.push({
      type: r.type,
      id: r.id,
      title: r.title,
      subtitle,
      href: hrefFor(r.type, r.id),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function hrefFor(type: SearchHit["type"], id: string): string {
  switch (type) {
    case "customer":
      return `/customers/${id}`;
    case "job":
      return `/jobs/${id}`;
    case "invoice":
      return `/invoices/${id}`;
    case "estimate":
      return `/estimates/${id}`;
    case "lead":
      return `/leads/${id}`;
  }
}

/** "+15125550100" → "(512) 555-0100" (NANP only; other numbers unchanged). */
export function formatUsPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
