import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { cache } from "react";
import { db, execRows } from "@/db";
import {
  consentEvents,
  customers,
  jobs,
  messages,
  messageTemplates,
  properties,
  scheduledMessages,
  users,
} from "@/db/schema";
import {
  buildTemplateContext,
  type Facts,
  loadFacts,
} from "@/features/automations/context";
import {
  assertCustomerAccess,
  contactRevealedFor,
} from "@/features/customers/api";
import type { SmsStatus } from "@/features/customers/contracts";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { redactMessageText } from "@/lib/mask";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import type {
  ComposerData,
  ComposerTemplate,
  OutboxCard,
  Purpose,
  ThreadMessage,
  ThreadSummary,
} from "./contracts";
import { COMPOSER_TEMPLATE_KEYS, templateLabel } from "./labels";
import { rebaseAppLinks } from "./links";
import { composerRef, templateResolves } from "./render";
import { entityStillValid } from "./sender";

// Messaging read DAL. Every entry point calls requireUser(perm) first and scopes rows:
//  - threads: `messages.view_all`, or a tech's customers (jobs assigned to them);
//  - outbox: mine (assigned to me, plus the unassigned office pool when I work the
//    shared outbox) or all (`messages.outbox_all`);
//  - contact details are masked for techs outside the active contact window (B1).

const OPEN = ["scheduled", "deferred_quiet", "pending_tap"] as const;

/** Customers a tech may message: any job assigned to them. */
function techCustomerScope(userId: string): SQL {
  return sql`(select j.customer_id from jobs j join job_assignments a on a.job_id = j.id where a.user_id = ${userId})`;
}

function mask(v: string | null): string | null {
  if (!v) return null;
  if (v.includes("@")) return `${v.slice(0, 1)}•••@${v.split("@")[1] ?? ""}`;
  return `•••${v.slice(-4)}`;
}

/**
 * Thread bodies for a viewer outside the customer's contact window (QA2 NEW-3): the
 * same policy as the customer and job pages (`contactRevealedFor`), so old texts
 * can't hand out the street number or a live /j/ link those pages hide.
 */
async function maskedThread(
  items: ThreadMessage[],
  customerId: string,
): Promise<ThreadMessage[]> {
  const props = await db
    .select({ street: properties.street })
    .from(properties)
    .where(eq(properties.customerId, customerId));
  const streets = props.map((p) => p.street);
  return items.map((m) => ({
    ...m,
    body: redactMessageText(m.body, { streets }),
    subject: m.subject ? redactMessageText(m.subject, { streets }) : m.subject,
  }));
}

// ------------------------------------------------------------------ threads

export const listThreads = cache(
  async (
    opts: { q?: string; filter?: "all" | "waiting" } = {},
  ): Promise<ThreadSummary[]> => {
    const user = await requireUser("messages.send");
    const all = user.perms.has("messages.view_all");
    const q = opts.q?.trim();
    const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
    const digits = q?.replace(/\D/g, "") ?? "";
    const rows = await execRows<{
      customer_id: string;
      name: string;
      body: string;
      at: Date | string;
      direction: "in" | "out";
      channel: string;
      pending: number;
    }>(sql`
      with last as (
        select distinct on (m.customer_id)
          m.customer_id, m.body, m.created_at as at, m.direction, m.channel
        from messages m
        where m.customer_id is not null
        order by m.customer_id, m.created_at desc
      ),
      pend as (
        select recipient_customer_id as customer_id, count(*)::int as pending,
          max(updated_at) as at
        from scheduled_messages
        where status = 'pending_tap' and recipient_customer_id is not null
        group by recipient_customer_id
      )
      select c.id as customer_id, c.display_name as name,
        coalesce(l.body, '') as body,
        greatest(coalesce(l.at, 'epoch'::timestamptz), coalesce(p.at, 'epoch'::timestamptz)) as at,
        coalesce(l.direction, 'out') as direction,
        coalesce(l.channel, 'sms') as channel,
        coalesce(p.pending, 0) as pending
      from customers c
      left join last l on l.customer_id = c.id
      left join pend p on p.customer_id = c.id
      where (l.customer_id is not null or p.customer_id is not null)
        and c.deleted_at is null
        ${all ? sql`` : sql`and c.id in ${techCustomerScope(user.id)}`}
        ${like ? sql`and (c.display_name ilike ${like} ${digits.length >= 3 ? sql`or c.phone like ${`%${digits}%`}` : sql``})` : sql``}
        ${opts.filter === "waiting" ? sql`and (coalesce(p.pending, 0) > 0 or l.direction = 'in')` : sql``}
      order by at desc
      limit 150
    `);
    // Previews: no per-customer window lookup for a list; anyone without
    // customers.contact_view gets the redacted text (the thread shows the rest).
    const redact = !user.perms.has("customers.contact_view");
    return rows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      lastBody: redact ? redactMessageText(r.body) : r.body,
      lastAt: new Date(r.at).toISOString(),
      lastDirection: r.direction,
      lastChannel: r.channel,
      pending: Number(r.pending),
    }));
  },
);

