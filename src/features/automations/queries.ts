import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  automations,
  customers,
  messageTemplates,
  reminders,
  roles,
  users,
  vehicles,
} from "@/db/schema";
import { templateLabel } from "@/features/messaging/labels";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { ALL_PERMS } from "@/lib/permissions";
import { triggerLabel } from "./event-labels";
import { describeRecurrence, RecurrenceSchema } from "./recurrence";
import {
  ANCHOR_LABELS,
  type AnchorKey,
  type EngineStep,
  formatDelay,
  splitPlus,
  splitTriggers,
} from "./schedule";

// Admin editors' read DAL: automations, templates, custom reminders.

export interface AutomationListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  trigger: string;
  enabled: boolean;
  builtin: boolean;
  featureFlag: string | null;
  audience: "customer" | "team";
  summary: string;
}

function audienceKind(steps: EngineStep[]): "customer" | "team" {
  return steps.some((s) => splitPlus(s.audience).includes("customer"))
    ? "customer"
    : "team";
}

function anchorLabel(anchor: string): string {
  const fixed = /^fixed_time_local\s+(\d{1,2}:\d{2})$/.exec(anchor);
  if (fixed) return `Daily at ${fixed[1]}`;
  return (
    ANCHOR_LABELS[anchor as AnchorKey] ??
    anchor.replace(/^[a-z_]+\./, "").replace(/_/g, " ")
  );
}

function stepSummary(steps: EngineStep[]): string {
  return steps
    .map((s) => {
      const anchor = s.anchor?.split("|")[0]?.trim();
      const delay = formatDelay(s.delay);
      const now = delay === "Immediately";
      let when: string;
      if (anchor?.startsWith("fixed_time_local"))
        when = now
          ? anchorLabel(anchor)
          : `${delay}, ${anchorLabel(anchor).toLowerCase()}`;
      else if (anchor && anchor !== "event_time") {
        const from = anchorLabel(anchor).toLowerCase();
        when = now ? `At ${from}` : `${delay} from ${from}`;
      } else when = s.delay_months_field ? "After N months" : delay;
      return `${when}${s.at ? ` at ${s.at}` : ""}`;
    })
    .join(" · ");
}

export async function listAutomations(): Promise<AutomationListItem[]> {
  await requireUser("automations.manage");
  const rows = await db
    .select()
    .from(automations)
    .orderBy(desc(automations.builtin), asc(automations.name));
  return rows.map((a) => {
    const steps = (a.steps ?? []) as EngineStep[];
    return {
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      // Plain words, never raw event keys (QA T4-26).
      trigger: triggerLabel(splitTriggers(a.triggerEvent).join("|")),
      enabled: a.enabled,
      builtin: a.builtin,
      featureFlag: a.featureFlag,
      audience: audienceKind(steps),
      summary: stepSummary(steps),
    };
  });
}

export async function getAutomationEditor(key: string) {
  const user = await requireUser("automations.manage");
  const [a] = await db
    .select()
    .from(automations)
    .where(eq(automations.key, key))
    .limit(1);
  if (!a) throw new NotFoundError("Automation");
  const [tpls, roleRows] = await Promise.all([
    db
      .selectDistinct({
        key: messageTemplates.key,
        purpose: messageTemplates.purpose,
      })
      .from(messageTemplates)
      .orderBy(asc(messageTemplates.key)),
    db.select({ key: roles.key, name: roles.name }).from(roles),
  ]);
  return {
    automation: {
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      triggerEvent: a.triggerEvent,
      conditions: a.conditions,
      steps: (a.steps ?? []) as EngineStep[],
      cancelOn: a.cancelOn,
      featureFlag: a.featureFlag,
      enabled: a.enabled,
      builtin: a.builtin,
    },
    templates: [
      ...new Map(
        tpls.map((t) => [
          t.key,
          { key: t.key, label: templateLabel(t.key), purpose: t.purpose },
        ]),
      ).values(),
    ],
    roles: roleRows,
    perms: [...ALL_PERMS] as string[],
    isAdmin: user.baseRole === "admin",
  };
}

// ------------------------------------------------------------------ templates

export interface TemplateListItem {
  key: string;
  label: string;
  purpose: string;
  channels: string[];
  edited: boolean;
  staff: boolean;
}

