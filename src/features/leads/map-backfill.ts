import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import { leadEvents, leads } from "@/db/schema";
import { ensureProperty, findOrCreateCustomer } from "@/features/customers/api";
import { getSettings } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/types";
import { recordLeadConsent } from "./intake/process";
import { requeueGeocode } from "./map-geocode";

// Lead map backfill (item 10, the `leads.map_backfill` cron hook): open leads that
// have an address but no property get one, the way intake does it (processLead
// step 7: the customer found or created by phone or email, the property matched or
// added, which queues its geocode job), so leads saved before intake did that, or
// by a path that skipped it, still reach the map. Lead properties still waiting for
// a position get one more geocode try a day. Small batches; one transaction per
// lead; geocoding itself stays in the throttled `geocode` worker.

const BATCH = 25;

type BackfillRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  customer_id: string | null;
  lead_source_id: string | null;
  source_name: string | null;
  address: {
    street: string;
    unit?: string;
    city?: string;
    state?: string;
    zip: string;
  };
  attribution: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  is_test: boolean;
  is_returning: boolean;
  sms_consent: boolean;
  marketing_consent: boolean;
};

export interface MapBackfillResult {
  /** Leads that got a property now. */
  linked: number;
  /** Customers created for them (a lead without one). */
  customers: number;
  /** Geocode jobs queued again for lead properties still without a position. */
  requeued: number;
}

/** One pass: link up to `limit` leads, then re-queue stuck geocodes. */
export async function runMapBackfill(
  now: Date = new Date(),
  limit = BATCH,
): Promise<MapBackfillResult> {
  const out: MapBackfillResult = { linked: 0, customers: 0, requeued: 0 };
  const threshold = (await getSettings()).leads.spam_review_threshold;
  // Open inbox leads ("Check" waits for its review, as at intake) with a street
  // and a ZIP, no property yet, and a way to find or make their customer.
  const rows = await execRows<BackfillRow>(sql`
    select l.id, l.name, l.phone, l.email, l.customer_id, l.lead_source_id,
      s.name as source_name, l.address, l.attribution, l.extra, l.is_test,
      l.is_returning, l.sms_consent, l.marketing_consent
    from leads l
    left join lead_sources s on s.id = l.lead_source_id
    left join customers c on c.id = l.customer_id
    where l.status in ('new', 'contacted', 'qualified')
      and l.spam_score < ${threshold}
      and l.property_id is null
      and nullif(trim(l.address->>'street'), '') is not null
      and nullif(trim(l.address->>'zip'), '') is not null
      and (l.customer_id is not null or l.phone is not null or l.email is not null)
      and (l.customer_id is null
        or (c.deleted_at is null and c.anonymized_at is null))
    order by l.created_at desc, l.id
    limit ${limit}`);
  for (const r of rows) {
    try {
      const created = await db.transaction((tx) => linkLead(tx, r));
      out.linked += 1;
      if (created) out.customers += 1;
    } catch (err) {
      console.error(`[leads.map_backfill] lead ${r.id}:`, err);
    }
  }
  // Lead properties that never got a position (no geocoder back then, or the job
  // ran out of tries): one more geocode job, at most once a day each.
  const stuck = await execRows<{ id: string }>(sql`
    select distinct p.id
    from leads l
    join properties p on p.id = l.property_id
    where l.status in ('new', 'contacted', 'qualified')
      and l.spam_score < ${threshold}
      and p.deleted_at is null and p.lat is null and p.geocode_status = 'pending'
      and not exists (select 1 from job_queue q
        where q.kind = 'geocode' and q.status in ('queued', 'running')
          and q.payload->>'propertyId' = p.id::text)
    limit ${limit}`);
  for (const p of stuck)
    if (await requeueGeocode(db, p.id, now)) out.requeued += 1;
  return out;
}

/** Give one lead its property (and its customer when it has none). */
async function linkLead(tx: Tx, r: BackfillRow): Promise<boolean> {
  const a = r.address;
  const address = {
    street: a.street.trim(),
    unit: a.unit?.trim() || null,
    city: a.city?.trim() ?? "",
    state: a.state?.trim() ?? "",
    zip: a.zip.trim(),
  };
  if (r.customer_id) {
    const p = await ensureProperty(tx, r.customer_id, address, SYSTEM_ACTOR);
    await tx
      .update(leads)
      .set({ propertyId: p.propertyId, updatedAt: new Date() })
      .where(and(eq(leads.id, r.id), isNull(leads.propertyId)));
    if (!p.created) await requeueGeocode(tx, p.propertyId);
    return false;
  }
  const fc = await findOrCreateCustomer(
    tx,
    {
      displayName: r.name,
      phone: r.phone,
      email: r.email,
      address,
      leadSourceId: r.lead_source_id,
      source: r.source_name,
      firstTouch:
        (r.attribution?.first_touch as Record<string, unknown>) ??
        (Object.keys(r.attribution ?? {}).length ? r.attribution : null),
      isTest: r.is_test,
    },
    SYSTEM_ACTOR,
  );
  await tx
    .update(leads)
    .set({
      customerId: fc.customerId,
      propertyId: fc.propertyId,
      isReturning: r.is_returning || !fc.created,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, r.id), isNull(leads.customerId)));
  if (fc.propertyId && !fc.propertyCreated)
    await requeueGeocode(tx, fc.propertyId);
  if (r.sms_consent || r.marketing_consent) {
    // The consent evidence is the original submission's (its IP and browser),
    // as when someone clears a lead later.
    const [ev] = await tx
      .select({ ip: leadEvents.ip, userAgent: leadEvents.userAgent })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.leadId, r.id),
          sql`${leadEvents.kind} in ('received', 'spam')`,
        ),
      )
      .orderBy(leadEvents.createdAt)
      .limit(1);
    await recordLeadConsent(tx, {
      customerId: fc.customerId,
      phone: r.phone,
      email: r.email,
      sms: r.sms_consent,
      marketing: r.marketing_consent,
      textShown: (r.extra?._consent_text as string) ?? null,
      pageUrl:
        ((r.attribution?.page_url ?? r.attribution?.landing_url) as
          | string
          | undefined) ?? null,
      ip: ev?.ip ?? null,
      userAgent: ev?.userAgent ?? null,
      source: "web_form",
      actor: SYSTEM_ACTOR,
    });
  }
  return fc.created;
}
