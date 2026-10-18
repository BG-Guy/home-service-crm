// Demo seed fragment for `payroll` (BUILD_PLAN §10.3 #21). Owner: B6.
// Write only your own tables; never emit events (runQuietly); drive B6's own engine:
// recomputeJobFinancials for every completed job, the J12 chargeback hold, weekly
// period closes (older → approved, paid, locked; last week → tech review with a flag;
// current week open), cash hand-ins and tech bank details.
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  approvals,
  cashRemittances,
  disputes,
  jobs,
  ledgerEntries,
  payments,
  payPeriods,
  settlementFlags,
  settlements,
  techComp,
  users,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import { demoJob, demoUser, type TechKey } from "@/db/seed/demo-plan";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createApproval } from "@/features/approvals/api";
import { encrypt } from "@/lib/crypto";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";
import { periodsBetween } from "./engine";
import { applyDispute } from "./server/chargebacks";
import { recomputeJobFinancials } from "./server/financials";
import { recordPayout } from "./server/payouts";
import {
  approveSettlement,
  closeWithoutPayout,
  generateSettlements,
} from "./server/settlements";
import { runQuietly, settingsOf } from "./server/util";

const TECHS: TechKey[] = ["tech1", "tech2", "tech3"];

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  await runQuietly(() => run(db, ctx));
}