export interface ThreadView {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    smsStatus: SmsStatus;
    doNotText: boolean;
    doNotContact: boolean;
  };
  messages: ThreadMessage[];
  /** Bodies are redacted: the viewer is outside the customer's contact window. */
  masked: boolean;
  /** Customer replied with a likely opt-out that nobody reviewed yet. */
  optoutFlag: boolean;
  canLogReply: boolean;
}

async function threadRows(
  where: SQL | undefined,
  schedWhere: SQL | undefined,
  viewer: SessionUser,
): Promise<ThreadMessage[]> {
  const [msgs, sched] = await Promise.all([
    db
      .select({
        id: messages.id,
        direction: messages.direction,
        channel: messages.channel,
        body: messages.body,
        subject: messages.subject,
        status: messages.status,
        at: messages.createdAt,
        sentAt: messages.sentAt,
        templateKey: messages.templateKey,
        jobId: messages.jobId,
        jobNumber: jobs.number,
        error: messages.error,
        sender: users.name,
      })
      .from(messages)
      .leftJoin(jobs, eq(jobs.id, messages.jobId))
      .leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(where)
      .orderBy(desc(messages.createdAt))
      .limit(200),
    db
      .select({
        id: scheduledMessages.id,
        channel: scheduledMessages.channel,
        body: scheduledMessages.renderedBody,
        subject: scheduledMessages.renderedSubject,
        status: scheduledMessages.status,
        sendAt: scheduledMessages.sendAt,
        templateKey: scheduledMessages.templateKey,
        jobId: scheduledMessages.jobId,
        jobNumber: jobs.number,
        assignedUserId: scheduledMessages.assignedUserId,
      })
      .from(scheduledMessages)
      .leftJoin(jobs, eq(jobs.id, scheduledMessages.jobId))
      .where(
        and(
          schedWhere,
          inArray(scheduledMessages.status, [...OPEN]),
          eq(scheduledMessages.audienceType, "customer"),
        ),
      )
      .orderBy(asc(scheduledMessages.sendAt))
      .limit(50),
  ]);
  const canCancel =
    viewer.perms.has("messages.view_all") ||
    viewer.perms.has("messages.outbox_all");
  const out: ThreadMessage[] = msgs.reverse().map((m) => ({
    id: m.id,
    kind: "message",
    direction: m.direction as "in" | "out",
    channel: m.channel,
    body: m.body,
    subject: m.subject,
    status: m.status,
    at: (m.sentAt ?? m.at).toISOString(),
    sender: m.sender,
    templateKey: m.templateKey,
    jobId: m.jobId,
    jobNumber: m.jobNumber,
    error: m.error,
  }));
  for (const s of sched)
    out.push({
      id: s.id,
      kind: "scheduled",
      direction: "out",
      channel: s.channel,
      body: s.body ? rebaseAppLinks(s.body) : templateLabel(s.templateKey),
      subject: s.subject,
      status: s.status,
      at: s.sendAt.toISOString(),
      sender: null,
      templateKey: s.templateKey,
      jobId: s.jobId,
      jobNumber: s.jobNumber,
      error: null,
      cancellable: canCancel || s.assignedUserId === viewer.id,
    });
  return out;
}

export const getThread = cache(
  async (customerId: string): Promise<ThreadView> => {
    const user = await requireUser("messages.send");
    if (!user.perms.has("messages.view_all"))
      await assertCustomerAccess(user, customerId, "read");
    const [c] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!c) throw new NotFoundError("Customer");
    const { revealed } = await contactRevealedFor(user, customerId);
    const rows = await threadRows(
      eq(messages.customerId, customerId),
      eq(scheduledMessages.recipientCustomerId, customerId),
      user,
    );
    const items = revealed ? rows : await maskedThread(rows, customerId);
    // Unreviewed natural-language opt-out: flagged and no consent change since.
    const [flag] = await execRows<{ n: number }>(sql`
      select count(*)::int as n from activity a
      where a.customer_id = ${customerId} and a.kind = 'message.optout_detected'
        and not exists (
          select 1 from consent_events ce
          where ce.customer_id = ${customerId} and ce.created_at > a.created_at
        )
    `);
    return {
      customer: {
        id: c.id,
        name: c.displayName,
        phone: revealed ? c.phone : mask(c.phone),
        email: revealed ? c.email : mask(c.email),
        smsStatus: c.smsStatus as SmsStatus,
        doNotText: c.doNotText,
        doNotContact: c.doNotContact,
      },
      messages: items,
      masked: !revealed,
      optoutFlag: Number(flag?.n ?? 0) > 0,
      canLogReply: user.perms.has("messages.send"),
    };
  },
);

