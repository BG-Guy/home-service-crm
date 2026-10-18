import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getStorage } from "@/adapters/storage";
import type { Tx } from "@/db";
import {
  nachaBatches,
  payoutSettlements,
  payouts,
  settlements,
  users,
} from "@/db/schema";
import { attachMedia } from "@/features/media/api";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { decryptOrNull } from "@/lib/crypto";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { formatDateKey, zonedParts } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { buildNachaFile, type NachaEntry, NachaError } from "../engine";
import { insertPostings } from "./ledger";
import {
  paidOn,
  type SettlementTotalsJson,
  settleAfterPayout,
} from "./settlements";
import { companyTz, settingsOf, todayKey } from "./util";

export const PAYOUT_METHOD_LABEL: Record<string, string> = {
  ach_nacha: "direct deposit",
  zelle: "Zelle",
  check: "check",
  cash: "cash",
  payroll_provider: "payroll provider",
  stripe_connect: "Stripe",
  other: "other",
};

export interface RecordPayoutInput {
  userId: string;
  settlementIds: string[];
  method:
    | "ach_nacha"
    | "zelle"
    | "check"
    | "cash"
    | "payroll_provider"
    | "other";
  amountCents: number;
  reference?: string | null;
  paidOn: string;
  proofMediaId?: string | null;
  nachaBatchId?: string | null;
}

/** Record a payout ("paycheck deposit"): payout row, −payout ledger line, allocation, lock. */
export async function recordPayout(
  tx: Tx,
  input: RecordPayoutInput,
  actor: Actor,
): Promise<{ payoutId: string }> {
  if (input.amountCents <= 0)
    throw new ValidationError({ amountCents: ["Enter an amount above $0."] });
  const rows = await tx
    .select()
    .from(settlements)
    .where(inArray(settlements.id, input.settlementIds));
  if (rows.length !== input.settlementIds.length)
    throw new NotFoundError("Settlement");
  const remaining: { id: string; left: number }[] = [];
  for (const s of rows) {
    if (s.userId !== input.userId)
      throw new ConflictError(
        "wrong_user",
        "Those statements belong to someone else.",
      );
    if (s.status !== "approved")
      throw new ConflictError(
        "not_approved",
        "Only approved, unpaid statements can be paid.",
      );
    remaining.push({
      id: s.id,
      left: Math.max(0, s.closingBalanceCents - (await paidOn(tx, s.id))),
    });
  }
  const totalLeft = remaining.reduce((a, r) => a + r.left, 0);
  if (input.amountCents > totalLeft)
    throw new ValidationError({
      amountCents: [`That's more than the ${formatMoney(totalLeft)} owed.`],
    });
  const tz = await companyTz(tx);
  const [p] = await tx
    .insert(payouts)
    .values({
      userId: input.userId,
      amountCents: input.amountCents,
      method: input.method,
      reference: input.reference ?? null,
      paidOn: input.paidOn,
      proofMediaId: input.proofMediaId ?? null,
      nachaBatchId: input.nachaBatchId ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: payouts.id });
  if (!p) throw new Error("payout insert failed");
  const [ledgerId] = await insertPostings(
    tx,
    [
      {
        userId: input.userId,
        type: "payout",
        amountCents: -input.amountCents,
        wageClass: "n/a",
        memo: `Paid by ${PAYOUT_METHOD_LABEL[input.method] ?? input.method}${input.reference ? ` (${input.reference})` : ""}`,
      },
    ],
    {
      effectiveDate: input.paidOn,
      refTable: "payouts",
      refId: p.id,
      actorUserId: actor.userId,
      today: todayKey(tz),
    },
  );
  await tx
    .update(payouts)
    .set({ ledgerEntryId: ledgerId ?? null })
    .where(eq(payouts.id, p.id));
  let left = input.amountCents;
  for (const r of remaining) {
    if (left <= 0) break;
    const amt = Math.min(left, r.left);
    if (amt <= 0) continue;
    await tx
      .insert(payoutSettlements)
      .values({ payoutId: p.id, settlementId: r.id, amountCents: amt });
    left -= amt;
  }
  if (input.proofMediaId)
    await attachMedia(tx, [input.proofMediaId], { type: "payout", id: p.id });
  await settleAfterPayout(tx, input.settlementIds, actor);
  await writeActivity(tx, {
    entity: { type: "user", id: input.userId },
    kind: "payout.recorded",
    summary: `Payment of ${formatMoney(input.amountCents)} sent by ${PAYOUT_METHOD_LABEL[input.method] ?? input.method} on ${formatDateKey(input.paidOn)}`,
    data: { payout_id: p.id, settlement_ids: input.settlementIds },
    actorUserId: actor.userId,
  });
  await writeAudit(tx, {
    actor,
    action: "payout.recorded",
    entity: { type: "payout", id: p.id },
    after: {
      user_id: input.userId,
      amount_cents: input.amountCents,
      method: input.method,
      settlement_ids: input.settlementIds,
    },
  });
  return { payoutId: p.id };
}

