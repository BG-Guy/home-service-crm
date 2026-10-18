import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { leadSources, leads, properties } from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import { appUrl } from "@/lib/env";
import { emit } from "@/lib/events";
import { getSettings } from "@/lib/settings";
import type { Actor, SessionUser } from "@/lib/types";
import type { LeadPrefill } from "./contracts";

// B1 leads API (BUILD_PLAN §6.1). Writes take `tx` first and `actor` last.

export type * from "./contracts";

/** Prefill for /jobs/new and /estimates/new (leads.view or leads.convert). */
export async function getLeadPrefill(
  leadId: string,
  viewer: SessionUser,
): Promise<LeadPrefill | null> {
  if (!viewer.perms.has("leads.view") && !viewer.perms.has("leads.convert"))
    return null;
  const [l] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!l) return null;
  let propertyId = l.propertyId;
  if (!propertyId && l.customerId) {
    // No address on the lead: fall back to the customer's primary (else first) property.
    const [p] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.customerId, l.customerId),
          isNull(properties.deletedAt),
        ),
      )
      .orderBy(desc(properties.isPrimary), asc(properties.createdAt))
      .limit(1);
    propertyId = p?.id ?? null;
  }
  return {
    leadId: l.id,
    customerId: l.customerId,
    propertyId,
    serviceTypeId: l.serviceTypeId,
    serviceText: l.serviceText,
    quotedPriceCents: l.quotedPriceCents,
    preferredDate: l.preferredDate,
    preferredWindow: l.preferredWindow,
    notes: l.notes,
    leadSourceId: l.leadSourceId,
  };
}

/** status → booked + converted ids; emits lead.converted + lead.status_changed. Idempotent. */
export async function markLeadConverted(
  tx: Tx,
  leadId: string,
  to: { jobId?: string; estimateId?: string },
  actor: Actor,
): Promise<void> {
  const [l] = await tx
    .select()
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!l) return;
  const already =
    l.status === "booked" &&
    (!to.jobId || l.convertedJobId === to.jobId) &&
    (!to.estimateId || l.convertedEstimateId === to.estimateId);
  if (already) return;
  await tx
    .update(leads)
    .set({
      status: "booked",
      convertedJobId: to.jobId ?? l.convertedJobId,
      convertedEstimateId: to.estimateId ?? l.convertedEstimateId,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));
  const entity = { type: "lead", id: leadId } as const;
  await emit(
    tx,
    "lead.converted",
    entity,
    {
      lead_id: leadId,
      job_id: to.jobId ?? null,
      estimate_id: to.estimateId ?? null,
    },
    { actor },
  );
  if (l.status !== "booked") {
    await emit(
      tx,
      "lead.status_changed",
      entity,
      { lead_id: leadId, from: l.status, to: "booked" },
      { actor },
    );
  }
  await writeActivity(tx, {
    entity,
    customerId: l.customerId,
    kind: "lead.converted",
    summary: "Lead converted",
    actorUserId: actor.userId,
  });
}

/** Sets first_response_at/by once; emits lead.responded. Idempotent. */
export async function markLeadResponded(
  tx: Tx,
  leadId: string,
  by: { userId: string; channel: "call" | "sms" | "whatsapp" | "email" },
  actor: Actor,
): Promise<void> {
  const now = new Date();
  const rows = await tx
    .update(leads)
    .set({ firstResponseAt: now, firstResponseBy: by.userId, updatedAt: now })
    .where(and(eq(leads.id, leadId), isNull(leads.firstResponseAt)))
    .returning({ createdAt: leads.createdAt, customerId: leads.customerId });
  const r = rows[0];
  if (!r) return;
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - r.createdAt.getTime()) / 1000),
  );
  const entity = { type: "lead", id: leadId } as const;
  await emit(
    tx,
    "lead.responded",
    entity,
    {
      lead_id: leadId,
      user_id: by.userId,
      channel: by.channel,
      response_seconds: seconds,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: r.customerId,
    kind: "lead.responded",
    summary: `First response by ${by.channel}`,
    actorUserId: actor.userId,
  });
}

/**
 * `${APP_URL}/f/<pk>` of the default website source: `settings.leads.default_source_id`
 * when it has a public key, else the oldest active website-type source with one.
 */
export async function getDefaultBookingLink(): Promise<string | null> {
  const s = await getSettings();
  const rows = await db
    .select({
      id: leadSources.id,
      publicKey: leadSources.publicKey,
      kind: leadSources.kind,
      integrationKind: leadSources.integrationKind,
    })
    .from(leadSources)
    .where(and(eq(leadSources.active, true), isNotNull(leadSources.publicKey)))
    .orderBy(asc(leadSources.createdAt));
  const pick =
    rows.find((r) => r.id === s.leads.default_source_id) ??
    rows.find(
      (r) =>
        r.integrationKind === "hosted_form" ||
        (r.kind === "website" &&
          ["plain_form", "js_snippet", "hosted_form"].includes(
            r.integrationKind,
          )),
    ) ??
    rows[0];
  return pick?.publicKey ? appUrl(`/f/${pick.publicKey}`) : null;
}

/** Open leads (new/contacted/qualified) for a customer — used by the message.sent handler. */
export async function openLeadIdsForCustomer(
  customerId: string,
  opts?: { tx?: Tx },
): Promise<string[]> {
  const rows = await (opts?.tx ?? db)
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.customerId, customerId),
        inArray(leads.status, ["new", "contacted", "qualified"]),
      ),
    );
  return rows.map((r) => r.id);
}
