"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  automations,
  jobs,
  messageTemplates,
  reminders,
  scheduledMessages,
} from "@/db/schema";
import { gsmLint, lintLinks } from "@/features/messaging/lint";
import { renderTemplateFor } from "@/features/messaging/render";
import { deliverToUsers } from "@/features/notify/deliver";
import { lintReviewTemplate } from "@/features/reviews/lint";
import { action } from "@/lib/action";
import { appUrl } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { EVENT_TYPES } from "@/lib/event-types";
import { newId } from "@/lib/ids";
import { getCompany } from "@/lib/settings";
import { safeTimeZone } from "@/lib/time";
import { validateConditions } from "./conditions";
import { latestJobIdForPreview } from "./context";
import { normalizeCancelOn } from "./engine-shared";
import { nextOccurrence, RecurrenceSchema } from "./recurrence";
import {
  type AnchorKey,
  computeSendAt,
  type EngineStep,
  formatDelay,
  parseAnchor,
  splitPlus,
  splitTriggers,
} from "./schedule";
import { lintTemplateSyntax, type TemplateSyntaxLint } from "./template-lint";
import { AUDIENCE_OPTIONS, CHANNEL_OPTIONS } from "./variables";

// Admin editors (SPEC M13): automations (form + raw JSON), templates (lint + preview +
// reset), custom reminders. Every save is audited with before/after.

const id = z.string().uuid();
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const CHANNELS = new Set(CHANNEL_OPTIONS.map((c) => c.value));
const AUDIENCES = new Set(AUDIENCE_OPTIONS.map((a) => a.value));
const TRIGGERS = new Set<string>([...EVENT_TYPES, "schedule.daily"]);

const Delay = z
  .object({
    minutes: z.number().int().min(-100_000).max(100_000).optional(),
    hours: z.number().int().min(-10_000).max(10_000).optional(),
    days: z.number().int().min(-3650).max(3650).optional(),
  })
  .strict();

const StepSchema = z
  .object({
    delay: Delay.optional(),
    anchor: z.string().max(120).optional(),
    at: z.string().regex(HHMM, "Use HH:MM").optional(),
    channel: z.string().min(1).max(80),
    audience: z.string().min(1).max(400),
    template_key: z.string().min(1).max(80),
    dedupe: z.enum(["entity", "event", "batch"]).optional(),
    batch_minutes: z.number().int().min(1).max(1440).optional(),
    only_on: z.array(z.string().max(80)).max(20).optional(),
    when: z.unknown().optional(),
    delay_months_field: z.string().max(120).optional(),
  })
  .strict();

const AutomationBody = z.object({
  name: z.string().trim().min(1, "Name it.").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  triggerEvent: z.string().trim().min(1).max(400),
  conditions: z.unknown(),
  steps: z.array(StepSchema).min(1, "Add at least one step.").max(12),
  cancelOn: z.array(z.unknown()).max(30),
  featureFlag: z.string().max(40).nullable().optional(),
});
type AutomationBody = z.infer<typeof AutomationBody>;

async function validateAutomation(tx: Tx, a: AutomationBody): Promise<void> {
  const errs: Record<string, string[]> = {};
  const push = (k: string, m: string) => {
    errs[k] = [...(errs[k] ?? []), m];
  };
  for (const t of splitTriggers(a.triggerEvent))
    if (!TRIGGERS.has(t)) push("triggerEvent", `Unknown event "${t}".`);
  for (const p of validateConditions(a.conditions)) push("conditions", p);
  const keys = [...new Set(a.steps.map((s) => s.template_key))];
  const found = await tx
    .selectDistinct({ key: messageTemplates.key })
    .from(messageTemplates)
    .where(inArray(messageTemplates.key, keys));
  a.steps.forEach((s, i) => {
    const k = `steps.${i}`;
    try {
      for (const part of (s.anchor ?? "event_time").split("|"))
        parseAnchor(part);
    } catch (e) {
      push(k, (e as Error).message);
    }
    for (const c of splitPlus(s.channel))
      if (!CHANNELS.has(c)) push(k, `Unknown channel "${c}".`);
    for (const t of splitPlus(s.audience))
      if (
        !AUDIENCES.has(t) &&
        !/^perm:[a-z_]+\.[a-z_]+$/.test(t) &&
        !/^role:[a-z0-9_-]+$/.test(t) &&
        !/^user:[0-9a-f-]{36}$/i.test(t)
      )
        push(k, `Unknown audience "${t}".`);
    if (!found.some((f) => f.key === s.template_key))
      push(k, `Template "${s.template_key}" doesn't exist.`);
    if (s.when !== undefined)
      for (const p of validateConditions(s.when)) push(k, p);
  });
  for (const r of normalizeCancelOn(a.cancelOn))
    if (!TRIGGERS.has(r.event)) push("cancelOn", `Unknown event "${r.event}".`);
  if (Object.keys(errs).length) throw new ValidationError(errs);
}