export interface NachaCandidate {
  settlementId: string;
  userId: string;
  name: string;
  amountCents: number;
  included: boolean;
  reason: "ok" | "no_bank" | "bank_change_hold" | "nothing_owed";
  bankLast4: string | null;
  bankChangedAt: Date | null;
}

/** Which approved settlements a NACHA batch would pay, and who is held back (bank-change hold). */
export async function nachaCandidates(
  tx: Tx,
  settlementIds: string[],
  now = new Date(),
): Promise<NachaCandidate[]> {
  if (settlementIds.length === 0) return [];
  const s = await settingsOf(tx);
  const holdMs = s.payroll.bank_change_hold_hours * 3_600_000;
  const rows = await tx
    .select({
      s: settlements,
      name: users.name,
      routing: users.bankRoutingEnc,
      account: users.bankAccountEnc,
      last4: users.bankLast4,
      changedAt: users.bankChangedAt,
      verifiedAt: users.bankVerifiedAt,
    })
    .from(settlements)
    .innerJoin(users, eq(users.id, settlements.userId))
    .where(
      and(
        inArray(settlements.id, settlementIds),
        eq(settlements.status, "approved"),
      ),
    );
  const out: NachaCandidate[] = [];
  for (const r of rows) {
    const owed = Math.max(
      0,
      r.s.closingBalanceCents - (await paidOn(tx, r.s.id)),
    );
    const held =
      !!r.changedAt &&
      now.getTime() - r.changedAt.getTime() < holdMs &&
      !(r.verifiedAt && r.verifiedAt >= r.changedAt);
    const reason: NachaCandidate["reason"] =
      owed <= 0
        ? "nothing_owed"
        : !r.routing || !r.account
          ? "no_bank"
          : held
            ? "bank_change_hold"
            : "ok";
    out.push({
      settlementId: r.s.id,
      userId: r.s.userId,
      name: r.name,
      amountCents: owed,
      included: reason === "ok",
      reason,
      bankLast4: r.last4,
      bankChangedAt: r.changedAt,
    });
  }
  return out;
}

/**
 * NACHA export (payroll.payout): builds the PPD/CCD credit file, stores it, records an
 * ach_nacha payout per included settlement. Techs whose bank details changed within
 * bank_change_hold_hours are excluded unless an admin marked them Verified.
 */
