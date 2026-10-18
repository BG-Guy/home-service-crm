// Event handlers for `leads` (BUILD_PLAN §4, §7). Owner: B1.
// Each handler runs in its own transaction and MUST be idempotent.
import { eq } from "drizzle-orm";
import { leads } from "@/db/schema";
import { notify } from "@/features/notify/api";
import type { DomainEvent, HandlerReg, IgnoreReg } from "@/lib/events";
import { SYSTEM_ACTOR } from "@/lib/types";
import { markLeadResponded, openLeadIdsForCustomer } from "./api";

/** Templates sent by automations on the lead's behalf: they never count as a human response. */
const AUTOMATED_LEAD_TEMPLATES = new Set([
  "lead.ack",
  "lead.ack_after_hours",
  "lead.not_reached",
]);

const CHANNELS = new Set(["sms", "whatsapp", "email"]);

export const handlers: HandlerReg[] = [
  {
    // A human text/email to the lead (or a customer with an open lead) answers the
    // speed-to-lead clock. markLeadResponded is idempotent (first response only).
    event: "message.sent",
    name: "leads.responded_by_message",
    async run(e: DomainEvent<"message.sent">, { tx }) {
      const p = e.payload;
      if (!p.user_id || !CHANNELS.has(p.channel)) return;
      if (p.template_key && AUTOMATED_LEAD_TEMPLATES.has(p.template_key))
        return;
      const ids = p.lead_id
        ? [p.lead_id]
        : p.customer_id
          ? await openLeadIdsForCustomer(p.customer_id, { tx })
          : [];
      for (const id of ids)
        await markLeadResponded(
          tx,
          id,
          {
            userId: p.user_id,
            channel: p.channel as "sms" | "whatsapp" | "email",
          },
          { ...SYSTEM_ACTOR, userId: p.user_id, kind: "user" },
        );
    },
  },
  {
    // Same person asked again: tell whoever owns the lead (no built-in automation).
    event: "lead.touched",
    name: "leads.notify_touched",
    async run(e: DomainEvent<"lead.touched">, { tx }) {
      const [l] = await tx
        .select({
          assigned: leads.assignedUserId,
          name: leads.name,
          status: leads.status,
        })
        .from(leads)
        .where(eq(leads.id, e.payload.lead_id))
        .limit(1);
      if (!l?.assigned || l.status === "spam") return;
      await notify(tx, {
        to: { userIds: [l.assigned] },
        type: "staff.lead_touched",
        title: `${l.name ?? "A lead"} reached out again`,
        body: "They submitted another request. Call them back while it's fresh.",
        url: `/leads/${e.payload.lead_id}`,
        entity: { type: "lead", id: e.payload.lead_id },
        priority: "high",
      });
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [
  {
    ignore: "lead.sla_breached",
    reason: "activity only; escalations come from lead.created automations",
  },
];
