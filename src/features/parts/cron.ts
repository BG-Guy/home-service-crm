// Cron hooks for `parts` (BUILD_PLAN §4, §8.1). Owner: B6.
// Run by /api/cron/tick in the company time zone; at most one run per window.
import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, withTx } from "@/db";
import { approvals, partPurchases, stockLocations, tasks } from "@/db/schema";
import { notify } from "@/features/notify/api";
import { settingsOf } from "@/features/payroll/server/util";
import { createTask } from "@/features/tasks/api";
import type { CronHook } from "@/lib/cron";
import { SYSTEM_ACTOR } from "@/lib/types";
import { ensureLocations } from "./server/inventory";

export const cronHooks: CronHook[] = [
  {
    // ⚖️ Accountable plan: tech-paid receipts still pending after N days are flagged
    // on their approval (and approvers are told once).
    key: "parts.stale_receipts",
    schedule: { dailyAt: "06:30" },
    async run({ now }) {
      const s = await settingsOf();
      if (!s.features.parts) return;
      const cutoff = new Date(
        now.getTime() - s.parts.stale_receipt_days * 86_400_000,
      );
      const stale = await db
        .select({ id: partPurchases.id })
        .from(partPurchases)
        .where(
          and(
            eq(partPurchases.paidBy, "tech"),
            eq(partPurchases.status, "pending"),
            lt(partPurchases.createdAt, cutoff),
          ),
        );
      if (stale.length === 0) return;
      const rows = await db
        .select({ id: approvals.id, evidence: approvals.evidence })
        .from(approvals)
        .where(
          and(
            eq(approvals.entityType, "part_purchase"),
            eq(approvals.status, "pending"),
            inArray(
              approvals.entityId,
              stale.map((x) => x.id),
            ),
          ),
        );
      const fresh = rows.filter(
        (r) => !((r.evidence ?? {}) as { stale?: boolean }).stale,
      );
      if (fresh.length === 0) return;
      await withTx(async (tx) => {
        for (const r of fresh) {
          const ev = (r.evidence ?? {}) as Record<string, unknown>;
          const flags = Array.isArray(ev.flags) ? (ev.flags as string[]) : [];
          await tx
            .update(approvals)
            .set({
              evidence: {
                ...ev,
                stale: true,
                clean: false,
                flags: [...new Set([...flags, "stale_receipt"])],
              },
            })
            .where(eq(approvals.id, r.id));
        }
        await notify(tx, {
          to: { perm: "parts.approve_reimbursement" },
          type: "staff.generic",
          title: `${fresh.length} receipt${fresh.length === 1 ? "" : "s"} waiting over ${s.parts.stale_receipt_days} days`,
          body: "Reimbursements under an accountable plan must be settled promptly.",
          url: "/approvals?kind=part_purchase",
        });
      });
    },
  },
  {
    // Monthly cycle count (inventory flag): one count task per location, office queue.
    key: "inventory.cycle_count",
    schedule: { monthlyAt: { day: 1, time: "06:00" } },
    async run() {
      const s = await settingsOf();
      if (!s.features.inventory) return;
      await withTx(async (tx) => {
        await ensureLocations(tx);
        const locs = await tx
          .select({ id: stockLocations.id, name: stockLocations.name })
          .from(stockLocations)
          .where(eq(stockLocations.active, true));
        for (const l of locs) {
          const [open] = await tx
            .select({ id: tasks.id })
            .from(tasks)
            .where(
              and(
                eq(tasks.status, "open"),
                eq(tasks.entityType, "stock_location"),
                eq(tasks.entityId, l.id),
                sql`${tasks.payload}->>'cycle_count' = 'true'`,
              ),
            )
            .limit(1);
          if (open) continue;
          await createTask(
            tx,
            {
              kind: "custom",
              title: `Monthly stock count: ${l.name}`,
              body: "Count every item and enter the totals on Inventory → Count.",
              payload: { cycle_count: true, location_id: l.id },
              assigneeUserId: s.inventory.restock_assignee_user_id,
              entity: { type: "stock_location", id: l.id },
              dueAt: new Date(Date.now() + 3 * 86_400_000),
            },
            SYSTEM_ACTOR,
          );
        }
      });
    },
  },
];