export async function exportNacha(
  tx: Tx,
  input: { settlementIds: string[]; effectiveDate: string },
  actor: Actor,
): Promise<{
  batchId: string;
  content: string;
  filename: string;
  included: NachaCandidate[];
  excluded: NachaCandidate[];
  storageKey: string;
}> {
  const s = await settingsOf(tx);
  if (!s.payroll.nacha_enabled)
    throw new ConflictError(
      "nacha_off",
      "Turn on NACHA export in Settings → Commission & payroll.",
    );
  const n = s.payroll.nacha;
  const candidates = await nachaCandidates(tx, input.settlementIds);
  const included = candidates.filter((c) => c.included);
  const excluded = candidates.filter((c) => !c.included);
  if (included.length === 0)
    throw new ConflictError(
      "nothing_to_pay",
      "No statement can be paid by direct deposit right now.",
    );
  const bank = await tx
    .select({
      id: users.id,
      routing: users.bankRoutingEnc,
      account: users.bankAccountEnc,
      type: users.bankAccountType,
      holder: users.bankHolderType,
      holderName: users.bankHolderNameEnc,
    })
    .from(users)
    .where(
      inArray(
        users.id,
        included.map((c) => c.userId),
      ),
    );
  const entries: NachaEntry[] = included.map((c) => {
    const b = bank.find((x) => x.id === c.userId);
    const routing = decryptOrNull(b?.routing);
    const account = decryptOrNull(b?.account);
    if (!routing || !account)
      throw new ConflictError(
        "bank_unreadable",
        `Bank details for ${c.name} can't be read. Ask them to re-enter them.`,
      );
    return {
      ref: c.settlementId,
      name: decryptOrNull(b?.holderName) || c.name,
      idNumber: c.userId.replace(/-/g, "").slice(0, 15),
      routing,
      account,
      accountType: b?.type === "savings" ? "savings" : "checking",
      holderType: b?.holder === "business" ? "business" : "personal",
      amountCents: c.amountCents,
    };
  });
  const tz = await companyTz(tx);
  const now = new Date();
  const p = zonedParts(now, tz);
  let file: ReturnType<typeof buildNachaFile>;
  try {
    file = buildNachaFile({
      company: {
        immediateDestination: n.immediate_destination,
        immediateDestinationName: n.immediate_destination_name,
        immediateOrigin: n.immediate_origin,
        immediateOriginName: n.immediate_origin_name,
        companyName: n.company_name,
        companyId: n.company_id,
        odfiRouting: n.odfi_routing || n.immediate_destination,
        entryDescription: n.entry_description,
      },
      entries,
      effectiveDate: input.effectiveDate,
      fileDate: todayKey(tz, now),
      fileTime: `${String(p.hour).padStart(2, "0")}${String(p.minute).padStart(2, "0")}`,
    });
  } catch (e) {
    if (e instanceof NachaError)
      throw new ConflictError("nacha_invalid", e.message);
    throw e;
  }
  const [batch] = await tx
    .insert(nachaBatches)
    .values({
      storageKey: "pending",
      secCode: file.secCodes.join(","),
      entryCount: file.entryCount,
      totalCents: file.totalCreditCents,
      effectiveDate: input.effectiveDate,
      createdBy: actor.userId,
    })
    .returning({ id: nachaBatches.id });
  if (!batch) throw new Error("nacha batch insert failed");
  const storageKey = `payroll/nacha/${batch.id}.ach`;
  // Provider call inside the transaction: a short single PUT (local disk or S3).
  await getStorage().put(
    storageKey,
    new TextEncoder().encode(file.content),
    "text/plain",
  );
  await tx
    .update(nachaBatches)
    .set({ storageKey })
    .where(eq(nachaBatches.id, batch.id));
  for (const c of included) {
    await recordPayout(
      tx,
      {
        userId: c.userId,
        settlementIds: [c.settlementId],
        method: "ach_nacha",
        amountCents: c.amountCents,
        reference: `ACH batch ${batch.id.slice(0, 8)}`,
        paidOn: input.effectiveDate,
        nachaBatchId: batch.id,
      },
      actor,
    );
  }
  await writeAudit(tx, {
    actor,
    action: "payroll.nacha_exported",
    entity: null,
    after: {
      batch_id: batch.id,
      entries: file.entryCount,
      total_cents: file.totalCreditCents,
      excluded: excluded.map((x) => ({ user_id: x.userId, reason: x.reason })),
    },
  });
  return {
    batchId: batch.id,
    content: file.content,
    filename: `payroll-${input.effectiveDate}.ach`,
    included,
    excluded,
    storageKey,
  };
}

/** Gusto/ADP-style CSV: wages vs reimbursements per tech (never taxes). */
export function payrollCsv(
  rows: {
    name: string;
    email: string;
    workerType: string;
    period: string;
    totals: SettlementTotalsJson;
    closingCents: number;
  }[],
): string {
  // Formula guard (QA T5-14): a tech can name themselves "=HYPERLINK(…)". Text that
  // starts like a formula gets a leading apostrophe; money cells ("-118.50") don't.
  const esc = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "name",
    "email",
    "worker_type",
    "period",
    "commission",
    "spiffs",
    "tips",
    "topups",
    "adjustments",
    "deductions",
    "wages_total",
    "reimbursements",
    "cash_netted",
    "net_pay",
  ];
  const dollars = (c: number) => (c / 100).toFixed(2);
  const lines = rows.map((r) => {
    const t = r.totals.byType ?? {};
    const deductions = [
      "chargeback_hold",
      "chargeback_release",
      "chargeback_clawback",
      "recall_clawback",
      "tool_deduction",
      "tool_deposit",
      "draw",
    ].reduce((a, k) => a + (t[k] ?? 0), 0);
    return [
      r.name,
      r.email,
      r.workerType,
      r.period,
      dollars(t.commission ?? 0),
      dollars(t.spiff ?? 0),
      dollars(t.tip ?? 0),
      dollars((t.guarantee_topup ?? 0) + (t.ot_topup ?? 0)),
      dollars((t.adjustment ?? 0) + (t.tool_allowance ?? 0)),
      dollars(deductions),
      dollars(r.totals.wagesCents ?? 0),
      dollars(r.totals.reimbursementsCents ?? 0),
      dollars(r.totals.custodyCents ?? 0),
      dollars(r.closingCents),
    ]
      .map(esc)
      .join(",");
  });
  return [head.join(","), ...lines].join("\n");
}
