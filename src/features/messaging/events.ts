// Event handlers for `messaging` (BUILD_PLAN §4, §7). Owner: B5.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds).
import { eq } from "drizzle-orm";
import { getSmsDriver } from "@/adapters/messaging";
import { customers } from "@/db/schema";
import { notify } from "@/features/notify/api";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import type { Perm } from "@/lib/permissions";
import { SYSTEM_ACTOR } from "@/lib/types";
import { recomputeSmsStatus } from "./api";
import { enqueueCore } from "./enqueue";
import { handleInboundKeywords } from "./inbound";

type P = Record<string, unknown>;
const str = (p: P, k: string) =>
  typeof p[k] === "string" ? (p[k] as string) : null;

export const handlers: HandlerReg[] = [
  {
    // STOP/START/HELP, C/R replies, natural-language opt-out flags (SPEC M12).
    event: "message.received",
    name: "messaging.inbound_keywords",
    async run(e, { tx }) {
      const p = e.payload as P;
      const id = str(p, "message_id");
      if (!id) return;
      await handleInboundKeywords(tx, {
        message_id: id,
        customer_id: str(p, "customer_id"),
        body: str(p, "body") ?? "",
      });
    },
  },
  {
    // One-tap review prompt for staff (never auto-applied).
    event: "message.optout_detected",
    name: "messaging.optout_review",
    async run(e, { tx }) {
      const p = e.payload as P;
      const cid = str(p, "customer_id");
      if (!cid) return;
      const [c] = await tx
        .select({ name: customers.displayName })
        .from(customers)
        .where(eq(customers.id, cid))
        .limit(1);
      await notify(tx, {
        to: { perm: "messages.view_all" as Perm },
        type: "staff.optout_review",
        title: "Possible opt-out",
        body: `${c?.name ?? "A customer"} replied with what looks like an opt-out. Review it and stop texting if needed.`,
        url: `/messages/${cid}?review=optout`,
        entity: { type: "customer", id: cid },
        channels: ["in_app"],
      });
    },
  },
  {
    // Keyword opt-out/opt-in confirmation (only where texts auto-send; link mode has
    // no inbound keywords to confirm).
    event: "consent.changed",
    name: "messaging.keyword_confirmation",
    async run(e, { tx }) {
      const p = e.payload as P;
      if (str(p, "source") !== "sms_keyword") return;
      const driver = await getSmsDriver();
      if (!driver.caps.autoSend) return;
      const cid = str(p, "customer_id");
      if (!cid) return;
      const [c] = await tx
        .select({ phone: customers.phone })
        .from(customers)
        .where(eq(customers.id, cid))
        .limit(1);
      if (!c?.phone) return;
      await enqueueCore(
        tx,
        {
          templateKey:
            str(p, "action") === "revoke"
              ? "messaging.stop_confirm"
              : "messaging.start_confirm",
          channel: "sms",
          purpose: "transactional",
          audience: { type: "address", to: c.phone },
          dedupeKey: `keyword_confirm:${e.id}`,
        },
        SYSTEM_ACTOR,
      );
    },
  },
  {
    // Re-derive the survivor's SMS status from the merged consent ledger.
    event: "customer.merged",
    name: "messaging.merge_consent",
    async run(e, { tx }) {
      const cid =
        str(e.payload as P, "customer_id") ??
        (e.entity?.type === "customer" ? e.entity.id : null);
      if (cid) await recomputeSmsStatus(tx, cid);
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
