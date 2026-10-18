import "server-only";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { automations, reminders, users } from "@/db/schema";
import { enqueueCore } from "@/features/messaging/enqueue";
import { getVehicleOdometer } from "@/features/vehicles/api";
import { emit } from "@/lib/events";
import { getCompany } from "@/lib/settings";
import { dateKey, safeTimeZone } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";
import { techAgenda } from "./context";
import { milesDue, nextOccurrence, RecurrenceSchema } from "./recurrence";
import { dedupeKeyFor, type EngineStep, splitPlus } from "./schedule";

// Custom reminders (SPEC M13) and fixed-time automations.
//  - `reminders.due` cron (every 5 min): due rows emit `reminder.due` and advance
//    next_at in the same transaction; mileage reminders compare the vehicle odometer
//    (B7 getVehicleOdometer) against the stored base reading.
//  - `reminder.due` handler: deliver through enqueueMessage (customer reminders still
//    pass consent, quiet hours and caps — they default to the marketing purpose ⚖️).
//  - `automations.fixed_time` cron (00:05): schedules the next `fixed_time_local` sends,
//    deduped per local send date (built-in: tech_daily_agenda at 07:00, only for techs
//    with a job that day).

type ReminderRow = typeof reminders.$inferSelect;

async function companyTz(): Promise<string> {
  return safeTimeZone((await getCompany()).timezone);
}

/** Emit `reminder.due` for every due reminder and advance it. Returns how many fired. */
export async function runDueReminders(now: Date = new Date()): Promise<number> {
  const tz = await companyTz();
  let fired = 0;
  // Timed reminders.
  const due = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.active, true),
        isNotNull(reminders.nextAt),
        lte(reminders.nextAt, now),
      ),
    )
    .limit(200);
  for (const r of due) {
    await db.transaction(async (tx) => {
      const parsed = RecurrenceSchema.safeParse(r.recurrence);
      const next = parsed.success ? nextOccurrence(parsed.data, now, tz) : null;
      await tx
        .update(reminders)
        .set({
          lastAt: now,
          nextAt: next,
          active: next !== null || parsed.data?.type === "every_n_miles",
          updatedAt: now,
        })
        .where(eq(reminders.id, r.id));
      await emit(
        tx,
        "reminder.due",
        { type: "reminder", id: r.id },
        { reminder_id: r.id },
        { actor: SYSTEM_ACTOR },
      );
    });
    fired++;
  }
  // Mileage reminders (no next_at; checked against the odometer).
  const mileage = await db
    .select()
    .from(reminders)
    .where(eq(reminders.active, true));
  for (const r of mileage) {
    const parsed = RecurrenceSchema.safeParse(r.recurrence);
    if (!parsed.success || parsed.data.type !== "every_n_miles") continue;
    const rec = parsed.data;
    let odo: number | null = null;
    try {
      odo = await getVehicleOdometer(rec.vehicle_id);
    } catch {
      odo = null;
    }
    if (odo === null) continue;
    if (rec.base_odometer === null || rec.base_odometer === undefined) {
      // First reading becomes the base.
      await db
        .update(reminders)
        .set({ recurrence: { ...rec, base_odometer: odo }, updatedAt: now })
        .where(eq(reminders.id, r.id));
      continue;
    }
    if (!milesDue(rec, odo)) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(reminders)
        .set({
          recurrence: { ...rec, base_odometer: odo },
          lastAt: now,
          updatedAt: now,
        })
        .where(eq(reminders.id, r.id));
      await emit(
        tx,
        "reminder.due",
        { type: "reminder", id: r.id },
        { reminder_id: r.id },
        { actor: SYSTEM_ACTOR },
      );
    });
    fired++;
  }
  return fired;
}

/** Recipients of a reminder audience: users (user / role) or one customer. */
async function reminderRecipients(
  tx: Tx,
  r: ReminderRow,
): Promise<
  | { type: "user"; userId: string }[]
  | { type: "customer"; customerId: string }[]
> {
  const a = r.audience;
  if (a.type === "customer") {
    const id = a.id ?? (r.entityType === "customer" ? r.entityId : null);
    return id ? [{ type: "customer", customerId: id }] : [];
  }
  if (a.type === "user") return a.id ? [{ type: "user", userId: a.id }] : [];
  if (a.type === "role" && a.role) {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, a.role), eq(users.status, "active")));
    return rows.map((u) => ({ type: "user" as const, userId: u.id }));
  }
  return [];
}