export async function listTemplates(): Promise<TemplateListItem[]> {
  await requireUser("templates.manage");
  const rows = await db
    .select({
      key: messageTemplates.key,
      channel: messageTemplates.channel,
      purpose: messageTemplates.purpose,
      body: messageTemplates.body,
      def: messageTemplates.defaultBody,
    })
    .from(messageTemplates)
    .where(eq(messageTemplates.locale, "en"))
    .orderBy(asc(messageTemplates.key), asc(messageTemplates.channel));
  const map = new Map<string, TemplateListItem>();
  for (const r of rows) {
    const t = map.get(r.key) ?? {
      key: r.key,
      label: templateLabel(r.key),
      purpose: r.purpose,
      channels: [],
      edited: false,
      staff: r.key.startsWith("staff.") || r.purpose === "internal",
    };
    t.channels.push(r.channel);
    if (r.body !== r.def) t.edited = true;
    map.set(r.key, t);
  }
  return [...map.values()];
}

export async function getTemplateEditor(key: string) {
  await requireUser("templates.manage");
  const rows = await db
    .select()
    .from(messageTemplates)
    .where(
      and(eq(messageTemplates.key, key), eq(messageTemplates.locale, "en")),
    )
    .orderBy(asc(messageTemplates.channel));
  if (rows.length === 0) throw new NotFoundError("Template");
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    channel: r.channel,
    purpose: r.purpose,
    subject: r.subject,
    body: r.body,
    defaultBody: r.defaultBody,
    expiresAfterMinutes: r.expiresAfterMinutes,
    allowOutsideQuietHours: r.allowOutsideQuietHours,
    builtin: r.builtin,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}

// ------------------------------------------------------------------ reminders

export interface ReminderItem {
  id: string;
  title: string;
  body: string | null;
  templateKey: string | null;
  audience: {
    type: "user" | "role" | "customer";
    id?: string;
    role?: string;
    purpose?: string;
  };
  audienceLabel: string;
  channel: string;
  recurrence: unknown;
  recurrenceLabel: string;
  nextAt: string | null;
  lastAt: string | null;
  entityType: string | null;
  entityId: string | null;
  active: boolean;
}

export async function listReminders(): Promise<{
  items: ReminderItem[];
  users: { id: string; name: string }[];
  roles: { key: string; name: string }[];
  vehicles: { id: string; name: string }[];
}> {
  await requireUser("reminders.manage");
  const [rows, people, roleRows, vans] = await Promise.all([
    db
      .select()
      .from(reminders)
      .orderBy(desc(reminders.active), asc(reminders.nextAt)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(ne(users.status, "deactivated"))
      .orderBy(asc(users.name)),
    db.select({ key: roles.key, name: roles.name }).from(roles),
    db
      .select({ id: vehicles.id, name: vehicles.nickname })
      .from(vehicles)
      .orderBy(asc(vehicles.nickname)),
  ]);
  const custIds = rows
    .map((r) =>
      r.audience.type === "customer" ? (r.audience.id ?? null) : null,
    )
    .filter((x): x is string => !!x);
  const custs = custIds.length
    ? await db
        .select({ id: customers.id, name: customers.displayName })
        .from(customers)
        .where(inArray(customers.id, custIds))
    : [];
  return {
    items: rows.map((r) => {
      const a = r.audience;
      const audienceLabel =
        a.type === "user"
          ? (people.find((p) => p.id === a.id)?.name ?? "Team member")
          : a.type === "role"
            ? `Everyone: ${roleRows.find((x) => x.key === a.role)?.name ?? a.role}`
            : (custs.find((c) => c.id === a.id)?.name ?? "Customer");
      const rec = RecurrenceSchema.safeParse(r.recurrence);
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        templateKey: r.templateKey,
        audience: a,
        audienceLabel,
        channel: r.channel,
        recurrence: r.recurrence,
        recurrenceLabel: rec.success
          ? describeRecurrence(rec.data)
          : "Invalid schedule",
        nextAt: r.nextAt?.toISOString() ?? null,
        lastAt: r.lastAt?.toISOString() ?? null,
        entityType: r.entityType,
        entityId: r.entityId,
        active: r.active,
      };
    }),
    users: people,
    roles: roleRows,
    vehicles: vans.map((v) => ({ id: v.id, name: v.name })),
  };
}
