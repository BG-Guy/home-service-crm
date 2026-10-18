// Demo seed fragment for `disputes` (BUILD_PLAN §10.3 #13). Owner: B4.
// The open J12 dispute (C7, card $600-ish, product_unacceptable, needs_response, due in
// 5 days, readiness at open 72) with its evidence JSON and template narrative, built by
// the same code path as the Stripe webhook — minus events (seeds never emit).
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { payments } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { SYSTEM_ACTOR } from "@/lib/types";
import { openDisputeInTx } from "./server";

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  let n = 0;
  for (const j of ctx.plan.jobs) {
    if (!j.dispute) continue;
    const pay = j.payments.find(
      (p) => p.kind === "payment" && p.method === "card",
    );
    if (!pay) continue;
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, pay.id))
      .limit(1);
    if (!row) continue; // payments fragment didn't run (guard)
    await openDisputeInTx(db, {
      id: seedId("dispute", `j${j.n}`),
      payment: row,
      provider: "stripe",
      providerRef: `dp_demo_${j.n}`,
      category: j.dispute.category,
      networkReasonCode: "13.3",
      amountCents: j.dispute.amountCents,
      status: j.dispute.status,
      dueBy: ctx.at(j.dispute.dueInDays, "23:00"),
      readinessAtOpen: j.dispute.readinessAtOpen,
      emitEvents: false,
      actor: SYSTEM_ACTOR,
    });
    n++;
  }
  ctx.log(`disputes: ${n} open dispute(s)`);
}