const snapshot = (a: typeof automations.$inferSelect) => ({
  name: a.name,
  triggerEvent: a.triggerEvent,
  conditions: a.conditions,
  steps: a.steps,
  cancelOn: a.cancelOn,
  enabled: a.enabled,
});

async function loadAutomation(tx: Tx, automationId: string) {
  const [a] = await tx
    .select()
    .from(automations)
    .where(eq(automations.id, automationId))
    .limit(1);
  if (!a) throw new NotFoundError("Automation");
  return a;
}

// ------------------------------------------------------------------ automations

export const setAutomationEnabled = action({
  name: "automations.toggle",
  perm: "automations.manage",
  input: z.object({ id, enabled: z.boolean() }),
  audit: "automation.toggled",
  async run({ input, tx, user, audit }) {
    const a = await loadAutomation(tx, input.id);
    await tx
      .update(automations)
      .set({
        enabled: input.enabled,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, a.id));
    await audit({
      entity: { type: "automation", id: a.id },
      before: { enabled: a.enabled },
      after: { enabled: input.enabled },
    });
    return { key: a.key, enabled: input.enabled };
  },
  revalidate: ({ data }) => [
    "/settings/automations",
    `/settings/automations/${data.key}`,
  ],
});

export const saveAutomation = action({
  name: "automations.save",
  perm: "automations.manage",
  input: AutomationBody.extend({ id }),
  audit: "automation.updated",
  async run({ input, tx, user, audit }) {
    const a = await loadAutomation(tx, input.id);
    const { id: _id, ...body } = input;
    await validateAutomation(tx, body);
    const next = {
      name: body.name,
      description: body.description ?? null,
      triggerEvent: splitTriggers(body.triggerEvent).join("|"),
      conditions: (body.conditions ?? {}) as Record<string, unknown>,
      steps: body.steps as EngineStep[],
      cancelOn: body.cancelOn,
      featureFlag: body.featureFlag ?? a.featureFlag,
    };
    await tx
      .update(automations)
      .set({ ...next, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(automations.id, a.id));
    await audit({
      entity: { type: "automation", id: a.id },
      before: snapshot(a),
      after: { ...snapshot(a), ...next },
    });
    return { key: a.key };
  },
  revalidate: ({ data }) => [
    "/settings/automations",
    `/settings/automations/${data.key}`,
  ],
});

/** Raw JSON editor (admins): same validation as the form. */
export const saveAutomationJson = action({
  name: "automations.save_json",
  perm: "automations.manage",
  input: z.object({ id, json: z.string().max(50_000) }),
  audit: "automation.updated_json",
  async run({ input, tx, user, audit }) {
    if (user.baseRole !== "admin")
      throw new ValidationError({ json: ["Only admins can edit raw JSON."] });
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.json);
    } catch {
      throw new ValidationError({ json: ["That isn't valid JSON."] });
    }
    const body = AutomationBody.safeParse(parsed);
    if (!body.success)
      throw new ValidationError({
        json: body.error.issues.map(
          (i) => `${i.path.join(".") || "root"}: ${i.message}`,
        ),
      });
    const a = await loadAutomation(tx, input.id);
    await validateAutomation(tx, body.data);
    const next = {
      name: body.data.name,
      description: body.data.description ?? null,
      triggerEvent: splitTriggers(body.data.triggerEvent).join("|"),
      conditions: (body.data.conditions ?? {}) as Record<string, unknown>,
      steps: body.data.steps as EngineStep[],
      cancelOn: body.data.cancelOn,
      featureFlag: body.data.featureFlag ?? a.featureFlag,
    };
    await tx
      .update(automations)
      .set({ ...next, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(automations.id, a.id));
    await audit({
      entity: { type: "automation", id: a.id },
      before: snapshot(a),
      after: { ...snapshot(a), ...next },
    });
    return { key: a.key };
  },
  revalidate: ({ data }) => [
    "/settings/automations",
    `/settings/automations/${data.key}`,
  ],
});

