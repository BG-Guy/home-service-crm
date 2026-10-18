// Cron hooks for `payroll` (BUILD_PLAN §4, §8.1). Owner: B6.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import "server-only";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, withTx } from "@/db";
import { payments, roles, settlements, users } from "@/db/schema";
import { notify } from "@/features/notify/api";
import type { CronHook } from "@/lib/cron";
import { formatMoney } from "@/lib/money";
import { SYSTEM_ACTOR } from "@/lib/types";
import { checkCashLimits } from "./server/cash";
import { closeDuePeriods, ensureCurrentPeriods } from "./server/periods";
import type { SettlementTotalsJson } from "./server/settlements";
import { settingsOf } from "./server/util";

async function payrollOn(): Promise<boolean> {
  const s = await settingsOf();
  return s.features.payroll !== false;
}

export const cronHooks: CronHook[] = [
  {
    key: "payroll.periods",
    schedule: { dailyAt: "00:15" },
    async run({ now }) {
      if (!(await payrollOn())) return;
      await withTx((tx) => ensureCurrentPeriods(tx, now));
    },
  },
  {
    key: "payroll.close",
    schedule: { everyMinutes: 60 },
    async run({ now }) {
      if (!(await payrollOn())) return;
      await withTx(async (tx) => {
        await ensureCurrentPeriods(tx, now);
        await closeDuePeriods(tx, SYSTEM_ACTOR, now);
      });
    },
  },
  {
    // Tech review window (48 h) over → tell approvers the statement is ready (once).
    key: "payroll.review_deadline",
    schedule: { everyMinutes: 60 },
    async run({ now }) {
      if (!(await payrollOn())) return;
      const due = await db
        .select({
          id: settlements.id,
          userId: settlements.userId,
          name: users.name,
          totals: settlements.totals,
          closing: settlements.closingBalanceCents,
        })
        .from(settlements)
        .innerJoin(users, eq(users.id, settlements.userId))
        .where(
          and(
            eq(settlements.status, "tech_review"),
            isNotNull(settlements.reviewDeadline),
            lt(settlements.reviewDeadline, now),
            sql`not coalesce((${settlements.totals}->>'review_deadline_notified')::boolean, false)`,
          ),
        );
      if (due.length === 0) return;
      await withTx(async (tx) => {
        for (const s of due) {
          const totals = {
            ...(s.totals as SettlementTotalsJson),
            review_deadline_notified: true,
          };
          await tx
            .update(settlements)
            .set({ totals, updatedAt: new Date() })
            .where(eq(settlements.id, s.id));
        }
        await notify(tx, {
          to: { perm: "payroll.approve" },
          type: "staff.generic",
          title:
            due.length === 1
              ? `${due[0]?.name}'s statement is ready to approve`
              : `${due.length} pay statements are ready to approve`,
          body:
            due.length === 1
              ? `Review window closed · ${formatMoney(due[0]?.closing ?? 0)}`
              : "The 48-hour tech review window has closed.",
          url: "/pay/settlements?status=tech_review",
        });
      });
    },
  },
  {
    key: "payroll.cash_alerts",
    schedule: { dailyAt: "08:00" },
    async run({ now }) {
      if (!(await payrollOn())) return;
      const holders = await db
        .selectDistinct({ id: payments.collectedByUserId })
        .from(payments)
        .innerJoin(users, eq(users.id, payments.collectedByUserId))
        .innerJoin(roles, eq(roles.key, users.role))
        .where(
          and(
            isNotNull(payments.collectedByUserId),
            sql`${payments.method} in ('cash','check')`,
            eq(users.status, "active"),
          ),
        );
      const ids = holders.map((h) => h.id).filter((x): x is string => !!x);
      if (ids.length === 0) return;
      await withTx((tx) => checkCashLimits(tx, ids, SYSTEM_ACTOR, now));
    },
  },
];
