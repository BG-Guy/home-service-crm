import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { payPeriods } from "@/db/schema";
import { addDaysToKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { nextPeriod, periodFor } from "../engine";
import { periodRowFor } from "./ledger";
import { closePayPeriod } from "./settlements";
import { companyTz, settingsOf, todayKey } from "./util";

/** Ensure the current and next pay periods exist (cron payroll.periods). */
export async function ensureCurrentPeriods(
  tx: Tx,
  now = new Date(),
): Promise<void> {
  const tz = await companyTz(tx);
  const s = await settingsOf(tx);
  const cfg = {
    period: s.payroll.period,
    weekStartsOn: s.payroll.week_starts_on,
    biweeklyAnchor: s.payroll.biweekly_anchor,
  };
  const today = todayKey(tz, now);
  const cur = periodFor(today, cfg);
  await periodRowFor(tx, cur.startsOn);
  await periodRowFor(tx, nextPeriod(cur, cfg).startsOn);
}

/** Close every open period whose end + close_delay_hours has passed (cron payroll.close). */
export async function closeDuePeriods(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<string[]> {
  const tz = await companyTz(tx);
  const s = await settingsOf(tx);
  const today = todayKey(tz, now);
  const open = await tx
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.status, "open"), lte(payPeriods.endsOn, today)))
    .orderBy(asc(payPeriods.startsOn));
  const closed: string[] = [];
  for (const p of open) {
    const endUtc = zonedTimeToUtc(parseDateKey(addDaysToKey(p.endsOn, 1)), tz);
    if (
      endUtc.getTime() + s.payroll.close_delay_hours * 3_600_000 >
      now.getTime()
    )
      continue;
    if (await closePayPeriod(tx, p.id, actor, now)) closed.push(p.id);
  }
  return closed;
}