export const createAutomation = action({
  name: "automations.create",
  perm: "automations.manage",
  input: z.object({ name: z.string().trim().min(1).max(120) }),
  audit: "automation.created",
  async run({ input, tx, user }) {
    const key = `custom_${newId().slice(0, 8)}`;
    const [row] = await tx
      .insert(automations)
      .values({
        key,
        name: input.name,
        description: null,
        triggerEvent: "job.completed",
        conditions: {},
        steps: [
          {
            delay: { days: 1 },
            channel: "customer_preferred",
            audience: "customer",
            template_key: "job.checkin",
          },
        ],
        cancelOn: [],
        enabled: false,
        builtin: false,
        updatedBy: user.id,
      })
      .returning({ id: automations.id });
    if (!row) throw new Error("insert failed");
    return { id: row.id, key };
  },
  auditEntity: ({ data }) => ({ type: "automation", id: data.id }),
  revalidate: () => ["/settings/automations"],
});

/** Custom automations only; pending sends are canceled first. */
export const deleteAutomation = action({
  name: "automations.delete",
  perm: "automations.manage",
  input: z.object({ id }),
  audit: "automation.deleted",
  async run({ input, tx, audit }) {
    const a = await loadAutomation(tx, input.id);
    if (a.builtin)
      throw new ValidationError({
        _: ["Built-in automations can be turned off, not deleted."],
      });
    await tx
      .update(scheduledMessages)
      .set({
        status: "canceled",
        lastError: "automation_deleted",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMessages.automationId, a.id),
          inArray(scheduledMessages.status, [
            "scheduled",
            "deferred_quiet",
            "pending_tap",
          ]),
        ),
      );
    await tx
      .update(scheduledMessages)
      .set({ automationId: null })
      .where(eq(scheduledMessages.automationId, a.id));
    await tx.delete(automations).where(eq(automations.id, a.id));
    await audit({
      entity: { type: "automation", id: a.id },
      before: snapshot(a),
    });
    return { ok: true };
  },
  revalidate: () => ["/settings/automations"],
});

export interface StepPreview {
  index: number;
  templateKey: string;
  channel: string;
  audience: string;
  when: string;
  sendAt: string | null;
  subject: string | null;
  body: string | null;
  missing: string[];
}

/** "Preview with a real job": render every step for the latest (or a given) job. */
export const previewAutomation = action({
  name: "automations.preview",
  perm: "automations.manage",
  input: z.object({ id, jobId: id.optional() }),
  async run({ input, tx, user }) {
    const a = await loadAutomation(tx, input.id);
    const jobId = input.jobId ?? (await latestJobIdForPreview());
    const [job] = jobId
      ? await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
      : [];
    const tz = safeTimeZone((await getCompany()).timezone);
    const now = new Date();
    const anchors: Partial<Record<AnchorKey, Date | null>> = {
      "job.scheduled_start": job?.scheduledStart ?? null,
      "job.window_start": job?.windowStart ?? job?.scheduledStart ?? null,
      "job.window_end": job?.windowEnd ?? null,
      "job.completed_at": job?.completedAt ?? null,
    };
    const steps = (a.steps ?? []) as EngineStep[];
    const out: StepPreview[] = [];
    for (const [i, s] of steps.entries()) {
      const staff = !splitPlus(s.audience).includes("customer");
      const channel = splitPlus(s.channel)[0] ?? "sms";
      const r = await renderTemplateFor(tx, {
        templateKey: s.template_key,
        channel: channel === "customer_preferred" ? "sms" : channel,
        jobId: job?.id ?? null,
        customerId: job?.customerId ?? null,
        entity: job ? { type: "job", id: job.id } : null,
        userId: staff ? user.id : null,
        mint: false,
      });
      let sendAt: Date | null = null;
      try {
        sendAt = computeSendAt({
          step: s,
          eventAt: now,
          anchors,
          timeZone: tz,
        }).sendAt;
      } catch {
        sendAt = null;
      }
      out.push({
        index: i,
        templateKey: s.template_key,
        channel: s.channel,
        audience: s.audience,
        when: `${formatDelay(s.delay)}${s.anchor && s.anchor !== "event_time" ? ` from ${s.anchor.split("|")[0]}` : ""}${s.at ? ` at ${s.at}` : ""}`,
        sendAt: sendAt?.toISOString() ?? null,
        subject: r?.subject ?? null,
        body: r?.body ?? null,
        missing: r?.missing ?? [],
      });
    }
    return { jobNumber: job?.number ?? null, steps: out };
  },
});

