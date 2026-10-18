// Demo seed fragment for `messaging` (BUILD_PLAN §10.3 #14). Owner: B5.
// Consent ledger (34 transactional grants, 10 marketing, C12 opted out), 15 message
// threads (booking, on-my-way, receipts sent from phones, one logged reply), outbox
// cards (office: tomorrow's reminders for J77/J78 + 2 review asks; tech2: on-my-way
// for J73) and future automated sends for upcoming jobs computed with the engine's
// timing + dedupe rules. Bodies are rendered by the real renderer (real magic links).
// Writes only B5 tables (+ B1's sms_status setter, F activity); never emits events.
import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import {
  automations,
  consentEvents,
  customers,
  jobs,
  messages,
  payments,
  scheduledMessages,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import {
  computeSendAt,
  dedupeKeyFor,
  type EngineStep,
  resolveSendTime,
} from "@/features/automations/schedule";
import { setCustomerSmsStatus } from "@/features/customers/api";
import { writeActivity } from "@/lib/activity";
import { toGsmSafe } from "@/lib/template";
import { SYSTEM_ACTOR } from "@/lib/types";
import { deriveSmsStatus } from "./api";
import { enqueueCore } from "./enqueue";
import { templateLabel } from "./labels";
import { renderTemplateFor } from "./render";

const DAY = 86_400_000;
/** Customers who agreed to marketing texts (10). */
const MARKETING = new Set([1, 2, 3, 4, 5, 6, 9, 10, 11, 14]);
/** Past jobs whose customers get a full thread (one per customer) + J79/J69/J72. */
const THREAD_COUNT = 12;

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  const now = ctx.now;
  const user = (k: string) => plan.users.find((u) => u.key === k)?.id ?? null;
  const officeId = user("office");

  const presentCustomers = new Set(
    (
      await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          inArray(
            customers.id,
            plan.customers.map((c) => c.id),
          ),
        )
    ).map((r) => r.id),
  );
  if (presentCustomers.size === 0) {
    ctx.log("no customers yet — skipped");
    return;
  }

  // ---------------------------------------------------------------- consent ledger
  let consent = 0;
  for (const c of plan.customers) {
    if (!presentCustomers.has(c.id)) continue;
    const rows: (typeof consentEvents.$inferInsert)[] = [];
    const source = c.sourceKey === "website" ? "web_form" : "verbal";
    const grantAt = new Date(now.getTime() - (60 + c.n) * DAY);
    const ledger: { purpose: string; action: string }[] = [];
    if ((c.n <= 36 && c.n !== 13) || c.n === 12) {
      rows.push({
        id: seedId("consent", `c${c.n}-t`),
        customerId: c.id,
        address: c.phone,
        channel: "sms",
        purpose: "transactional",
        action: "grant",
        source,
        textShown:
          source === "web_form"
            ? "Text me about my request and appointments. Msg & data rates may apply. Reply STOP to opt out."
            : "Customer agreed by phone to appointment texts.",
        pageUrl:
          source === "web_form" ? ctx.profile.messaging.consentPageUrl : null,
        createdAt: grantAt,
      });
      ledger.unshift({ purpose: "transactional", action: "grant" });
    }
    if (MARKETING.has(c.n)) {
      rows.push({
        id: seedId("consent", `c${c.n}-m`),
        customerId: c.id,
        address: c.phone,
        channel: "sms",
        purpose: "marketing",
        action: "grant",
        source,
        textShown: "Send me maintenance reminders and offers (optional).",
        createdAt: new Date(grantAt.getTime() + 60_000),
      });
      ledger.unshift({ purpose: "marketing", action: "grant" });
    }
    if (c.n === 12 || c.flags.optedOut) {
      rows.push({
        id: seedId("consent", `c${c.n}-stop`),
        customerId: c.id,
        address: c.phone,
        channel: "sms",
        purpose: "transactional",
        action: "revoke",
        source: "sms_keyword",
        textShown: "STOP",
        createdAt: new Date(now.getTime() - 10 * DAY),
      });
      ledger.unshift({ purpose: "transactional", action: "revoke" });
    }
    if (rows.length === 0) continue;
    await db.insert(consentEvents).values(rows).onConflictDoNothing();
    consent += rows.length;
    await setCustomerSmsStatus(db, c.id, deriveSmsStatus(ledger));
  }

  // ---------------------------------------------------------------- job data
  const jobIds = plan.jobs.map((j) => j.id);
  const jobRows = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const jobById = new Map(jobRows.map((j) => [j.id, j]));
  const job = (n: number) => {
    const p = plan.jobs[n - 1];
    return p ? { plan: p, row: jobById.get(p.id) ?? null } : null;
  };
  const autos = new Map(
    (
      await db
        .select({
          id: automations.id,
          key: automations.key,
          steps: automations.steps,
        })
        .from(automations)
    ).map((a) => [a.key, a]),
  );

  const render = async (
    key: string,
    o: {
      jobId?: string | null;
      customerId?: string | null;
      entity?: { type: "payment" | "job"; id: string };
      vars?: Record<string, string>;
      mint?: boolean;
    },
  ) => {
    const r = await renderTemplateFor(db, {
      templateKey: key,
      channel: "sms",
      jobId: o.jobId ?? null,
      customerId: o.customerId ?? null,
      entity: o.entity ?? (o.jobId ? { type: "job", id: o.jobId } : null),
      mint: o.mint ?? true,
      vars: o.vars,
    });
    return r ? toGsmSafe(r.body) : null;
  };

  // ---------------------------------------------------------------- threads
  let msgCount = 0;
  const addMessage = async (
    key: string,
    m: {
      customerId: string;
      jobId: string | null;
      direction: "out" | "in";
      body: string;
      at: Date;
      templateKey: string | null;
      sentBy: string | null;
      status: "sent_manual" | "logged" | "sent";
      to?: string | null;
      channel?: "sms" | "email";
    },
  ) => {
    const id = seedId("message", key);
    const inserted = await db
      .insert(messages)
      .values({
        id,
        customerId: m.customerId,
        jobId: m.jobId,
        userId: m.sentBy,
        direction: m.direction,
        channel: m.channel ?? "sms",
        driver: m.direction === "in" ? "manual" : "link",
        purpose: "transactional",
        toAddress: m.direction === "out" ? (m.to ?? null) : null,
        fromAddress: m.direction === "in" ? (m.to ?? null) : null,
        body: m.body,
        status: m.status,
        templateKey: m.templateKey,
        sentByUserId: m.sentBy,
        sentAt: m.at,
        createdAt: m.at,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (inserted.length === 0) return;
    msgCount++;
    await writeActivity(db, {
      entity: m.jobId
        ? { type: "job", id: m.jobId }
        : { type: "customer", id: m.customerId },
      customerId: m.customerId,
      jobId: m.jobId,
      kind: m.direction === "out" ? "message.sent" : "message.received",
      summary:
        m.direction === "out"
          ? `Text sent: ${templateLabel(m.templateKey)}`
          : "Customer reply logged",
      data: { message_id: id, channel: m.channel ?? "sms" },
      actorUserId: m.sentBy,
    });
  };

  // One past, completed job per distinct customer (15 threads with J79/J69/J72).
  const threadJobs: number[] = [];
  const threadCustomers = new Set<string>();
  for (const pj of plan.jobs) {
    if (threadJobs.length >= THREAD_COUNT) break;
    if (pj.n > 54 || threadCustomers.has(pj.customerId)) continue;
    if (
      ![12, 13].includes(pj.customerN) &&
      ["completed", "closed"].includes(pj.status)
    ) {
      threadCustomers.add(pj.customerId);
      threadJobs.push(pj.n);
    }
  }
  for (const n of threadJobs) {
    const j = job(n);
    if (!j?.row || !presentCustomers.has(j.row.customerId)) continue;
    const r = j.row;
    const c = plan.customers.find((x) => x.id === r.customerId);
    if (!c || c.n === 12 || c.n === 13) continue;
    const techId = j.plan.tech ? user(j.plan.tech) : null;
    const start =
      r.windowStart ?? r.scheduledStart ?? new Date(now.getTime() - 5 * DAY);
    const booked = new Date(start.getTime() - 2 * DAY);
    const body1 = await render("job.booked", { jobId: r.id });
    if (body1)
      await addMessage(`j${n}-booked`, {
        customerId: r.customerId,
        jobId: r.id,
        direction: "out",
        body: body1,
        at: booked,
        templateKey: "job.booked",
        sentBy: officeId,
        status: "sent_manual",
        to: c.phone,
      });
    const omw = await render("job.on_my_way", {
      jobId: r.id,
      vars: { eta_minutes: "20" },
    });
    if (omw)
      await addMessage(`j${n}-omw`, {
        customerId: r.customerId,
        jobId: r.id,
        direction: "out",
        body: omw,
        at: new Date(start.getTime() - 20 * 60_000),
        templateKey: "job.on_my_way",
        sentBy: techId,
        status: "sent_manual",
        to: c.phone,
      });
    const pay = j.plan.payments.find((p) => p.kind === "payment");
    if (pay) {
      const [prow] = await db
        .select({ id: payments.id, succeededAt: payments.succeededAt })
        .from(payments)
        .where(eq(payments.id, pay.id))
        .limit(1);
      if (prow) {
        const receipt = await render("payment.receipt", {
          jobId: r.id,
          entity: { type: "payment", id: prow.id },
        });
        if (receipt)
          await addMessage(`j${n}-receipt`, {
            customerId: r.customerId,
            jobId: r.id,
            direction: "out",
            body: receipt,
            at: new Date(
              (prow.succeededAt ?? r.completedAt ?? start).getTime() +
                5 * 60_000,
            ),
            templateKey: "payment.receipt",
            sentBy: pay.collectedBy ? user(pay.collectedBy) : officeId,
            status: "sent_manual",
            to: c.phone,
          });
      }
    }
  }

  // Upcoming J79 (confirmed): reminder sent + the customer's logged "C" reply; today's J69/J72 bookings.
  for (const n of [79, 69, 72]) {
    const j = job(n);
    if (!j?.row || !presentCustomers.has(j.row.customerId)) continue;
    const c = plan.customers.find((x) => x.id === j.row?.customerId);
    const body = await render(n === 79 ? "job.reminder_24h" : "job.booked", {
      jobId: j.row.id,
    });
    if (!body) continue;
    const at =
      n === 79
        ? new Date(now.getTime() - 3 * 3600_000)
        : new Date(now.getTime() - 2 * DAY);
    await addMessage(`j${n}-pre`, {
      customerId: j.row.customerId,
      jobId: j.row.id,
      direction: "out",
      body,
      at,
      templateKey: n === 79 ? "job.reminder_24h" : "job.booked",
      sentBy: officeId,
      status: "sent_manual",
      to: c?.phone ?? null,
    });
    if (n === 79)
      await addMessage("j79-reply", {
        customerId: j.row.customerId,
        jobId: j.row.id,
        direction: "in",
        body: ctx.profile.messaging.confirmReply,
        at: new Date(at.getTime() + 25 * 60_000),
        templateKey: null,
        sentBy: officeId,
        status: "logged",
        to: c?.phone ?? null,
      });
  }

  // Top up to 15 threads with lead conversations (auto-reply + a logged reply), so the
  // inbox looks alive even when the plan's jobs reuse a few customers.
  const withThread = new Set(
    (await db.selectDistinct({ c: messages.customerId }).from(messages)).map(
      (r) => r.c,
    ),
  );
  const REPLIES = ctx.profile.messaging.replies;
  let filler = 0;
  for (const c of plan.customers) {
    if (withThread.size >= 15) break;
    if (withThread.has(c.id) || !presentCustomers.has(c.id)) continue;
    if (c.n === 12 || c.n === 13 || c.n > 36) continue;
    const at = new Date(
      now.getTime() - (2 + (c.n % 9)) * DAY - (c.n % 5) * 3600_000,
    );
    const ack = await render("lead.ack", { customerId: c.id });
    if (!ack) continue;
    await addMessage(`c${c.n}-ack`, {
      customerId: c.id,
      jobId: null,
      direction: "out",
      body: ack,
      at,
      templateKey: "lead.ack",
      sentBy: officeId,
      status: "sent_manual",
      to: c.phone,
    });
    if (filler % 2 === 0)
      await addMessage(`c${c.n}-reply`, {
        customerId: c.id,
        jobId: null,
        direction: "in",
        body: REPLIES[filler % REPLIES.length] as string,
        at: new Date(at.getTime() + 12 * 60_000),
        templateKey: null,
        sentBy: officeId,
        status: "logged",
        to: c.phone,
      });
    withThread.add(c.id);
    filler++;
  }

  // ---------------------------------------------------------------- outbox cards
  let cards = 0;
  const card = async (
    key: string,
    o: {
      n: number;
      automationKey: string;
      templateKey: string;
      assignee: string | null;
      expiresInMin: number | null;
      vars?: Record<string, string>;
    },
  ) => {
    const j = job(o.n);
    if (!j?.row || !presentCustomers.has(j.row.customerId)) return;
    const c = plan.customers.find((x) => x.id === j.row?.customerId);
    if (!c) return;
    const body = await render(o.templateKey, { jobId: j.row.id, vars: o.vars });
    if (!body) return;
    const a = autos.get(o.automationKey);
    const step = ((a?.steps ?? []) as EngineStep[])[0] ?? {
      channel: "sms",
      audience: "customer",
      template_key: o.templateKey,
    };
    const res = await db
      .insert(scheduledMessages)
      .values({
        id: seedId("sched", key),
        automationId: a?.id ?? null,
        stepIndex: 0,
        dedupeKey: dedupeKeyFor({
          automationKey: o.automationKey,
          entityId: j.row.id,
          stepIndex: 0,
          recipient: c.id,
          channel: step.channel,
          step,
          anchorAt: j.row.windowStart,
          eventId: "seed",
          now,
        }),
        templateKey: o.templateKey,
        channel: "sms",
        purpose: o.templateKey.startsWith("review.")
          ? "review"
          : "transactional",
        audienceType: "customer",
        recipientCustomerId: c.id,
        toAddress: c.phone,
        entityType: "job",
        entityId: j.row.id,
        jobId: j.row.id,
        sendAt: new Date(now.getTime() - 10 * 60_000),
        expiresAt: o.expiresInMin
          ? new Date(now.getTime() + o.expiresInMin * 60_000)
          : null,
        status: "pending_tap",
        driver: "link",
        assignedUserId: o.assignee,
        renderedBody: body,
        updatedAt: new Date(now.getTime() - 10 * 60_000),
      })
      .onConflictDoNothing()
      .returning({ id: scheduledMessages.id });
    cards += res.length;
  };
  await card("j77-r24", {
    n: 77,
    automationKey: "reminder_24h",
    templateKey: "job.reminder_24h",
    assignee: officeId,
    expiresInMin: 20 * 60,
  });
  await card("j78-r24", {
    n: 78,
    automationKey: "reminder_24h",
    templateKey: "job.reminder_24h",
    assignee: officeId,
    expiresInMin: 20 * 60,
  });
  await card("j73-omw", {
    n: 73,
    automationKey: "on_my_way",
    templateKey: "job.on_my_way",
    assignee: user("tech2"),
    expiresInMin: 25,
    vars: { eta_minutes: "15" },
  });
  // Two recent paid jobs (different customers, not yet asked) waiting for a review ask.
  const asked = new Set(
    plan.jobs.filter((x) => x.review?.requested).map((x) => x.n),
  );
  const picked: number[] = [];
  const seen = new Set<string>();
  for (const n of [72, 69, 54, 52, 50, 48, 46, 44]) {
    const j = job(n);
    const c = j?.row
      ? plan.customers.find((x) => x.id === j.row?.customerId)
      : null;
    if (!j?.row || !c || asked.has(n) || seen.has(c.id)) continue;
    if (
      !["completed", "closed"].includes(j.row.status) ||
      j.row.paymentStatus !== "paid"
    )
      continue;
    if (c.flags.optedOut || c.flags.doNotText || c.n > 36) continue;
    seen.add(c.id);
    picked.push(n);
    if (picked.length === 2) break;
  }
  for (const n of picked)
    await card(`j${n}-review`, {
      n,
      automationKey: "review_request",
      templateKey: "review.request",
      assignee: officeId,
      expiresInMin: 47 * 60,
    });

  // ---------------------------------------------------------------- future sends
  let future = 0;
  for (let n = 79; n <= 87; n++) {
    const j = job(n);
    const r = j?.row;
    if (!r || !presentCustomers.has(r.customerId)) continue;
    if (!["scheduled", "confirmed"].includes(r.status)) continue;
    const want =
      r.status === "scheduled"
        ? ["reminder_24h", "reminder_2h", "unconfirmed_flag", "late_prompt"]
        : ["reminder_24h", "reminder_2h", "late_prompt"];
    for (const key of want) {
      const a = autos.get(key);
      if (!a) continue;
      const step = (a.steps as EngineStep[])[0];
      if (!step) continue;
      const computed = computeSendAt({
        step,
        eventAt: new Date(now.getTime() - DAY),
        anchors: {
          "job.window_start": r.windowStart,
          "job.window_end": r.windowEnd,
          "job.scheduled_start": r.scheduledStart,
        },
        timeZone: ctx.tz,
      });
      const d = resolveSendTime(computed, now, null);
      if (
        d.status !== "scheduled" ||
        d.sendAt.getTime() <= now.getTime() + 10 * 60_000
      )
        continue;
      const staff = step.audience !== "customer";
      const recipients = staff
        ? step.audience === "assigned_tech"
          ? [user(plan.jobs[n - 1]?.tech ?? "tech1")]
          : [officeId]
        : [r.customerId];
      for (const rid of recipients) {
        if (!rid) continue;
        for (const channel of step.channel.split("+")) {
          await enqueueCore(
            db,
            {
              templateKey: step.template_key,
              channel: channel as never,
              audience: staff
                ? { type: "user", userId: rid }
                : { type: "customer", customerId: rid },
              entity: { type: "job", id: r.id },
              jobId: r.id,
              sendAt: d.sendAt,
              expiresAt: d.expiresAt,
              automationId: a.id,
              stepIndex: 0,
              dedupeKey: dedupeKeyFor({
                automationKey: key,
                entityId: r.id,
                stepIndex: 0,
                recipient: rid,
                channel,
                step,
                anchorAt: computed.anchorAt,
                eventId: "seed",
                now,
              }),
            },
            SYSTEM_ACTOR,
            now,
          );
          future++;
        }
      }
    }
  }
  ctx.log(
    `consent ${consent}, messages ${msgCount}, outbox cards ${cards}, future sends ${future}`,
  );
}
