// Demo seed fragment for `leads` (BUILD_PLAN §10.3 #6). Owner: B1.
// Lead sources (+ deterministic demo keys), 2 months of source_spend, 25 leads with
// lead_events (received / touch / call_attempt / status), calls, one API key and the
// L15 `lead_retry` task via B2 createTask. Open walk-in leads get what intake gives
// them (a customer and a geocoded property), so the lead map shows them. Never
// emits events; reruns are no-ops.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import {
  apiKeys,
  calls,
  customers,
  leadEvents,
  leadSources,
  leads,
  properties,
  sourceSpend,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoProfile } from "@/db/seed/profiles/types";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createTask } from "@/features/tasks/api";
import { sha256Hex } from "@/lib/hash";
import { addDaysToKey, dateKey } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { hashKey } from "./keys";
import { settingsShape } from "./settings";

/** Demo-only secrets (documented in the leads README) so curl examples work out of the box. */
export const DEMO_LEAD_KEYS = {
  websitePk: "pk_demo_website0001",
  referralSk: "sk_demo_referral_0000000000000001",
  thumbtackHook: "hk_demo_thumbtack_000000000000001",
  lsaHook: "hk_demo_google_lsa_00000000000001",
  zapierKey: "sk_demo_zapier_00000000000000001",
} as const;

const OPEN_STATUSES = new Set(["new", "contacted", "qualified"]);

/**
 * Where a walk-in lead's address sits on the map: its ZIP area's center (the
 * profile's metro) plus a small fixed offset by lead number (0.004–0.012°, a
 * golden-angle turn each), else a fixed spot inside the metro box. Deterministic.
 */