/** "Send test to me": the step rendered for a real job, delivered to my bell (+ email). */
export const sendAutomationTest = action({
  name: "automations.test",
  perm: "automations.manage",
  input: z.object({ id, stepIndex: z.number().int().min(0).max(20) }),
  async run({ input, tx, user }) {
    const a = await loadAutomation(tx, input.id);
    const s = ((a.steps ?? []) as EngineStep[])[input.stepIndex];
    if (!s) throw new NotFoundError("Step");
    const jobId = await latestJobIdForPreview();
    const [job] = jobId
      ? await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
      : [];
    const channel = splitPlus(s.channel)[0] ?? "sms";
    const r = await renderTemplateFor(tx, {
      templateKey: s.template_key,
      channel: channel === "customer_preferred" ? "sms" : channel,
      jobId: job?.id ?? null,
      customerId: job?.customerId ?? null,
      entity: job ? { type: "job", id: job.id } : null,
      userId: user.id,
      mint: false,
    });
    if (!r) throw new NotFoundError("Template");
    await deliverToUsers(tx, {
      userIds: [user.id],
      type: "staff.generic",
      title: `Test: ${a.name}`,
      body: r.subject ? `${r.subject}\n\n${r.body}` : r.body,
      url: `/settings/automations/${a.key}`,
      channels: ["in_app", "push", "email"],
    });
    return { ok: true };
  },
  revalidate: () => ["/notifications"],
});

// ------------------------------------------------------------------ templates

export interface TemplateLintResult {
  gsm: ReturnType<typeof gsmLint> | null;
  links: ReturnType<typeof lintLinks>;
  review: ReturnType<typeof lintReviewTemplate>;
  /** Broken {{tags}}, missing required link (blocking) and unknown variables (QA T3-14). */
  syntax: TemplateSyntaxLint;
  blocking: string[];
}

function lintTemplate(
  key: string,
  channel: string,
  purpose: string,
  body: string,
  subject: string | null,
): TemplateLintResult {
  const all = `${subject ?? ""}\n${body}`;
  const syntax = lintTemplateSyntax(key, all);
  const links = lintLinks(all, appUrl());
  const review =
    purpose === "review" || /\breview/i.test(all)
      ? lintReviewTemplate(all, purpose)
      : [];
  const blocking = [
    ...links
      .filter((l) => l.reason === "shortener")
      .map(
        (l) =>
          `Link shorteners aren't allowed (${l.url}). Use a {{…link}} variable.`,
      ),
    ...review.map((r) => r.message),
    ...syntax.errors,
  ];
  return {
    gsm: channel === "sms" || channel === "whatsapp" ? gsmLint(body) : null,
    links,
    review,
    syntax,
    blocking,
  };
}

