// Demo seed fragment for `notify` (BUILD_PLAN §10.3 #16). Owner: B5.
// A few unread notifications per user and two custom reminders ("Monday 8:00 fuel
// receipts" for techs; a yearly service reminder for one customer, from the profile).
// Writes only B5 tables; never emits events.
import { inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { customers, notifications, reminders } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import {
  nextOccurrence,
  type Recurrence,
} from "@/features/automations/recurrence";
import { formatMoney } from "@/lib/money";
import { addDaysToKey, dateKey } from "@/lib/time";

const MIN = 60_000;

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  const uid = (k: string) => plan.users.find((u) => u.key === k)?.id;
  const job = (n: number) => plan.jobs[n - 1];
  const lead = (n: number) => plan.leads[n - 1];
  const ago = (m: number) => new Date(ctx.now.getTime() - m * MIN);
  const rows: (typeof notifications.$inferInsert)[] = [];
  const add = (
    key: string,
    user: string | undefined,
    n: Omit<typeof notifications.$inferInsert, "userId" | "id">,
  ) => {
    if (user)
      rows.push({ id: seedId("notification", key), userId: user, ...n });
  };

  const l9 = lead(9);
  const l10 = lead(10);
  for (const who of ["admin", "office"]) {
    if (l9)
      add(`${who}-lead9`, uid(who), {
        type: "staff.new_lead",
        title: `New lead: ${l9.service}`,
        body: `${l9.name} via ${l9.sourceKey.replace("_", " ")} — call within 5 minutes.`,
        url: `/leads/${l9.id}`,
        entityType: "lead",
        entityId: l9.id,
        priority: "high",
        createdAt: ago(2),
      });
    if (l10)
      add(`${who}-lead10`, uid(who), {
        type: "staff.lead_sla",
        title: "Lead waiting 5 min",
        body: `${l10.name} hasn't been contacted yet.`,
        url: `/leads/${l10.id}`,
        entityType: "lead",
        entityId: l10.id,
        createdAt: ago(1),
      });
  }
  const j12 = job(12);
  if (j12)
    add("admin-dispute", uid("admin"), {
      type: "staff.dispute",
      title: `Chargeback opened: ${formatMoney(j12.dispute?.amountCents ?? j12.totals.totalCents, { compactWhole: true })}`,
      body: `${j12.number} — respond within 5 days. The evidence pack is ready to review.`,
      url: "/disputes",
      priority: "high",
      createdAt: ago(60 * 26),
    });
  const j7 = job(7);
  if (j7)
    add("admin-lowrating", uid("admin"), {
      type: "staff.low_rating",
      title: "Low rating: 2 of 5",
      body: `${j7.number} — the customer asked for a call back.`,
      url: `/jobs/${j7.id}`,
      entityType: "job",
      entityId: j7.id,
      createdAt: ago(60 * 30),
    });
  add("office-outbox", uid("office"), {
    type: "staff.outbox_ready",
    title: "4 customer texts ready",
    body: "Open the outbox and tap Send for each one.",
    url: "/messages/outbox",
    createdAt: ago(10),
  });
  const j77 = job(77);
  if (j77)
    add("office-unconfirmed", uid("office"), {
      type: "staff.unconfirmed",
      title: "2 jobs unconfirmed for tomorrow",
      body: `${j77.number} and ${job(78)?.number ?? ""} haven't confirmed yet.`,
      url: "/jobs?unconfirmed=1",
      createdAt: ago(60 * 3),
    });
  const j71 = job(71);
  if (j71)
    add("tech1-assigned", uid("tech1"), {
      type: "staff.job_assigned",
      title: `New job: ${j71.number}`,
      body: `${j71.title} this afternoon.`,
      url: `/jobs/${j71.id}`,
      entityType: "job",
      entityId: j71.id,
      createdAt: ago(60 * 5),
    });
  for (const t of ["tech1", "tech2", "tech3"])
    add(`${t}-agenda`, uid(t), {
      type: "staff.daily_agenda",
      title: "Today: 3 jobs",
      body: "First stop at 8 AM. Tap to see your day.",
      url: "/today",
      createdAt: ago(60 * 3),
      readAt: t === "tech3" ? ago(60 * 2) : null,
    });
  const j76 = job(76);
  if (j76)
    add("tech3-start", uid("tech3"), {
      type: "staff.start_decided",
      title: "Waiting for start approval",
      body: `${j76.number} needs an admin to approve before you start.`,
      url: `/jobs/${j76.id}`,
      entityType: "job",
      entityId: j76.id,
      createdAt: ago(40),
    });
  if (rows.length)
    await db.insert(notifications).values(rows).onConflictDoNothing();

  // Custom reminders.
  const weekly: Recurrence = { type: "weekly", days: [1], time: "08:00" };
  const c5 = plan.customers[4];
  const [c5Row] = c5
    ? await db
        .select({ id: customers.id })
        .from(customers)
        .where(inArray(customers.id, [c5.id]))
    : [];
  const start = addDaysToKey(dateKey(ctx.now, ctx.tz), -330);
  const yearly: Recurrence = {
    type: "every_n_months",
    n: 12,
    time: "10:00",
    start,
  };
  const values: (typeof reminders.$inferInsert)[] = [
    {
      id: seedId("reminder", "fuel-receipts"),
      title: "Upload this week's fuel receipts",
      body: "Snap any fuel or parts receipts from last week so you get reimbursed on time.",
      audience: { type: "role", role: "tech" },
      channel: "push",
      recurrence: weekly,
      nextAt: nextOccurrence(weekly, ctx.now, ctx.tz),
      active: true,
      createdBy: uid("admin") ?? null,
    },
  ];
  if (c5Row && c5)
    values.push({
      id: seedId("reminder", "dryer-vent"),
      title: ctx.profile.notify.reminder.title,
      body: ctx.profile.notify.reminder.body(c5.firstName),
      audience: { type: "customer", id: c5.id, purpose: "marketing" } as never,
      channel: "sms",
      recurrence: yearly,
      nextAt: nextOccurrence(yearly, ctx.now, ctx.tz),
      entityType: "customer",
      entityId: c5.id,
      active: true,
      createdBy: uid("office") ?? null,
    });
  await db.insert(reminders).values(values).onConflictDoNothing();
  ctx.log(`notifications ${rows.length}, reminders ${values.length}`);
}
