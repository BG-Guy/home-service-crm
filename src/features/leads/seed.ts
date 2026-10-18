// Demo seed fragment for `leads` (BUILD_PLAN §10.3 #6). Owner: B1.
// Lead sources (+ deterministic demo keys), 2 months of source_spend, 25 leads with
// lead_events (received / touch / call_attempt / status), calls, one API key and the
// L15 `lead_retry` task via B2 createTask. Never emits events; reruns are no-ops.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import {
  apiKeys,
  calls,
  leadEvents,
  leadSources,
  leads,
  sourceSpend,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createTask } from "@/features/tasks/api";
import { sha256Hex } from "@/lib/hash";
import { addDaysToKey, dateKey } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { hashKey } from "./keys";

/** Demo-only secrets (documented in the leads README) so curl examples work out of the box. */
export const DEMO_LEAD_KEYS = {
  websitePk: "pk_demo_website0001",
  referralSk: "sk_demo_referral_0000000000000001",
  thumbtackHook: "hk_demo_thumbtack_000000000000001",
  lsaHook: "hk_demo_google_lsa_00000000000001",
  zapierKey: "sk_demo_zapier_00000000000000001",
} as const;

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
      customerId: hasCustomer ? (c?.id ?? null) : null,
      propertyId: hasCustomer ? (prop?.id ?? null) : null,
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
        customerId: hasCustomer ? (c?.id ?? null) : null,
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
          customerId: null,
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
    `${leadRows.length} leads, ${eventRows.length} lead events, ${callRows.length} calls`,
  );
}