/** `reminder.due` handler body: one message per recipient (idempotent per firing). */
export async function deliverReminder(
  tx: Tx,
  reminderId: string,
  eventId: number,
  /** The event pass's clock (tick `now`): an immediate send is due then (T6-14). */
  now: Date = new Date(),
): Promise<number> {
  const [r] = await tx
    .select()
    .from(reminders)
    .where(eq(reminders.id, reminderId))
    .limit(1);
  if (!r) return 0;
  const list = await reminderRecipients(tx, r);
  const purpose =
    r.audience.purpose === "transactional"
      ? "transactional"
      : r.audience.type === "customer"
        ? "marketing"
        : "internal";
  let n = 0;
  for (const rec of list) {
    const isUser = rec.type === "user";
    const recipient = isUser ? rec.userId : rec.customerId;
    const channel =
      isUser && (r.channel === "sms" || r.channel === "whatsapp")
        ? "push"
        : r.channel;
    await enqueueCore(
      tx,
      {
        templateKey: r.templateKey ?? undefined,
        body: r.templateKey
          ? undefined
          : [r.title, r.body].filter(Boolean).join(isUser ? "\n" : ": "),
        subject: r.title,
        channel: channel as never,
        purpose: purpose as never,
        audience: isUser
          ? { type: "user", userId: recipient }
          : { type: "customer", customerId: recipient },
        entity:
          r.entityType && r.entityId
            ? ({ type: r.entityType, id: r.entityId } as never)
            : { type: "reminder", id: r.id },
        dedupeKey: `reminder:${r.id}:e${eventId}:${recipient}`,
      },
      SYSTEM_ACTOR,
      now,
    );
    n++;
  }
  return n;
}

/**
 * Schedule the next fixed-time sends (trigger `schedule.daily`). Each send is keyed by
 * the LOCAL DATE OF ITS SEND TIME (QA2): a late run (e.g. 21:00 piggy-back) that
 * schedules tomorrow's 07:00 agenda and the 00:05 run that schedules the same 07:00
 * dedupe to one message. A run less than an hour after HH:MM still sends today's.
 */
export async function scheduleFixedTime(
  now: Date = new Date(),
): Promise<number> {
  const tz = await companyTz();
  const autos = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.enabled, true),
        eq(automations.triggerEvent, "schedule.daily"),
      ),
    );
  let created = 0;
  for (const a of autos) {
    const steps = (a.steps ?? []) as EngineStep[];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;
      const m = /fixed_time_local\s+(\d{1,2}:\d{2})/.exec(step.anchor ?? "");
      const time = m?.[1] ?? step.at ?? "07:00";
      const { computeSendAt } = await import("./schedule");
      // The next HH:MM after "an hour ago": today's while it's < 1 h late, else
      // tomorrow's (a missed morning is skipped, never sent late).
      const { sendAt } = computeSendAt({
        step: { anchor: `fixed_time_local ${time}` },
        eventAt: new Date(now.getTime() - 3600_000),
        timeZone: tz,
      });
      if (!sendAt) continue;
      const sendDay = dateKey(sendAt, tz);
      for (const token of splitPlus(step.audience)) {
        const role = token.startsWith("role:") ? token.slice(5) : null;
        if (!role) continue;
        const people = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, role), eq(users.status, "active")));
        for (const u of people) {
          if (step.template_key === "staff.daily_agenda") {
            // The agenda of the day it's sent on, not of the run's day.
            const ag = await techAgenda(u.id, sendAt, tz);
            if (ag.count === 0) continue;
          }
          for (const channel of splitPlus(step.channel)) {
            await db.transaction((tx) =>
              enqueueCore(
                tx,
                {
                  templateKey: step.template_key,
                  channel: channel as never,
                  audience: { type: "user", userId: u.id },
                  sendAt: sendAt.getTime() < now.getTime() ? now : sendAt,
                  dedupeKey: dedupeKeyFor({
                    automationKey: a.key,
                    entityId: sendDay,
                    stepIndex: i,
                    recipient: u.id,
                    channel,
                    step: { anchor: "event_time" },
                    anchorAt: null,
                    eventId: sendDay,
                    now,
                  }),
                  automationId: a.id,
                  stepIndex: i,
                },
                SYSTEM_ACTOR,
                now,
              ),
            );
            created++;
          }
        }
      }
    }
  }
  return created;
}