export const saveTemplate = action({
  name: "templates.save",
  perm: "templates.manage",
  input: z.object({
    id,
    subject: z.string().max(200).nullable().optional(),
    body: z.string().trim().min(1, "The message can't be empty.").max(2000),
    expiresAfterMinutes: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .nullable()
      .optional(),
    allowOutsideQuietHours: z.boolean().optional(),
  }),
  audit: "template.updated",
  async run({ input, tx, user, audit }) {
    const [t] = await tx
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.id, input.id))
      .limit(1);
    if (!t) throw new NotFoundError("Template");
    const lint = lintTemplate(
      t.key,
      t.channel,
      t.purpose,
      input.body,
      input.subject ?? null,
    );
    if (lint.blocking.length)
      throw new ValidationError({ body: lint.blocking });
    // Quiet-hours bypass is only for live texts (lead ack, on my way); admins only.
    const allowOutside =
      user.baseRole === "admin" && input.allowOutsideQuietHours !== undefined
        ? input.allowOutsideQuietHours
        : t.allowOutsideQuietHours;
    const next = {
      subject: input.subject === undefined ? t.subject : input.subject || null,
      body: input.body,
      expiresAfterMinutes:
        input.expiresAfterMinutes === undefined
          ? t.expiresAfterMinutes
          : input.expiresAfterMinutes || null,
      allowOutsideQuietHours: allowOutside,
    };
    await tx
      .update(messageTemplates)
      .set({ ...next, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(messageTemplates.id, t.id));
    await audit({
      entity: { type: "template", id: t.id },
      before: {
        subject: t.subject,
        body: t.body,
        expiresAfterMinutes: t.expiresAfterMinutes,
        allowOutsideQuietHours: t.allowOutsideQuietHours,
      },
      after: next,
    });
    return { key: t.key };
  },
  revalidate: ({ data }) => [
    "/settings/templates",
    `/settings/templates/${data.key}`,
  ],
});

export const resetTemplate = action({
  name: "templates.reset",
  perm: "templates.manage",
  input: z.object({ id }),
  audit: "template.reset",
  async run({ input, tx, user, audit }) {
    const [t] = await tx
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.id, input.id))
      .limit(1);
    if (!t) throw new NotFoundError("Template");
    await tx
      .update(messageTemplates)
      .set({ body: t.defaultBody, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(messageTemplates.id, t.id));
    await audit({
      entity: { type: "template", id: t.id },
      before: { body: t.body },
      after: { body: t.defaultBody },
    });
    return { key: t.key, body: t.defaultBody };
  },
  revalidate: ({ data }) => [
    "/settings/templates",
    `/settings/templates/${data.key}`,
  ],
});

/** Live preview + lint of unsaved text against a real job (no links minted). */
export const previewTemplate = action({
  name: "templates.preview",
  perm: "templates.manage",
  input: z.object({
    key: z.string().max(80),
    channel: z.string().max(20),
    purpose: z.string().max(20),
    body: z.string().max(2000),
    subject: z.string().max(200).nullable().optional(),
    jobId: id.optional(),
  }),
  async run({ input, tx, user }) {
    const jobId = input.jobId ?? (await latestJobIdForPreview());
    const [job] = jobId
      ? await tx
          .select({
            id: jobs.id,
            customerId: jobs.customerId,
            number: jobs.number,
          })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1)
      : [];
    const r = await renderTemplateFor(tx, {
      templateKey: input.key,
      channel: input.channel,
      jobId: job?.id ?? null,
      customerId: job?.customerId ?? null,
      entity: job ? { type: "job", id: job.id } : null,
      userId: user.id,
      mint: false,
      bodyOverride: input.body,
      subjectOverride: input.subject ?? null,
    });
    return {
      jobNumber: job?.number ?? null,
      body: r?.body ?? "",
      subject: r?.subject ?? null,
      missing: r?.missing ?? [],
      lint: lintTemplate(
        input.key,
        input.channel,
        input.purpose,
        input.body,
        input.subject ?? null,
      ),
    };
  },
});

// ------------------------------------------------------------------ reminders

