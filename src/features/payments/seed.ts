// Demo seed fragment for `payments` (BUILD_PLAN §10.3 #12). Owner: B4.
// deposit_requests, payments per plan (manual ones verified except the few the plan leaves
// unverified; cash collected_by the tech), refunds (J25 succeeded, J33 promised), then the
// risk and readiness engines for every seeded job (persisted via B2's setters).
// Writes only B4 tables; never emits events; fixed ids + onConflictDoNothing (rerunnable).
import { desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import {
  depositRequests,
  invoices,
  jobs,
  payments,
  policyVersions,
  refunds,
  riskAssessments,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { computeReadiness } from "@/features/disputes/api";
import { loadJob, loadRiskFacts } from "@/features/disputes/facts";
import {
  bandFor,
  bandRank,
  RISK_DEFAULT_BANDS,
  type RiskBand,
  scoreRisk,
} from "@/features/disputes/risk";
import { setJobRisk } from "@/features/jobs/api";
import { roundHalfAway } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { splitActualFee } from "./engine/fees";

const BRANDS = ["visa", "mastercard", "amex", "discover"] as const;
const ENTRY = ["tap", "chip", "online"] as const;

/** Stripe-like 2.9 % + 30¢ on amount + tip. */
const cardFee = (gross: number) => roundHalfAway(gross * 0.029) + 30;

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  // T3-19: "today" events planned for later today (e.g. a 09:40 payment seeded at
  // 08:00) must not be in the future; clamp them to just before the seed's "now".
  // Intentional future dates (deposit and promised-refund due dates) aren't clamped.
  const latest = new Date(ctx.now.getTime() - 5 * 60_000);
  const past = (d: Date): Date => (d.getTime() > latest.getTime() ? latest : d);
  const ids = plan.jobs.map((j) => j.id);
  const presentJobs = new Set(
    (
      await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.id, ids))
    ).map((r) => r.id),
  );
  const invoiceIds = plan.jobs.map((j) => seedId("invoice", j.n));
  const presentInvoices = new Set(
    (
      await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(inArray(invoices.id, invoiceIds))
    ).map((r) => r.id),
  );
  const userId = (k: string | null) =>
    plan.users.find((u) => u.key === k)?.id ?? null;
  const officeId = userId("office");
  const [depositPolicy] = await db
    .select({ id: policyVersions.id, sha: policyVersions.sha256 })
    .from(policyVersions)
    .where(eq(policyVersions.kind, "deposit"))
    .orderBy(desc(policyVersions.version))
    .limit(1);

  let nPay = 0;
  let nDep = 0;
  for (const j of plan.jobs) {
    if (!presentJobs.has(j.id)) continue;
    const invId = seedId("invoice", j.n);
    const invoiceId = j.invoiced && presentInvoices.has(invId) ? invId : null;
    const depId = seedId("deposit_request", `j${j.n}`);
    const depPayment = j.payments.find((p) => p.kind === "deposit");

    if (j.deposit) {
      await db
        .insert(depositRequests)
        .values({
          id: depId,
          jobId: j.id,
          ruleId: null,
          amountCents: j.deposit.amountCents,
          mode: "capture",
          status:
            j.deposit.status === "applied" && !invoiceId
              ? "paid"
              : j.deposit.status,
          policyVersionId: depositPolicy?.id ?? null,
          policySha256: depositPolicy?.sha ?? null,
          requestedAt: past(ctx.at(j.deposit.dayOffset, "09:00")),
          dueAt:
            j.deposit.status === "required"
              ? ctx.at(j.deposit.dayOffset + 2, "09:00")
              : null,
          paymentId: depPayment?.id ?? null,
          specialOrderPoAt: j.n === 67 ? ctx.at(-5, "10:30") : null,
          createdAt: past(ctx.at(j.deposit.dayOffset, "09:00")),
          updatedAt: past(ctx.at(j.deposit.dayOffset, "09:00")),
        })
        .onConflictDoNothing();
      nDep++;
    }

    for (const p of j.payments) {
      const card = p.method === "card";
      const at = past(ctx.at(p.dayOffset, p.hhmm));
      const gross = p.amountCents + p.tipCents;
      const fee = card ? cardFee(gross) : 0;
      const split = splitActualFee({
        amountCents: p.amountCents,
        tipCents: p.tipCents,
        feeCents: fee,
      });
      const entry = card
        ? p.kind === "deposit"
          ? "online"
          : ENTRY[j.n % ENTRY.length]
        : p.method === "cash"
          ? "cash"
          : p.method === "check"
            ? "check"
            : "p2p";
      const status =
        j.dispute && card && p.kind === "payment"
          ? "succeeded" // the disputes fragment opens the dispute (→ disputed)
          : j.refund?.status === "succeeded" && p.kind === "payment"
            ? "partially_refunded"
            : "succeeded";
      await db
        .insert(payments)
        .values({
          id: p.id,
          invoiceId,
          jobId: j.id,
          customerId: j.customerId,
          depositRequestId: p.kind === "deposit" && j.deposit ? depId : null,
          kind: p.kind,
          method: p.method,
          provider: card ? "stripe" : "manual",
          providerRef: p.providerRef,
          status,
          amountCents: p.amountCents,
          tipCents: p.tipCents,
          feeCents: fee,
          feeOnTipCents: split.feeOnTipCents,
          feeSource: card ? "actual" : "configured",
          entryMode: entry,
          cardBrand: card ? BRANDS[j.n % BRANDS.length] : null,
          cardFunding: card ? (j.n % 5 === 0 ? "debit" : "credit") : null,
          cardLast4: card ? String(4000 + ((j.n * 37) % 999)).slice(-4) : null,
          cardFingerprint: card ? `fp_demo_c${j.customerN}` : null,
          avsResult: card ? "pass" : null,
          cvcResult: card ? "pass" : null,
          threeDs: card && entry === "online" ? "authenticated" : null,
          wallet: card && entry === "tap" && j.n % 2 === 0 ? "apple_pay" : null,
          payerName: null,
          reference:
            p.method === "check"
              ? String(1000 + j.n)
              : p.method === "zelle" || p.method === "venmo"
                ? `${p.method === "zelle" ? "ZL" : "VN"}${(ctx.rng() * 1e8).toFixed(0)}`
                : null,
          collectedByUserId: p.collectedBy ? userId(p.collectedBy) : null,
          verifiedAt:
            !card && p.verified
              ? past(new Date(at.getTime() + 86_400_000))
              : null,
          verifiedBy: !card && p.verified ? officeId : null,
          succeededAt: at,
          idempotencyKey:
            card && p.providerRef ? `stripe:${p.providerRef}` : null,
          raw: card ? { id: p.providerRef, demo: true } : null,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing();
      nPay++;
    }

    if (j.refund) {
      const pay = j.payments.find((p) => p.kind === "payment");
      if (pay)
        await db
          .insert(refunds)
          .values({
            id: seedId("refund", `j${j.n}`),
            paymentId: pay.id,
            amountCents: j.refund.amountCents,
            reason:
              j.refund.status === "succeeded"
                ? "Goodwill credit: arrived outside the window"
                : "Overcharged: invoice revised after payment",
            status: j.refund.status,
            dueAt:
              j.refund.dueInDays != null
                ? ctx.at(j.refund.dueInDays, "17:00")
                : null,
            createdBy: userId("admin"),
            createdAt: past(ctx.at((j.dayOffset ?? 0) + 1, "10:00")),
            completedAt:
              j.refund.status === "succeeded"
                ? past(ctx.at((j.dayOffset ?? 0) + 1, "10:05"))
                : null,
          })
          .onConflictDoNothing();
    }
  }

  // ---- risk (§11.1) and readiness (§11.2) through the engines --------------------
  const s = await getSettings();
  const cfg = {
    weights: s.risk.weights,
    bands: s.risk.bands,
    noEstimateMinTicketCents: s.risk.no_estimate_min_ticket_cents,
  };
  let nRisk = 0;
  for (const j of plan.jobs) {
    if (!presentJobs.has(j.id)) continue;
    const row = await loadJob(j.id);
    if (!row) continue;
    const r = scoreRisk(await loadRiskFacts(row, ctx.now), cfg);
    let score = r.score;
    let band: RiskBand = r.band;
    const signals: { key: string; points: number; detail: string }[] = [
      ...r.signals,
    ];
    // The demo story pins a few jobs higher than their facts alone (e.g. J76 at Critical
    // with a pending start approval). Record it as an office flag so the "why" sheet
    // explains it; the next real recompute re-derives the score from facts only.
    if (bandRank(j.risk) > bandRank(band)) {
      const floor = { ...RISK_DEFAULT_BANDS, ...s.risk.bands }[
        j.risk as Exclude<RiskBand, "low">
      ];
      const add = Math.max(0, floor - score);
      signals.push({
        key: "office_flag",
        points: add,
        detail: ctx.profile.payments.officeFlagDetail,
      });
      score = Math.min(100, score + add);
      band = bandFor(score, s.risk.bands);
    }
    await db
      .insert(riskAssessments)
      .values({
        id: seedId("risk", j.n),
        jobId: j.id,
        score,
        band,
        signals,
        trigger: "manual",
        computedAt: past(ctx.at(Math.min(j.dayOffset ?? 0, 0) - 1, "08:00")),
      })
      .onConflictDoNothing();
    await setJobRisk(db, j.id, { score, band });
    if (
      ["arrived", "in_progress", "on_hold", "completed", "closed"].includes(
        j.status,
      )
    )
      await computeReadiness(db, j.id);
    nRisk++;
  }
  ctx.log(
    `payments: ${nPay} payments, ${nDep} deposit requests, risk/readiness on ${nRisk} jobs`,
  );
}
