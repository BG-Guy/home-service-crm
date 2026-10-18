import "server-only";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { getSmsDriver } from "@/adapters/messaging";
import type { Tx } from "@/db";
import { consentEvents, customers, jobs, messages } from "@/db/schema";
import { confirmJob, requestReschedule } from "@/features/jobs/api";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import { SYSTEM_ACTOR } from "@/lib/types";
import { recordConsent } from "./api";
import { enqueueCore } from "./enqueue";
import { classifyInbound } from "./lint";

// Inbound replies (SPEC M12). In link mode there is no inbound driver: the office logs
// a reply by hand ("Customer replied: …"). Paid/gateway drivers (Later) and the dev
// `console` route call the same `recordInbound`. The `message.received` handler then
// applies keywords: STOP/START/HELP, C/R appointment replies (B2 confirmJob /
// requestReschedule) and natural-language opt-outs (flagged for one-tap review only).

export interface InboundInput {
  customerId: string | null;
  from: string | null;
  body: string;
  channel: "sms" | "whatsapp" | "email";
  driver: string;
  /** `logged` = typed in by staff; `received` = from a driver. */
  status: "received" | "logged";
  loggedByUserId?: string | null;
  jobId?: string | null;
  providerId?: string | null;
  receivedAt?: Date;
}

export async function recordInbound(
  tx: Tx,
  i: InboundInput,
): Promise<{ messageId: string }> {
  const at = i.receivedAt ?? new Date();
  const [m] = await tx
    .insert(messages)
    .values({
      customerId: i.customerId,
      jobId: i.jobId ?? null,
      userId: i.loggedByUserId ?? null,
      direction: "in",
      channel: i.channel,
      driver: i.driver,
      purpose: "transactional",
      fromAddress: i.from,
      body: i.body.slice(0, 4000),
      status: i.status,
      providerId: i.providerId ?? null,
      sentByUserId: i.loggedByUserId ?? null,
      sentAt: at,
      createdAt: at,
    })
    .returning({ id: messages.id });
  if (!m) throw new Error("messages insert failed");
  if (i.customerId) {
    await writeActivity(tx, {
      entity: i.jobId
        ? { type: "job", id: i.jobId }
        : { type: "customer", id: i.customerId },
      customerId: i.customerId,
      jobId: i.jobId ?? null,
      kind: "message.received",
      summary:
        i.status === "logged" ? "Customer reply logged" : "Customer replied",
      data: { message_id: m.id, channel: i.channel },
      actorUserId: i.loggedByUserId ?? null,
    });
  }
  await emit(
    tx,
    "message.received",
    { type: "message", id: m.id },
    {
      message_id: m.id,
      customer_id: i.customerId,
      body: i.body.slice(0, 1000),
      actor_user_id: i.loggedByUserId ?? null,
    },
  );
  return { messageId: m.id };
}

/** The customer's next appointment a C/R reply most likely refers to. */
async function upcomingJobFor(
  tx: Tx,
  customerId: string,
  statuses: string[],
  now: Date,
): Promise<string | null> {
  const [j] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customerId),
        inArray(jobs.status, statuses),
        gte(jobs.windowStart, new Date(now.getTime() - 12 * 3600_000)),
      ),
    )
    .orderBy(asc(jobs.windowStart))
    .limit(1);
  return j?.id ?? null;
}

async function alreadyApplied(tx: Tx, messageId: string): Promise<boolean> {
  const [c] = await tx
    .select({ id: consentEvents.id })
    .from(consentEvents)
    .where(eq(consentEvents.messageId, messageId))
    .limit(1);
  return !!c;
}

/** `message.received` handler body. Returns what it did (tests, logs). */
export async function handleInboundKeywords(
  tx: Tx,
  p: { message_id: string; customer_id: string | null; body: string },
  now: Date = new Date(),
): Promise<string> {
  if (!p.customer_id) return "no_customer";
  const cls = classifyInbound(p.body);
  const [c] = await tx
    .select({ phone: customers.phone })
    .from(customers)
    .where(eq(customers.id, p.customer_id))
    .limit(1);
  const address = c?.phone ?? "unknown";
  switch (cls.kind) {
    case "stop":
    case "start": {
      if (await alreadyApplied(tx, p.message_id)) return "duplicate";
      await recordConsent(
        tx,
        {
          customerId: p.customer_id,
          address,
          channel: "sms",
          purpose: "transactional",
          action: cls.kind === "stop" ? "revoke" : "grant",
          source: "sms_keyword",
          textShown: p.body.slice(0, 200),
          messageId: p.message_id,
        },
        SYSTEM_ACTOR,
      );
      return cls.kind;
    }
    case "help": {
      // Help replies only make sense where texts auto-send (paid/gateway drivers).
      const driver = await getSmsDriver();
      if (!driver.caps.autoSend || !c?.phone) return "help_skipped";
      await enqueueCore(
        tx,
        {
          templateKey: "messaging.help",
          channel: "sms",
          purpose: "transactional",
          audience: { type: "address", to: c.phone },
          dedupeKey: `help:${p.message_id}`,
        },
        SYSTEM_ACTOR,
      );
      return "help";
    }
    case "confirm": {
      const jobId = await upcomingJobFor(tx, p.customer_id, ["scheduled"], now);
      if (!jobId) return "confirm_no_job";
      await confirmJob(tx, jobId, "reply", SYSTEM_ACTOR);
      return "confirm";
    }
    case "reschedule": {
      const jobId = await upcomingJobFor(
        tx,
        p.customer_id,
        ["scheduled", "confirmed"],
        now,
      );
      if (!jobId) return "reschedule_no_job";
      await requestReschedule(
        tx,
        jobId,
        "reply",
        "Customer replied R",
        SYSTEM_ACTOR,
      );
      return "reschedule";
    }
    case "optout_nl":
      await emit(
        tx,
        "message.optout_detected",
        { type: "message", id: p.message_id },
        {
          message_id: p.message_id,
          customer_id: p.customer_id,
          confidence: cls.confidence,
        },
      );
      await writeActivity(tx, {
        entity: { type: "customer", id: p.customer_id },
        kind: "message.optout_detected",
        summary: "Reply looks like an opt-out — review it",
        data: { message_id: p.message_id, confidence: cls.confidence },
        actorUserId: null,
      });
      return "optout_flagged";
    default:
      return "other";
  }
}