/** Job thread (S30): messages and open sends for one job. */
export async function getJobThread(
  jobId: string,
  viewer: SessionUser,
): Promise<ThreadMessage[]> {
  const rows = await threadRows(
    eq(messages.jobId, jobId),
    eq(scheduledMessages.jobId, jobId),
    viewer,
  );
  if (viewer.perms.has("customers.contact_view") || rows.length === 0)
    return rows;
  const [j] = await db
    .select({ customerId: jobs.customerId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!j) return rows;
  const { revealed } = await contactRevealedFor(viewer, j.customerId);
  return revealed ? rows : maskedThread(rows, j.customerId);
}

// ------------------------------------------------------------------ outbox

export function outboxScopeWhere(
  user: SessionUser,
  scope: "mine" | "all",
): SQL | undefined {
  if (scope === "all" && user.perms.has("messages.outbox_all"))
    return undefined;
  if (user.perms.has("messages.outbox_all"))
    return or(
      eq(scheduledMessages.assignedUserId, user.id),
      isNull(scheduledMessages.assignedUserId),
    );
  return eq(scheduledMessages.assignedUserId, user.id);
}

export const listOutbox = cache(
  async (scope: "mine" | "all" = "mine"): Promise<OutboxCard[]> => {
    const user = await requireUser("messages.send");
    if (scope === "all" && !user.perms.has("messages.outbox_all"))
      throw new ForbiddenError(undefined, "messages.outbox_all");
    const rows = await db
      .select({
        id: scheduledMessages.id,
        customerId: scheduledMessages.recipientCustomerId,
        customerName: customers.displayName,
        jobId: scheduledMessages.jobId,
        jobNumber: jobs.number,
        to: scheduledMessages.toAddress,
        channel: scheduledMessages.channel,
        body: scheduledMessages.renderedBody,
        templateKey: scheduledMessages.templateKey,
        sendAt: scheduledMessages.sendAt,
        updatedAt: scheduledMessages.updatedAt,
        expiresAt: scheduledMessages.expiresAt,
        assignedUserId: scheduledMessages.assignedUserId,
        assignedName: users.name,
        purpose: scheduledMessages.purpose,
      })
      .from(scheduledMessages)
      .leftJoin(
        customers,
        eq(customers.id, scheduledMessages.recipientCustomerId),
      )
      .leftJoin(jobs, eq(jobs.id, scheduledMessages.jobId))
      .leftJoin(users, eq(users.id, scheduledMessages.assignedUserId))
      .where(
        and(
          eq(scheduledMessages.status, "pending_tap"),
          outboxScopeWhere(user, scope),
        ),
      )
      .orderBy(
        sql`${scheduledMessages.expiresAt} asc nulls last`,
        asc(scheduledMessages.sendAt),
      )
      .limit(100);
    return rows
      .filter((r) => !!r.to)
      .map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customerName ?? r.to ?? "Recipient",
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        to: r.to as string,
        channel: r.channel === "whatsapp" ? "whatsapp" : "sms",
        body: rebaseAppLinks(r.body ?? ""),
        templateKey: r.templateKey,
        templateLabel: templateLabel(r.templateKey),
        dueAt: r.sendAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        assignedUserId: r.assignedUserId,
        assignedName: r.assignedName,
        purpose: r.purpose as Purpose,
      }));
  },
);

// ------------------------------------------------------------------ composer

/** Composer-only context rules beyond "every required variable resolves". */
const COMPOSER_NEEDS: Record<string, (f: Facts) => boolean> = {
  // "…after last week's visit": only for a customer with finished work.
  "job.checkin": (f) =>
    !!f.lastJob || ["completed", "closed"].includes(f.job?.status ?? ""),
};

/**
 * Composer data. Templates are offered only when they fit the context the composer was
 * opened in (QA T2-08): every required variable resolves (a job template needs the
 * job, an invoice template an open invoice…) and the send-time validity check passes
 * (no "booked" text for a finished job). Callers have checked `jobId`/`leadId` belong
 * to the viewer and this customer.
 */
