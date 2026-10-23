import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { leadEvents, leadSources, leads } from "@/db/schema";
import { findOrCreateCustomer } from "@/features/customers/api";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/types";
import { recordLeadConsent } from "./intake/process";

// Shared by the lead actions (Looks legit, Not spam, convert) and booking (bookLead):
// a plain server module, so it is never exposed as a server action.

type LeadRow = typeof leads.$inferSelect;

/** Create the customer (and property) for a lead that has none yet. */
export async function ensureLeadCustomer(
  tx: Tx,
  lead: LeadRow | string,
  actor: Actor,
): Promise<{ customerId: string | null; propertyId: string | null }> {
  let l: LeadRow | undefined;
  if (typeof lead === "string") {
    [l] = await tx.select().from(leads).where(eq(leads.id, lead)).limit(1);
    if (!l) throw new NotFoundError("Lead");
  } else l = lead;
  if (l.customerId)
    return { customerId: l.customerId, propertyId: l.propertyId };
  if (!l.phone && !l.email && !l.name)
    return { customerId: null, propertyId: null };
  const [src] = l.leadSourceId
    ? await tx
        .select({ name: leadSources.name })
        .from(leadSources)
        .where(eq(leadSources.id, l.leadSourceId))
        .limit(1)
    : [];
  const a = l.address;
  const fc = await findOrCreateCustomer(
    tx,
    {
      displayName: l.name,
      phone: l.phone,
      email: l.email,
      address:
        a?.street && a.zip
          ? {
              street: a.street,
              unit: a.unit ?? null,
              city: a.city ?? "",
              state: a.state ?? "",
              zip: a.zip,
            }
          : null,
      leadSourceId: l.leadSourceId,
      source: src?.name ?? null,
      firstTouch:
        (l.attribution?.first_touch as Record<string, unknown>) ??
        (Object.keys(l.attribution ?? {}).length ? l.attribution : null),
      isTest: l.isTest,
    },
    actor,
  );
  await tx
    .update(leads)
    .set({
      customerId: fc.customerId,
      propertyId: fc.propertyId ?? l.propertyId,
      isReturning: l.isReturning || !fc.created,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, l.id));
  if (l.smsConsent || l.marketingConsent) {
    // Consent evidence comes from the original submission (IP and browser of the
    // received/spam event), not from whoever approves the lead later.
    const [ev] = await tx
      .select({ ip: leadEvents.ip, userAgent: leadEvents.userAgent })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.leadId, l.id),
          sql`${leadEvents.kind} in ('received', 'spam')`,
        ),
      )
      .orderBy(leadEvents.createdAt)
      .limit(1);
    await recordLeadConsent(tx, {
      customerId: fc.customerId,
      phone: l.phone,
      email: l.email,
      sms: l.smsConsent,
      marketing: l.marketingConsent,
      textShown: (l.extra?._consent_text as string) ?? null,
      pageUrl:
        ((l.attribution?.page_url ?? l.attribution?.landing_url) as
          | string
          | undefined) ?? null,
      ip: ev?.ip ?? null,
      userAgent: ev?.userAgent ?? null,
      source: "web_form",
      actor,
    });
  }
  return {
    customerId: fc.customerId,
    propertyId: fc.propertyId ?? l.propertyId,
  };
}