const ReminderInput = z.object({
  id: id.optional(),
  title: z.string().trim().min(1, "Give it a title.").max(120),
  body: z.string().trim().max(1000).nullable().optional(),
  templateKey: z.string().max(80).nullable().optional(),
  audience: z.discriminatedUnion("type", [
    z.object({ type: z.literal("user"), id: z.string().uuid() }),
    z.object({ type: z.literal("role"), role: z.string().min(1).max(40) }),
    z.object({
      type: z.literal("customer"),
      id: z.string().uuid(),
      purpose: z.enum(["marketing", "transactional"]).default("marketing"),
    }),
  ]),
  channel: z.enum(["push", "email", "sms", "in_app"]),
  recurrence: RecurrenceSchema,
  entityType: z
    .enum(["vehicle", "tool", "customer", "property"])
    .nullable()
    .optional(),
  entityId: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
});

export const saveReminder = action({
  name: "reminders.save",
  perm: "reminders.manage",
  input: ReminderInput,
  audit: "reminder.saved",
  async run({ input, tx, user }) {
    if (
      !input.templateKey &&
      !input.body?.trim() &&
      input.audience.type === "customer"
    )
      throw new ValidationError({
        body: ["Write the message the customer gets."],
      });
    const tz = safeTimeZone((await getCompany()).timezone);
    const next = input.active
      ? nextOccurrence(input.recurrence, new Date(), tz)
      : null;
    if (input.recurrence.type !== "every_n_miles" && input.active && !next)
      throw new ValidationError({
        recurrence: ["That time is already in the past."],
      });
    const values = {
      title: input.title,
      body: input.body || null,
      templateKey: input.templateKey || null,
      audience: input.audience,
      channel: input.channel,
      recurrence: input.recurrence as { type: string; [k: string]: unknown },
      nextAt: next,
      entityType:
        input.recurrence.type === "every_n_miles"
          ? "vehicle"
          : input.audience.type === "customer"
            ? "customer"
            : (input.entityType ?? null),
      entityId:
        input.recurrence.type === "every_n_miles"
          ? input.recurrence.vehicle_id
          : input.audience.type === "customer"
            ? input.audience.id
            : (input.entityId ?? null),
      active: input.active,
      updatedAt: new Date(),
    };
    if (input.id) {
      await tx.update(reminders).set(values).where(eq(reminders.id, input.id));
      return { id: input.id };
    }
    const [row] = await tx
      .insert(reminders)
      .values({ ...values, createdBy: user.id })
      .returning({ id: reminders.id });
    if (!row) throw new Error("insert failed");
    return { id: row.id };
  },
  auditEntity: ({ data }) => ({ type: "reminder", id: data.id }),
  revalidate: () => ["/settings/reminders"],
});

export const deleteReminder = action({
  name: "reminders.delete",
  perm: "reminders.manage",
  input: z.object({ id }),
  audit: "reminder.deleted",
  async run({ input, tx }) {
    await tx.delete(reminders).where(eq(reminders.id, input.id));
    return { ok: true };
  },
  auditEntity: ({ input }) => ({ type: "reminder", id: input.id }),
  revalidate: () => ["/settings/reminders"],
});

export const toggleReminder = action({
  name: "reminders.toggle",
  perm: "reminders.manage",
  input: z.object({ id, active: z.boolean() }),
  audit: "reminder.toggled",
  async run({ input, tx }) {
    const [r] = await tx
      .select()
      .from(reminders)
      .where(eq(reminders.id, input.id))
      .limit(1);
    if (!r) throw new NotFoundError("Reminder");
    const tz = safeTimeZone((await getCompany()).timezone);
    const rec = RecurrenceSchema.safeParse(r.recurrence);
    const next =
      input.active && rec.success
        ? nextOccurrence(rec.data, new Date(), tz)
        : null;
    await tx
      .update(reminders)
      .set({ active: input.active, nextAt: next, updatedAt: new Date() })
      .where(eq(reminders.id, r.id));
    return { ok: true };
  },
  auditEntity: ({ input }) => ({ type: "reminder", id: input.id }),
  revalidate: () => ["/settings/reminders"],
});

/** Recent jobs for the "Preview with a real job" picker. */
export const previewJobs = action({
  name: "automations.preview_jobs",
  perm: "automations.manage",
  input: z.object({}),
  async run({ tx }) {
    return tx
      .select({ id: jobs.id, number: jobs.number, title: jobs.title })
      .from(jobs)
      .orderBy(desc(jobs.updatedAt))
      .limit(15);
  },
});