export async function getComposerData(
  customerId: string,
  viewer: SessionUser,
  opts: {
    templateKeys?: string[];
    jobId?: string | null;
    leadId?: string | null;
  } = {},
): Promise<ComposerData | null> {
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) return null;
  const settings = await getSettings();
  const keys = opts.templateKeys?.length
    ? opts.templateKeys
    : [...COMPOSER_TEMPLATE_KEYS];
  const tplRows = await db
    .select({
      key: messageTemplates.key,
      channel: messageTemplates.channel,
      purpose: messageTemplates.purpose,
      subject: messageTemplates.subject,
      body: messageTemplates.body,
    })
    .from(messageTemplates)
    .where(
      and(
        inArray(messageTemplates.key, keys),
        eq(messageTemplates.locale, "en"),
        inArray(messageTemplates.channel, ["sms", "email"]),
      ),
    );
  const ref = await composerRef(db, {
    customerId,
    jobId: opts.jobId,
    leadId: opts.leadId,
  });
  const facts = await loadFacts(ref);
  // Preview context (placeholder links, nothing minted) just to see what resolves.
  const ctx = await buildTemplateContext(db, facts, {
    variables: null,
    mint: false,
  });
  const now = new Date();
  const templates: ComposerTemplate[] = [];
  for (const k of keys) {
    if (entityStillValid(k, facts, now)) continue;
    if (COMPOSER_NEEDS[k] && !COMPOSER_NEEDS[k](facts)) continue;
    const rows = tplRows.filter(
      (t) =>
        t.key === k && templateResolves(`${t.subject ?? ""}\n${t.body}`, ctx),
    );
    if (rows.length === 0) continue;
    templates.push({
      key: k,
      label: templateLabel(k),
      channels: rows.map((r) => r.channel),
      purpose: (rows[0]?.purpose ?? "transactional") as Purpose,
    });
  }
  const { revealed } = await contactRevealedFor(viewer, customerId);
  const sms = c.smsStatus as SmsStatus;
  const blocked = c.doNotContact || c.doNotText || sms === "opted_out";
  const pref = c.preferredChannel;
  return {
    customerId: c.id,
    customerName: c.displayName,
    phone: revealed ? c.phone : mask(c.phone),
    email: revealed ? c.email : mask(c.email),
    smsStatus: sms,
    doNotText: c.doNotText,
    doNotContact: c.doNotContact,
    canSms: !!c.phone && !blocked,
    canEmail: !!c.email && !c.doNotContact,
    whatsappEnabled: settings.messaging.whatsapp_enabled,
    preferredChannel:
      pref === "email" ? "email" : pref === "whatsapp" ? "whatsapp" : "sms",
    templates,
    linkDelimiter: settings.messaging.link_delimiter,
    textingLocked: !revealed && !viewer.perms.has("customers.contact_view"),
  };
}

/** Consent ledger for the S31 panel (newest first). */
export async function getConsentLedger(customerId: string) {
  return db
    .select({
      id: consentEvents.id,
      channel: consentEvents.channel,
      purpose: consentEvents.purpose,
      action: consentEvents.action,
      source: consentEvents.source,
      at: consentEvents.createdAt,
      by: users.name,
    })
    .from(consentEvents)
    .leftJoin(users, eq(users.id, consentEvents.actorUserId))
    .where(eq(consentEvents.customerId, customerId))
    .orderBy(desc(consentEvents.createdAt))
    .limit(30);
}

/** Customers for the bulk-send preview (messages.bulk_send). */
export async function bulkAudience(filter: {
  audience: "marketing" | "all_textable" | "recent_customers";
  months?: number;
}): Promise<{ ids: string[]; sample: string[] }> {
  await requireUser("messages.bulk_send");
  const months = Math.max(1, Math.min(60, filter.months ?? 12));
  const rows = await execRows<{ id: string; name: string }>(sql`
    select c.id, c.display_name as name from customers c
    where c.deleted_at is null and c.is_test = false and c.do_not_contact = false
      and c.do_not_text = false and c.phone is not null and c.sms_status <> 'opted_out'
      ${filter.audience === "marketing" ? sql`and c.sms_status = 'marketing'` : sql``}
      ${
        filter.audience === "recent_customers"
          ? sql`and exists (select 1 from jobs j where j.customer_id = c.id
              and j.status in ('completed','closed')
              and j.completed_at > now() - (${months} || ' months')::interval)`
          : sql``
      }
    order by c.display_name
    limit 5000
  `);
  return {
    ids: rows.map((r) => r.id),
    sample: rows.slice(0, 5).map((r) => r.name),
  };
}