async function run(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const uid = (k: TechKey | "admin" | "office") => demoUser(k).id;
  const admin = { kind: "user" as const, userId: uid("admin") };
  const today = dateKey(ctx.now, ctx.tz);
  const at = (day: string, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return zonedTimeToUtc({ ...parseDateKey(day), hour: h, minute: m }, ctx.tz);
  };

  const present = new Set(
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(
          inArray(
            users.id,
            TECHS.map((t) => uid(t)),
          ),
        )
    ).map((u) => u.id),
  );
  if (present.size === 0) {
    ctx.log("payroll: demo techs missing, skipped");
    return;
  }

  // ---------------------------------------------------------------- tech_comp
  for (const t of TECHS) {
    const u = demoUser(t);
    if (!present.has(u.id)) continue;
    await db
      .insert(techComp)
      .values({
        id: seedId("tech_comp", t),
        userId: u.id,
        planKey: u.planKey ?? "partner_25",
        overrides: u.compOverrides as Record<string, never>,
        effectiveFrom: addDaysToKey(today, -400),
        agreementSignatureId: u.agreementSigned
          ? seedId("signature", `comp-${t}`)
          : null,
        agreementPlanVersion: u.agreementSigned ? 1 : null,
        createdBy: admin.userId,
        createdAt: ctx.at(-400, "09:00"),
      })
      .onConflictDoNothing();
  }

  // ---------------------------------------------------------------- bank details
  const bank = [
    {
      t: "tech1" as const,
      routing: "011000015",
      account: "4099123456",
      type: "checking",
      holder: "personal",
      changed: -2,
      verified: false,
    },
    {
      t: "tech2" as const,
      routing: "021000021",
      account: "5566778899",
      type: "checking",
      holder: "personal",
      changed: -120,
      verified: true,
    },
  ];
  for (const b of bank) {
    if (!present.has(uid(b.t))) continue;
    const changedAt = ctx.at(b.changed, "19:12");
    await db
      .update(users)
      .set({
        bankRoutingEnc: encrypt(b.routing),
        bankAccountEnc: encrypt(b.account),
        bankLast4: b.account.slice(-4),
        bankAccountType: b.type,
        bankHolderType: b.holder,
        bankChangedAt: changedAt,
        bankVerifiedAt: b.verified
          ? new Date(changedAt.getTime() + 86_400_000)
          : null,
        bankVerifiedBy: b.verified ? admin.userId : null,
      })
      .where(eq(users.id, uid(b.t)));
  }

  // ---------------------------------------------------------------- pay periods
  const s = await settingsOf(db);
  const cfg = {
    period: s.payroll.period,
    weekStartsOn: s.payroll.week_starts_on,
    biweeklyAnchor: s.payroll.biweekly_anchor,
  };
  const periods = periodsBetween(
    addDaysToKey(today, -63),
    addDaysToKey(today, 7),
    cfg,
  );
  await db
    .insert(payPeriods)
    .values(periods.map((p) => ({ startsOn: p.startsOn, endsOn: p.endsOn })))
    .onConflictDoNothing();

  // ---------------------------------------------------------------- job financials
  const [already] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.refTable, "job_financials"));
  if ((already?.n ?? 0) === 0) {
    const done = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          inArray(
            jobs.id,
            ctx.plan.jobs.map((j) => j.id),
          ),
          inArray(jobs.status, ["completed", "closed", "cancelled"]),
        ),
      )
      .orderBy(asc(jobs.completedAt));
    for (const j of done)
      await recomputeJobFinancials(db, j.id, SYSTEM_ACTOR, "seed");
    ctx.log(`payroll: financials for ${done.length} jobs`);

    // Chargeback hold for the J12 dispute (plan on_open: hold).
    const j12 = demoJob(12);
    const ds = await db
      .select({ id: disputes.id })
      .from(disputes)
      .innerJoin(payments, eq(payments.id, disputes.paymentId))
      .where(eq(payments.jobId, j12.id));
    for (const d of ds) await applyDispute(db, d.id, SYSTEM_ACTOR);
  }

  // ---------------------------------------------------------------- cash hand-ins
  const [hasRemit] = await db
    .select({ id: cashRemittances.id })
    .from(cashRemittances)
    .limit(1);
  if (!hasRemit) {
    for (const t of ["tech2", "tech3"] as const) {
      if (!present.has(uid(t))) continue;
      const cash = await db
        .select({
          amount: payments.amountCents,
          tip: payments.tipCents,
          at: payments.succeededAt,
          method: payments.method,
        })
        .from(payments)
        .where(
          and(
            eq(payments.collectedByUserId, uid(t)),
            inArray(payments.method, ["cash", "check"]),
            eq(payments.status, "succeeded"),
          ),
        );
      const byDay = new Map<string, number>();
      for (const p of cash) {
        if (!p.at) continue;
        const d = dateKey(p.at, ctx.tz);
        if (d >= today) continue; // today's cash is still in the truck
        byDay.set(d, (byDay.get(d) ?? 0) + p.amount + p.tip);
      }
      const days = [...byDay.keys()].sort();
      for (const [i, d] of days.entries()) {
        const last = i === days.length - 1;
        const pending = t === "tech2" && last;
        const handIn = at(addDaysToKey(d, 1), "08:05");
        await db.insert(cashRemittances).values({
          userId: uid(t),
          amountCents: byDay.get(d) ?? 0,
          method: t === "tech3" ? "hand_in" : "bank_deposit",
          status: pending ? "pending" : "confirmed",
          receivedBy: pending ? null : uid("office"),
          receivedAt: pending ? null : at(addDaysToKey(d, 1), "09:30"),
          createdAt: handIn,
          updatedAt: handIn,
        });
      }
    }
  }

  // ---------------------------------------------------------------- settlements
  const closable = await db
    .select()
    .from(payPeriods)
    .where(and(lt(payPeriods.endsOn, today), eq(payPeriods.status, "open")))
    .orderBy(asc(payPeriods.startsOn));
  const lastWeek = closable[closable.length - 1];
  for (const p of closable) {
    const closedAt = at(addDaysToKey(p.endsOn, 2), "00:10");
    await db
      .update(payPeriods)
      .set({ status: "closed", closedAt })
      .where(eq(payPeriods.id, p.id));
    await generateSettlements(db, p.id, admin);
    const rows = await db
      .select()
      .from(settlements)
      .where(eq(settlements.payPeriodId, p.id));
    const reviewDeadline = new Date(
      closedAt.getTime() + s.payroll.review_hours * 3_600_000,
    );
    if (p.id === lastWeek?.id) {
      for (const r of rows)
        await db
          .update(settlements)
          .set({ reviewDeadline, createdAt: closedAt })
          .where(eq(settlements.id, r.id));
      // Tom flags a line on last week's statement → settlement_flag approval.
      const tom = rows.find((r) => r.userId === uid("tech1"));
      if (tom) {
        const [line] = await db
          .select({ id: ledgerEntries.id, jobId: ledgerEntries.jobId })
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.userId, uid("tech1")),
              eq(ledgerEntries.type, "commission"),
              sql`${ledgerEntries.effectiveDate} between ${p.startsOn}::date and ${p.endsOn}::date`,
            ),
          )
          .limit(1);
        const [f] = await db
          .insert(settlementFlags)
          .values({
            id: seedId("settlement_flag", "tech1-last-week"),
            settlementId: tom.id,
            ledgerEntryId: line?.id ?? null,
            jobId: line?.jobId ?? null,
            userId: uid("tech1"),
            comment: ctx.profile.payroll.settlementFlag,
            createdAt: at(addDaysToKey(p.endsOn, 2), "18:40"),
          })
          .onConflictDoNothing()
          .returning({ id: settlementFlags.id });
        if (f) {
          const exists = await db
            .select({ id: approvals.id })
            .from(approvals)
            .where(eq(approvals.entityId, f.id))
            .limit(1);
          if (!exists.length)
            await createApproval(
              db,
              {
                entityType: "settlement_flag",
                entityId: f.id,
                policy: "always_review",
                requestedBy: uid("tech1"),
                evidence: {
                  settlement_id: tom.id,
                  ledger_entry_id: line?.id ?? null,
                },
              },
              { kind: "user", userId: uid("tech1") },
            );
        }
      }
      continue;
    }
    // Older weeks: approve → pay (Zelle or direct deposit) → locked.
    for (const r of rows) {
      const approved = await approveSettlement(db, r.id, admin, {
        force: true,
      });
      const approvedAt = at(addDaysToKey(p.endsOn, 4), "10:15");
      const paidOn = addDaysToKey(p.endsOn, 5);
      const tech = TECHS.find((t) => uid(t) === r.userId);
      if (approved.closingBalanceCents > 0) {
        await recordPayout(
          db,
          {
            userId: r.userId,
            settlementIds: [r.id],
            method:
              tech === "tech1" || tech === "tech2" ? "ach_nacha" : "zelle",
            amountCents: approved.closingBalanceCents,
            reference:
              tech === "tech3"
                ? `Zelle ${paidOn.replace(/-/g, "")}`
                : `ACH ${paidOn}`,
            paidOn,
          },
          admin,
        );
      } else {
        await closeWithoutPayout(db, r.id, admin);
      }
      const acked = !(
        tech === "tech3" && p.id === closable[closable.length - 2]?.id
      );
      await db
        .update(settlements)
        .set({
          createdAt: closedAt,
          reviewDeadline,
          approvedAt,
          paidAt: approved.closingBalanceCents > 0 ? at(paidOn, "09:00") : null,
          lockedAt: at(paidOn, "09:00"),
          techAckAt: acked ? at(addDaysToKey(p.endsOn, 3), "20:05") : null,
          techAckName: acked ? demoUser(tech ?? "tech1").name : null,
          techAckIp: acked ? "203.0.113.24" : null,
        })
        .where(eq(settlements.id, r.id));
    }
  }
  ctx.log(`payroll: ${periods.length} pay periods, ${closable.length} closed`);
}
