import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashRemittances, events } from "@/db/schema";
import { attachMedia } from "@/features/media/api";
import { writeActivity } from "@/lib/activity";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { startOfDayInTz } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { custodyAlert, effectiveCash } from "../engine";
import { creditForRemittance, custodyFor } from "./custody";
import { insertPostings } from "./ledger";
import { techPlans } from "./plans";
import { companyTz, emitB6, todayKey } from "./util";

/** Tech records a deposit or hand-in (slip photo) → pending until the office confirms. */
export async function recordRemittance(
  tx: Tx,
  input: {
    userId: string;
    amountCents: number;
    method: "bank_deposit" | "hand_in";
    proofMediaId?: string | null;
    clientId?: string | null;
  },
  actor: Actor,
): Promise<{ remittanceId: string }> {
  if (input.clientId) {
    const [prior] = await tx
      .select({ id: cashRemittances.id })
      .from(cashRemittances)
      .where(eq(cashRemittances.clientId, input.clientId))
      .limit(1);
    if (prior) return { remittanceId: prior.id };
  }
  const [row] = await tx
    .insert(cashRemittances)
    .values({
      userId: input.userId,
      amountCents: input.amountCents,
      method: input.method,
      proofMediaId: input.proofMediaId ?? null,
      clientId: input.clientId ?? null,
    })
    .returning({ id: cashRemittances.id });
  if (!row) throw new Error("remittance insert failed");
  if (input.proofMediaId)
    await attachMedia(tx, [input.proofMediaId], {
      type: "cash_remittance",
      id: row.id,
    });
  await emitB6(
    tx,
    "cash.remitted",
    { type: "cash_remittance", id: row.id },
    { remittance_id: row.id, user_id: input.userId },
    { actor },
  );
  await writeActivity(tx, {
    entity: { type: "user", id: input.userId },
    kind: "cash.remitted",
    summary: `${input.method === "bank_deposit" ? "Deposited" : "Handed in"} ${formatMoney(input.amountCents)} cash`,
    data: { remittance_id: row.id },
    actorUserId: actor.userId,
  });
  return { remittanceId: row.id };
}

/** Office confirms (cash.receive). Net-in-payout techs get the netted cash credited back. */
export async function decideRemittance(
  tx: Tx,
  remittanceId: string,
  decision: "confirmed" | "disputed",
  actor: Actor,
): Promise<void> {
  const [r] = await tx
    .select()
    .from(cashRemittances)
    .where(eq(cashRemittances.id, remittanceId))
    .for("update")
    .limit(1);
  if (!r) throw new NotFoundError("Remittance");
  if (r.status !== "pending")
    throw new ConflictError(
      "already_decided",
      "This hand-in was already confirmed.",
    );
  const now = new Date();
  let ledgerEntryId: string | null = null;
  if (decision === "confirmed") {
    const credit = await creditForRemittance(tx, r.userId, r.id, r.amountCents);
    if (credit > 0) {
      const tz = await companyTz(tx);
      const today = todayKey(tz);
      [ledgerEntryId = null] = await insertPostings(
        tx,
        [
          {
            userId: r.userId,
            type: "cash_remitted",
            amountCents: credit,
            wageClass: "custody",
            memo: "Cash handed in (already deducted from pay), credited back",
          },
        ],
        {
          effectiveDate: today,
          refTable: "cash_remittances",
          refId: r.id,
          actorUserId: actor.userId,
          today,
        },
      );
    }
  }
  await tx
    .update(cashRemittances)
    .set({
      status: decision,
      receivedBy: actor.userId,
      receivedAt: now,
      ledgerEntryId,
      updatedAt: now,
    })
    .where(eq(cashRemittances.id, r.id));
  if (decision === "confirmed")
    await emitB6(
      tx,
      "cash.received",
      { type: "cash_remittance", id: r.id },
      { remittance_id: r.id, user_id: r.userId },
      { actor },
    );
  await writeActivity(tx, {
    entity: { type: "user", id: r.userId },
    kind: decision === "confirmed" ? "cash.received" : "cash.disputed",
    summary:
      decision === "confirmed"
        ? `Office confirmed ${formatMoney(r.amountCents)} received`
        : `Office disputed a ${formatMoney(r.amountCents)} hand-in`,
    data: { remittance_id: r.id },
    actorUserId: actor.userId,
  });
}

/** End-of-day count (S44): a difference emits cash.discrepancy_declared. */
export async function declareCashCount(
  tx: Tx,
  input: { userId: string; declaredCents: number; note?: string | null },
  actor: Actor,
): Promise<{ systemCents: number; discrepancy: boolean }> {
  const custody = (await custodyFor([input.userId], tx))[input.userId];
  const system = custody?.heldCents ?? 0;
  const discrepancy = system !== input.declaredCents;
  if (discrepancy)
    await emitB6(
      tx,
      "cash.discrepancy_declared",
      { type: "user", id: input.userId },
      {
        user_id: input.userId,
        system_cents: system,
        declared_cents: input.declaredCents,
      },
      { actor },
    );
  await writeActivity(tx, {
    entity: { type: "user", id: input.userId },
    kind: discrepancy ? "cash.discrepancy_declared" : "cash.count_confirmed",
    summary: discrepancy
      ? `Cash count ${formatMoney(input.declaredCents)} vs system ${formatMoney(system)}${input.note ? `: ${input.note.slice(0, 120)}` : ""}`
      : `Cash count confirmed (${formatMoney(system)})`,
    data: { system_cents: system, declared_cents: input.declaredCents },
    actorUserId: actor.userId,
  });
  return { systemCents: system, discrepancy };
}

/** cash.over_limit once per user per day (cron + payment handler). */
export async function checkCashLimits(
  tx: Tx,
  userIds: string[],
  actor: Actor,
  now = new Date(),
): Promise<number> {
  if (userIds.length === 0) return 0;
  const tz = await companyTz(tx);
  const custody = await custodyFor(userIds, tx);
  const plans = await techPlans(tx, userIds, todayKey(tz, now));
  const since = startOfDayInTz(now, tz);
  let n = 0;
  for (const id of userIds) {
    const c = custody[id];
    const tp = plans.get(id);
    if (!c || !tp) continue;
    // Net-in-payout techs keep their cash (it comes off their pay): only checks
    // have to be handed in, so only checks can put them over (QA T6-12).
    const cash = effectiveCash(tp.plan, tp.workerType, tp.overrides);
    const netting = cash.techKeepsCash && cash.settlement === "net_in_payout";
    const alert = custodyAlert(
      netting ? { heldCents: c.checksHeldCents, oldestAt: c.oldestCheckAt } : c,
      {
        maxCashHeldCents: tp.plan.cash.max_cash_held_cents,
        remitWithinDays: tp.plan.cash.remit_within_days,
      },
      now,
    );
    if (!alert.over) continue;
    const [already] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.type, "cash.over_limit"),
          gte(events.createdAt, since),
          sql`${events.payload}->>'user_id' = ${id}`,
        ),
      )
      .limit(1);
    if (already) continue;
    await emitB6(
      tx,
      "cash.over_limit",
      { type: "user", id },
      {
        user_id: id,
        held_cents: netting ? c.checksHeldCents : c.heldCents,
        oldest_days: alert.oldestDays,
      },
      { actor },
    );
    n++;
  }
  return n;
}
