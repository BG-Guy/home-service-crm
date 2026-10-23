// Cron hooks for `leads` (BUILD_PLAN §4, §8.1). Owner: B1.
import { sql } from "drizzle-orm";
import { db, execRows } from "@/db";
import { leadEvents } from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import type { CronHook } from "@/lib/cron";
import { emit } from "@/lib/events";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/types";
import { runMapBackfill } from "./map-backfill";
import { SLA_THRESHOLDS, slaMinutes } from "./sla";

/**
 * `leads.sla`: emit `lead.sla_breached` once per lead per threshold (5 and 15 min)
 * for unanswered `new` leads. Idempotent via a `lead_events(kind='sla_breached',
 * outcome='<minutes>')` row written in the same transaction as the event.
 */
export async function runLeadSla(now: Date): Promise<number> {
  const s = await getSettings();
  const tz = await getCompanyTimezone();
  const rows = await execRows<{
    id: string;
    created_at: Date | string;
    customer_id: string | null;
    done: string[] | null;
  }>(sql`
    select l.id, l.created_at, l.customer_id,
      (select array_agg(e.outcome) from lead_events e
        where e.lead_id = l.id and e.kind = 'sla_breached') as done
    from leads l
    where l.status = 'new' and l.first_response_at is null and not l.is_test
      and l.spam_score < ${s.leads.spam_review_threshold}
      and l.created_at > ${new Date(now.getTime() - 7 * 86_400_000)}
      and l.created_at < ${new Date(now.getTime() - SLA_THRESHOLDS[0] * 60_000)}
    order by l.created_at limit 500`);
  let emitted = 0;
  for (const r of rows) {
    const done = new Set(r.done ?? []);
    if (done.size >= SLA_THRESHOLDS.length) continue;
    const elapsed = slaMinutes(new Date(r.created_at), now, {
      businessHoursOnly: s.leads.sla_business_hours,
      hours: s.company.business_hours,
      tz,
    });
    for (const t of SLA_THRESHOLDS) {
      if (elapsed < t || done.has(String(t))) continue;
      await db.transaction(async (tx) => {
        const ins = await tx
          .insert(leadEvents)
          .values({ leadId: r.id, kind: "sla_breached", outcome: String(t) })
          .returning({ id: leadEvents.id });
        if (!ins[0]) return;
        await emit(
          tx,
          "lead.sla_breached",
          { type: "lead", id: r.id },
          { lead_id: r.id, minutes: t },
          { actor: SYSTEM_ACTOR },
        );
        await writeActivity(tx, {
          entity: { type: "lead", id: r.id },
          customerId: r.customer_id,
          kind: "lead.sla_breached",
          summary: `No response after ${t} min`,
          actorUserId: null,
        });
      });
      emitted++;
    }
  }
  return emitted;
}

export const cronHooks: CronHook[] = [
  {
    key: "leads.sla",
    schedule: { everyMinutes: 1 },
    async run({ now }) {
      await runLeadSla(now);
    },
  },
  {
    // Open leads with an address get a property (and its geocode job), so they
    // show on the lead map (map-backfill.ts).
    key: "leads.map_backfill",
    schedule: { everyMinutes: 10 },
    async run({ now }) {
      await runMapBackfill(now);
    },
  },
];