export function walkInSpot(
  metro: Pick<DemoProfile["metro"], "zips" | "box">,
  zip: string,
  n: number,
): { lat: number; lng: number } {
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const area = metro.zips.find((z) => z.zip === zip);
  if (area?.lat != null && area.lng != null) {
    const turn = (n * 137.508 * Math.PI) / 180;
    const r = 0.004 + ((n * 7) % 9) * 0.001;
    return {
      lat: r6(area.lat + r * Math.sin(turn)),
      lng: r6(
        area.lng + (r * Math.cos(turn)) / Math.cos((area.lat * Math.PI) / 180),
      ),
    };
  }
  const b = metro.box;
  return {
    lat: r6(b.lat + (0.15 + 0.7 * ((n * 0.618034) % 1)) * b.span),
    lng: r6(b.lng + (0.15 + 0.7 * ((n * 0.381966 + 0.25) % 1)) * b.span),
  };
}

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  const office = seedId("user", "office");
  const admin = seedId("user", "admin");
  const tz = ctx.tz;
  const src = new Map(plan.leadSources.map((s) => [s.key, s]));
  // Walk-in addresses, the out-of-area lead and web attribution come from the profile.
  const copy = ctx.profile.leads;
  const ADDRESSES = copy.addresses;

  // ---- sources
  await db
    .insert(leadSources)
    .values(
      plan.leadSources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        preset:
          s.key === "thumbtack"
            ? "thumbtack"
            : s.key === "google_lsa"
              ? "zapier"
              : "generic",
        integrationKind: s.integrationKind,
        publicKey: s.publicKey,
        secretHash:
          s.key === "referral" ? hashKey(DEMO_LEAD_KEYS.referralSk) : null,
        hookSecretHash:
          s.key === "thumbtack"
            ? hashKey(DEMO_LEAD_KEYS.thumbtackHook)
            : s.key === "google_lsa"
              ? hashKey(DEMO_LEAD_KEYS.lsaHook)
              : null,
        allowedOrigins: [],
        requireTs:
          s.integrationKind === "js_snippet" ||
          s.integrationKind === "hosted_form",
        costModel: s.costModel,
        defaultCostCents: s.defaultCostCents,
        createdAt: new Date(ctx.now.getTime() - 400 * 86_400_000),
        updatedAt: new Date(ctx.now.getTime() - 400 * 86_400_000),
      })),
    )
    .onConflictDoNothing();

  // ---- monthly spend: this month and last month
  const thisMonth = `${dateKey(ctx.now, tz).slice(0, 7)}-01`;
  const lastMonth = `${addDaysToKey(thisMonth, -1).slice(0, 7)}-01`;
  const spend = plan.leadSources.flatMap((s) =>
    s.monthlySpendCents
      ? [
          {
            leadSourceId: s.id,
            month: lastMonth,
            amountCents: s.monthlySpendCents,
            notes: "Demo",
          },
          {
            leadSourceId: s.id,
            month: thisMonth,
            amountCents: Math.round(s.monthlySpendCents * 0.6),
            notes: "Month to date",
          },
        ]
      : [],
  );
  if (spend.length)
    await db.insert(sourceSpend).values(spend).onConflictDoNothing();

  // ---- one server API key (Zapier)
  await db
    .insert(apiKeys)
    .values({
      id: seedId("api_key", "zapier"),
      name: "Zapier",
      prefix: DEMO_LEAD_KEYS.zapierKey.slice(0, 12),
      keyHash: hashKey(DEMO_LEAD_KEYS.zapierKey),
      scopes: ["leads:write"],
      createdBy: admin,
      createdAt: new Date(ctx.now.getTime() - 30 * 86_400_000),
      lastUsedAt: new Date(ctx.now.getTime() - 2 * 86_400_000),
    })
    .onConflictDoNothing();

  // ---- walk-in leads get what intake gives them (processLead step 7): open,
  // unflagged ones with a phone or email get a customer and a property at their
  // address, placed from the profile's area centers, so the lead map shows them.
  // Flagged, spam and closed walk-ins stay without one, as intake leaves them.
  const threshold = settingsShape.leads.parse(undefined).spam_review_threshold;
  const walkIns = new Map<number, { customerId: string; propertyId: string }>();
  const walkInCustomers: (typeof customers.$inferInsert)[] = [];
  const walkInProperties: (typeof properties.$inferInsert)[] = [];
  for (const l of plan.leads) {
    if (
      l.customerN ||
      !OPEN_STATUSES.has(l.status) ||
      l.spamScore >= threshold ||
      (!l.phone && !l.email)
    )
      continue;
    const a = ADDRESSES[l.n % ADDRESSES.length] as (typeof ADDRESSES)[number];
    const s = src.get(l.sourceKey);
    const at = new Date(ctx.now.getTime() - l.minutesAgo * 60_000);
    const ids = {
      customerId: seedId("customer", `lead-${l.n}`),
      propertyId: seedId("property", `lead-${l.n}`),
    };
    const [first, ...rest] = l.name.trim().split(/\s+/);
    walkInCustomers.push({
      id: ids.customerId,
      type: "residential",
      firstName: first ?? null,
      lastName: rest.join(" ") || null,
      displayName: l.name,
      phone: l.phone,
      email: l.email,
      preferredChannel: l.phone ? "sms" : "email",
      leadSourceId: s?.id ?? null,
      source: s?.name ?? null,
      createdBy: office,
      createdAt: at,
      updatedAt: at,
    });
    walkInProperties.push({
      id: ids.propertyId,
      customerId: ids.customerId,
      street: a.street,
      city: a.city,
      state: plan.company.state,
      zip: a.zip,
      ...walkInSpot(ctx.profile.metro, a.zip, l.n),
      geocodeStatus: "ok",
      timezone: tz,
      propertyType: "house",
      isPrimary: true,
      createdAt: at,
      updatedAt: at,
    });
    walkIns.set(l.n, ids);
  }
  if (walkInCustomers.length)
    await db.insert(customers).values(walkInCustomers).onConflictDoNothing();
  if (walkInProperties.length)
    await db.insert(properties).values(walkInProperties).onConflictDoNothing();

  // ---- leads
  const leadRows: (typeof leads.$inferInsert)[] = [];
  const eventRows: (typeof leadEvents.$inferInsert)[] = [];
  const callRows: (typeof calls.$inferInsert)[] = [];
  for (const l of plan.leads) {
    const s = src.get(l.sourceKey);
    const c = l.customerN ? plan.customers[l.customerN - 1] : undefined;
    const job = l.jobN ? plan.jobs[l.jobN - 1] : undefined;
    // Booked leads came in a couple of days before their job; others per the plan.
    const createdAt = job
      ? job.dayOffset != null
        ? ctx.at(Math.min(job.dayOffset - 2, -1), "10:15")
        : new Date(ctx.now.getTime() - (3 + l.n) * 86_400_000)
      : new Date(ctx.now.getTime() - l.minutesAgo * 60_000);
    const prop = job
      ? c?.properties.find((p) => p.id === job.propertyId)
      : c?.properties[0];
    const i = l.n % ADDRESSES.length;
    const walkIn = ADDRESSES[i] as (typeof ADDRESSES)[number];
    const address = prop
      ? {
          street: prop.street,
          city: prop.city,
          state: prop.state,
          zip: prop.zip,
        }
      : l.n === 23
        ? { ...copy.outOfArea }
        : {
            street: walkIn.street,
            city: walkIn.city,
            state: plan.company.state,
            zip: walkIn.zip,
          };
    const hasCustomer = !!c && l.status !== "spam";
    const responded =
      l.firstResponseMinutes != null
        ? new Date(createdAt.getTime() + l.firstResponseMinutes * 60_000)
        : null;
    const spamReason =
      l.n === 24 ? "honeypot" : l.n === 13 ? "many_urls,gibberish_name" : null;
    const attribution =
      l.sourceKey === "website"
        ? {
            utm_source: l.n % 2 ? "google" : "facebook",
            utm_medium: l.n % 2 ? "cpc" : "social",
            utm_campaign: copy.campaign,
            ...(l.n % 2 ? { gclid: `Cj0KCQ-demo-${l.n}` } : {}),
            landing_url: copy.landingUrl,
            page_url: copy.pageUrl,
          }
        : {};
    leadRows.push({
      id: l.id,
      leadSourceId: s?.id ?? null,
      externalId: l.sourceKey === "thumbtack" ? `tt-demo-${l.n}` : null,
      status: l.status,
      customerId: hasCustomer
        ? (c?.id ?? null)
        : (walkIns.get(l.n)?.customerId ?? null),
      propertyId: hasCustomer
        ? (prop?.id ?? null)
        : (walkIns.get(l.n)?.propertyId ?? null),
      name: l.n === 13 ? "xkcdqw zzptrv" : l.name,
      phone: l.phone,
      email: l.email,
      address,
      serviceText: l.service,
      quotedPriceCents: l.quotedPriceCents,
      preferredDate:
        l.status === "new" ||
        l.status === "contacted" ||
        l.status === "qualified"
          ? dateKey(
              new Date(ctx.now.getTime() + ((l.n % 4) + 1) * 86_400_000),
              tz,
            )
          : null,
      preferredWindow:
        l.n % 3 === 0 ? "morning" : l.n % 3 === 1 ? "afternoon" : null,
      notes:
        l.n === 13
          ? "Best deals http://spam.example http://x.example http://y.example"
          : l.n === 24
            ? "buy now"
            : `${l.service} — ${l.n % 2 ? "please call when you can" : "need it soon"}.`,
      attribution,
      extra: {},
      sourceCostCents: s?.costModel === "per_lead" ? s.defaultCostCents : null,
      smsConsent: l.smsConsent,
      marketingConsent: l.smsConsent && l.n % 4 === 0,
      spamScore: l.spamScore,
      spamReason,
      isReturning: l.isReturning,
      assignedUserId:
        l.status === "new" ? (l.n === 12 ? office : null) : office,
      firstResponseAt: responded,
      firstResponseBy: responded ? office : null,
      lostReason: l.lostReason,
      convertedJobId: job?.id ?? null,
      dedupeHash: sha256Hex(`${l.phone}|${l.service.toLowerCase()}`),
      createdAt,
      updatedAt: responded ?? createdAt,
    });
    eventRows.push({
      id: seedId("lead_event", `${l.n}-received`),
      leadId: l.id,
      leadSourceId: s?.id ?? null,
      kind: l.status === "spam" ? "spam" : "received",
      outcome: l.status === "spam" ? "honeypot" : null,
      raw: {
        name: l.name,
        phone: l.phone,
        email: l.email,
        service_type: l.service,
        ...(l.n === 24
          ? { company_website: "http://cheap-pills.example" }
          : {}),
        ...attribution,
      },
      ip: `203.0.113.${l.n}`,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      createdAt,
    });
    if (l.isReturning)
      eventRows.push({
        id: seedId("lead_event", `${l.n}-touch`),
        leadId: l.id,
        leadSourceId: s?.id ?? null,
        kind: "touch",
        raw: { reason: "returning", payload: { name: l.name, phone: l.phone } },
        createdAt: new Date(createdAt.getTime() + 20 * 60_000),
      });
    if (responded) {
      const outcome =
        l.n === 15 || l.lostReason === "no_answer" ? "no_answer" : "connected";
      callRows.push({
        id: seedId("call", `lead-${l.n}`),
        customerId: hasCustomer
          ? (c?.id ?? null)
          : (walkIns.get(l.n)?.customerId ?? null),
        leadId: l.id,
        userId: office,
        direction: "out",
        outcome,
        notes:
          outcome === "no_answer"
            ? "Went to voicemail, no message left."
            : null,
        createdAt: responded,
      });
      eventRows.push({
        id: seedId("lead_event", `${l.n}-call`),
        leadId: l.id,
        kind: "call_attempt",
        outcome,
        actorUserId: office,
        createdAt: responded,
      });
    }
    if (l.status !== "new" && l.status !== "spam")
      eventRows.push({
        id: seedId("lead_event", `${l.n}-status`),
        leadId: l.id,
        kind: "status",
        outcome: l.status,
        actorUserId: office,
        raw: { from: "new", to: l.status, lost_reason: l.lostReason },
        createdAt: new Date((responded ?? createdAt).getTime() + 60_000),
      });
  }
  await db.insert(leads).values(leadRows).onConflictDoNothing();
  await db.insert(leadEvents).values(eventRows).onConflictDoNothing();
  if (callRows.length)
    await db.insert(calls).values(callRows).onConflictDoNothing();

  // ---- L15: no-answer call → call-back task (B2 createTask, stub level F)
  const l15 = plan.leads[14];
  if (l15) {
    const actor: Actor = { kind: "user", userId: office };
    const exists = await db
      .select({ id: leadEvents.id })
      .from(leadEvents)
      .where(eq(leadEvents.id, seedId("lead_event", "15-task")))
      .limit(1);
    if (exists.length === 0) {
      await createTask(
        db,
        {
          kind: "lead_retry",
          title: `Call ${l15.name} back`,
          body: "No answer on the first call. Try again and leave a voicemail.",
          payload: { lead_id: l15.id },
          assigneeUserId: office,
          entity: { type: "lead", id: l15.id },
          customerId: walkIns.get(15)?.customerId ?? null,
          dueAt: new Date(ctx.now.getTime() + 10 * 60_000),
        },
        actor,
        { quiet: true },
      );
      await db
        .insert(leadEvents)
        .values({
          id: seedId("lead_event", "15-task"),
          leadId: l15.id,
          kind: "note",
          outcome: "lead_retry",
          raw: { task: "lead_retry" },
        })
        .onConflictDoNothing();
    }
  }
  ctx.log(
    `${leadRows.length} leads (${walkIns.size} walk-ins with a customer and a map spot), ${eventRows.length} lead events, ${callRows.length} calls`,
  );
}
