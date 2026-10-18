// Demo seed fragment for `customers` (BUILD_PLAN §10.3 #5). Owner: B1.
// Writes customers + properties from DEMO (deterministic ids, preset lat/lng in the profile's metro),
// a few access notes / encrypted gate codes, and notes via B2 addNote (5 customers).
// Never emits events; reruns are no-ops (onConflictDoNothing).
import type { DB } from "@/db";
import { customers, properties } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { addNote } from "@/features/jobs/api";
import { encrypt } from "@/lib/crypto";
import type { Actor } from "@/lib/types";

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  // Access notes, gate codes and customer notes come from the trade profile.
  const ACCESS = ctx.profile.customers.access;
  const NOTES = ctx.profile.customers.notes;
  const office = seedId("user", "office");
  const sourceName = new Map(plan.leadSources.map((s) => [s.key, s.name]));
  const custRows: (typeof customers.$inferInsert)[] = [];
  const propRows: (typeof properties.$inferInsert)[] = [];
  for (const c of plan.customers) {
    // Oldest customers ~14 months back, newest a week ago (jobs start at −60 d).
    const createdAt = new Date(
      ctx.now.getTime() - (430 - c.n * 9) * 86_400_000,
    );
    custRows.push({
      id: c.id,
      type: c.type,
      firstName: c.firstName,
      lastName: c.lastName,
      displayName: c.displayName,
      companyName: c.companyName,
      phone: c.phone,
      email: c.email,
      preferredChannel: c.flags.doNotText ? "call" : "sms",
      smsStatus: c.flags.optedOut ? "opted_out" : "unknown",
      vip: c.flags.vip,
      prepayRequired: c.flags.prepayRequired,
      taxExempt: c.flags.taxExempt,
      doNotText: c.flags.doNotText,
      // C7's dispute (seeded by B4) — set here so the disputes fragment emits no event.
      disputeHistory: c.flags.disputeHistory,
      leadSourceId: seedId("lead_source", c.sourceKey),
      source: sourceName.get(c.sourceKey as never) ?? c.sourceKey,
      firstTouch:
        c.sourceKey === "website"
          ? {
              utm_source: "google",
              utm_medium: "organic",
              landing_url: ctx.profile.customers.landingUrl,
              at: createdAt.toISOString(),
            }
          : null,
      custom: c.terms === "net_30" ? { payment_terms: "net_30" } : {},
      createdBy: office,
      createdAt,
      updatedAt: createdAt,
    });
    c.properties.forEach((p, i) => {
      const a = ACCESS[p.key];
      propRows.push({
        id: p.id,
        customerId: c.id,
        label: p.label,
        street: p.street,
        city: p.city,
        state: p.state,
        zip: p.zip,
        lat: p.lat,
        lng: p.lng,
        geocodeStatus: "ok",
        timezone: ctx.tz,
        accessNotes: a?.notes ?? null,
        gateCodeEnc: a?.gate ? encrypt(a.gate) : null,
        pets: a?.pets ?? null,
        siteContactName: a?.site?.[0] ?? null,
        siteContactPhone: a?.site?.[1] ?? null,
        propertyType:
          c.type === "commercial"
            ? "commercial"
            : c.type === "property_manager"
              ? "apartment"
              : "house",
        isPrimary: i === 0,
        createdAt,
        updatedAt: createdAt,
      });
    });
  }
  for (let i = 0; i < custRows.length; i += 100)
    await db
      .insert(customers)
      .values(custRows.slice(i, i + 100))
      .onConflictDoNothing();
  for (let i = 0; i < propRows.length; i += 100)
    await db
      .insert(properties)
      .values(propRows.slice(i, i + 100))
      .onConflictDoNothing();

  const actor: Actor = { kind: "user", userId: office };
  for (const n of NOTES) {
    const c = plan.customers[n.n - 1];
    if (!c) continue;
    try {
      await addNote(
        db,
        {
          entity: { type: "customer", id: c.id },
          customerId: c.id,
          body: n.body,
          visibility: "internal",
          pinned: n.pinned ?? false,
          clientId: seedId("note", `customer-${n.n}`),
        },
        actor,
      );
    } catch (err) {
      // B2's addNote may dedupe on clientId (rerun) — keep seeding.
      ctx.log(`customer note ${n.n} skipped: ${(err as Error).message}`);
    }
  }
  ctx.log(`${custRows.length} customers, ${propRows.length} properties`);
}
