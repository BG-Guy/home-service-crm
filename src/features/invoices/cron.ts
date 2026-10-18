// Cron hooks for `invoices` (BUILD_PLAN §4, §8.1). Owner: B3.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import { sql } from "drizzle-orm";
import { db, execRows } from "@/db";
import { writeActivity } from "@/lib/activity";
import type { CronHook } from "@/lib/cron";
import { emit } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/types";
import { daysPastDue, isOverdueMilestone, overdueCutoff } from "./math";

export { calendarDaysBetween } from "./math";

/**
 * `invoices.overdue`: for issued / partially paid invoices past due with a balance,
 * emit `invoice.overdue` on days 1, 3, 7, 14, 30 and every 30 after. Idempotent:
 * the activity row (kind invoice.overdue, data.days_overdue) is written in the same
 * transaction and checked first, so a re-run on the same day emits nothing.
 */
export async function runInvoicesOverdue(now: Date): Promise<number> {
  const tz = await getCompanyTimezone();
  const rows = await execRows<{
    id: string;
    number: string;
    customer_id: string;
    job_id: string | null;
    due_at: Date | string;
    balance: string | number;
  }>(sql`
    select i.id, i.number, i.customer_id, i.job_id, i.due_at,
      (i.total_cents - coalesce(b.paid_cents,0) + coalesce(b.refunded_cents,0) - coalesce(b.credited_cents,0)) as balance
    from invoices i
    left join invoice_balances b on b.invoice_id = i.id
    where i.status in ('issued','partially_paid') and i.due_at < ${overdueCutoff(now, tz)}
    order by i.due_at limit 2000`);
  let emitted = 0;
  for (const r of rows) {
    const balance = Number(r.balance);
    if (balance <= 0) continue;
    const days = daysPastDue(new Date(r.due_at), now, tz);
    if (!isOverdueMilestone(days)) continue;
    const did = await db.transaction(async (tx) => {
      const seen = await execRows<{ n: number }>(
        sql`select count(*)::int as n from activity
            where entity_type = 'invoice' and entity_id = ${r.id}
              and kind = 'invoice.overdue' and (data->>'days_overdue')::int = ${days}`,
        tx,
      );
      if (Number(seen[0]?.n ?? 0) > 0) return false;
      const entity = { type: "invoice", id: r.id } as const;
      await emit(
        tx,
        "invoice.overdue",
        entity,
        { invoice_id: r.id, days_overdue: days },
        { actor: SYSTEM_ACTOR },
      );
      await writeActivity(tx, {
        entity,
        customerId: r.customer_id,
        jobId: r.job_id,
        kind: "invoice.overdue",
        summary: `Invoice ${r.number} is ${days} day${days === 1 ? "" : "s"} past due · ${formatMoney(balance)}`,
        data: { days_overdue: days, balance_cents: balance },
        actorUserId: null,
      });
      return true;
    });
    if (did) emitted++;
  }
  return emitted;
}

export const cronHooks: CronHook[] = [
  {
    key: "invoices.overdue",
    schedule: { dailyAt: "06:00" },
    async run({ now }) {
      await runInvoicesOverdue(now);
    },
  },
];
