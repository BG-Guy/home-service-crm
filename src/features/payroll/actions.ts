"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  cashRemittances,
  compPlans,
  ledgerEntries,
  mileageRates,
  payPeriods,
  roles,
  settlementFlags,
  settlements,
  techComp,
  users,
} from "@/db/schema";
import { createApproval } from "@/features/approvals/api";
import { mediaIdsForClientIds } from "@/features/media/api";
import { notify } from "@/features/notify/api";
import { captureSignature } from "@/features/signatures/api";
import { type ActionRunContext, action, zf } from "@/lib/action";
import { encrypt } from "@/lib/crypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { updateSettings } from "@/lib/settings";
import { addDaysToKey, formatDateKey } from "@/lib/time";
import {
  isBusinessDay,
  isValidAba,
  isValidAccountNumber,
  last4,
} from "./engine";
import { CompPlanSchema } from "./plan-schema";
import { agreementFor, ensureTechComp } from "./server/agreement";
import {
  decideRemittance,
  declareCashCount,
  recordRemittance,
} from "./server/cash";
import { custodyFor } from "./server/custody";
import { insertPostings, reverseEntries } from "./server/ledger";
import { exportNacha, recordPayout } from "./server/payouts";
import { latestPlans } from "./server/plans";
import {
  approveSettlement,
  closePayPeriod,
  closeWithoutPayout,
  generateSettlements,
  refreshSettlement,
} from "./server/settlements";
import { companyTz, settingsOf, todayKey } from "./server/util";

// Commission, payroll & payouts mutations (SPEC M16, §10). action() → perm → flag →
// zod → one transaction (write + events + audit + activity) → revalidate.

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const PAY = ["/pay", "/pay/statements", "/pay/settlements"];

// ------------------------------------------------------------------ cash custody

export const remitCash = action({
  perm: "cash.remit_own",
  feature: "payroll",
  input: z.object({
    amountCents: z.number().int().positive("Enter the amount."),
    method: z.enum(["bank_deposit", "hand_in"]),
    proofMediaId: uuid.nullish(),
    proofClientId: uuid.nullish(),
    clientId: uuid.optional(),
    clientTs: z.string().optional(),
  }),
  audit: "cash.remitted",
  async run({ input, user, tx, actor }) {
    const proof =
      input.proofMediaId ??
      (input.proofClientId
        ? ((await mediaIdsForClientIds([input.proofClientId]))[
            input.proofClientId
          ] ?? null)
        : null);
    if (input.method === "bank_deposit" && !proof && !input.proofClientId)
      throw new ValidationError({
        proofMediaId: ["Add a photo of the deposit slip."],
      });
    // Never more than the tech holds, less hand-ins still waiting (QA T1-06).
    // A replayed offline hand-in (same clientId) is returned as-is by recordRemittance.
    const held = (await custodyFor([user.id], tx))[user.id]?.heldCents ?? 0;
    const [waiting] = await tx
      .select({
        n: sql<number>`coalesce(sum(${cashRemittances.amountCents}), 0)::bigint`,
      })
      .from(cashRemittances)
      .where(
        and(
          eq(cashRemittances.userId, user.id),
          eq(cashRemittances.status, "pending"),
          input.clientId
            ? sql`${cashRemittances.clientId} is distinct from ${input.clientId}::uuid`
            : undefined,
        ),
      );
    const max = held - Number(waiting?.n ?? 0);
    if (input.amountCents > max) {
      const [dup] = input.clientId
        ? await tx
            .select({ id: cashRemittances.id })
            .from(cashRemittances)
            .where(eq(cashRemittances.clientId, input.clientId))
            .limit(1)
        : [];
      if (!dup)
        throw new ValidationError({
          amountCents: [
            max > 0
              ? `You can hand in up to ${formatMoney(max)}.`
              : "Your earlier hand-ins already cover what you hold.",
          ],
        });
    }
    return recordRemittance(
      tx,
      {
        userId: user.id,
        amountCents: input.amountCents,
        method: input.method,
        proofMediaId: proof,
        clientId: input.clientId ?? null,
      },
      actor,
    );
  },
  auditEntity: ({ data }) => ({
    type: "cash_remittance",
    id: data.remittanceId,
  }),
  revalidate: () => [...PAY, "/today", "/today/finish"],
});

export const confirmRemittance = action({
  perm: "cash.receive",
  feature: "payroll",
  input: z.object({
    remittanceId: uuid,
    decision: z.enum(["confirmed", "disputed"]),
  }),
  audit: "cash.remittance_decided",
  async run({ input, user, tx, actor }) {
    const [r] = await tx
      .select({ userId: cashRemittances.userId })
      .from(cashRemittances)
      .where(eq(cashRemittances.id, input.remittanceId))
      .limit(1);
    if (!r) throw new NotFoundError("Hand-in");
    if (r.userId === user.id && !user.perms.has("payroll.manage"))
      throw new ForbiddenError("You can't confirm your own hand-in.");
    await decideRemittance(tx, input.remittanceId, input.decision, actor);
    return { ok: true };
  },
  auditEntity: ({ input }) => ({
    type: "cash_remittance",
    id: input.remittanceId,
  }),
  revalidate: () => [...PAY, "/today"],
});

/** S44 end-of-day count on /today/finish. */
export const declareCash = action({
  perm: "cash.remit_own",
  feature: "payroll",
  input: z.object({
    declaredCents: z.number().int().min(0),
    note: z.string().trim().max(500).nullish(),
    clientId: uuid.optional(),
  }),
  async run({ input, user, tx, actor }) {
    return declareCashCount(tx, { userId: user.id, ...input }, actor);
  },
  revalidate: () => ["/today/finish", "/pay"],
});

// ------------------------------------------------------------------ statements (tech)

async function ownSettlement(tx: Tx, id: string, userId: string) {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, id))
    .limit(1);
  if (!s) throw new NotFoundError("Statement");
  if (s.userId !== userId) throw new ForbiddenError();
  return s;
}

export const acknowledgeStatement = action({
  perm: "payroll.view_own",
  feature: "payroll",
  input: z.object({
    settlementId: uuid,
    typedName: z.string().trim().min(2, "Type your full name.").max(120),
  }),
  async run({ input, user, tx, actor, audit, activity }) {
    const s = await ownSettlement(tx, input.settlementId, user.id);
    if (s.techAckAt) return { ok: true };
    const now = new Date();
    await tx
      .update(settlements)
      .set({
        techAckAt: now,
        techAckName: input.typedName,
        techAckIp: actor.ip ?? null,
        updatedAt: now,
      })
      .where(eq(settlements.id, s.id));
    await audit({
      action: "settlement.acknowledged",
      entity: { type: "settlement", id: s.id },
      after: {
        typed_name: input.typedName,
        ip: actor.ip ?? null,
        at: now.toISOString(),
      },
    });
    await activity({
      entity: { type: "user", id: user.id },
      kind: "settlement.acknowledged",
      summary: "Pay statement acknowledged",
      data: { settlement_id: s.id },
    });
    return { ok: true };
  },
  revalidate: ({ input }) => [...PAY, `/pay/statements/${input.settlementId}`],
});

export const flagStatementLine = action({
  perm: "payroll.view_own",
  feature: "payroll",
  input: z.object({
    settlementId: uuid,
    ledgerEntryId: uuid.nullish(),
    comment: z.string().trim().min(3, "Tell us what looks wrong.").max(1000),
  }),
  async run({ input, user, tx, actor, emit, activity }) {
    const s = await ownSettlement(tx, input.settlementId, user.id);
    if (s.status !== "tech_review" && s.status !== "draft")
      throw new ConflictError(
        "not_in_review",
        "This statement is already approved. Ask your admin for an adjustment.",
      );
    let jobId: string | null = null;
    if (input.ledgerEntryId) {
      const [le] = await tx
        .select({ userId: ledgerEntries.userId, jobId: ledgerEntries.jobId })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, input.ledgerEntryId))
        .limit(1);
      if (!le || le.userId !== user.id) throw new NotFoundError("Line");
      jobId = le.jobId;
    }
    const [f] = await tx
      .insert(settlementFlags)
      .values({
        settlementId: s.id,
        ledgerEntryId: input.ledgerEntryId ?? null,
        jobId,
        userId: user.id,
        comment: input.comment,
      })
      .returning({ id: settlementFlags.id });
    if (!f) throw new Error("flag insert failed");
    await createApproval(
      tx,
      {
        entityType: "settlement_flag",
        entityId: f.id,
        policy: "always_review",
        requestedBy: user.id,
        evidence: {
          settlement_id: s.id,
          ledger_entry_id: input.ledgerEntryId ?? null,
        },
      },
      actor,
    );
    await emit(
      "settlement.flagged",
      { type: "settlement", id: s.id },
      { settlement_id: s.id, user_id: user.id },
    );
    await activity({
      entity: { type: "user", id: user.id },
      kind: "settlement.flagged",
      summary: "Flagged a line on a pay statement",
      data: { settlement_id: s.id, flag_id: f.id },
    });
    return { flagId: f.id };
  },
  revalidate: ({ input }) => [
    ...PAY,
    `/pay/statements/${input.settlementId}`,
    "/approvals",
  ],
});

// ------------------------------------------------------------------ settlements (admin)

export const approveStatement = action({
  perm: "payroll.approve",
  feature: "payroll",
  input: z.object({ settlementId: uuid, force: z.boolean().optional() }),
  audit: "settlement.approve",
  async run({ input, tx, actor }) {
    const row = await approveSettlement(tx, input.settlementId, actor, {
      force: input.force,
    });
    const s = await settingsOf(tx);
    if (
      row.closingBalanceCents < 0 &&
      s.payroll.negative_balance === "request_remittance"
    ) {
      const tz = await companyTz(tx);
      const by = addDaysToKey(todayKey(tz), 7);
      await notify(tx, {
        to: { userIds: [row.userId] },
        type: "staff.remittance_request",
        title: `You owe ${formatMoney(-row.closingBalanceCents)}`,
        body: `Please remit by ${formatDateKey(by)} (cash you kept exceeded your earnings this period).`,
        url: `/pay/statements/${row.id}`,
        priority: "high",
      });
    }
    return { closingCents: row.closingBalanceCents };
  },
  auditEntity: ({ input }) => ({ type: "settlement", id: input.settlementId }),
  revalidate: ({ input }) => [...PAY, `/pay/settlements/${input.settlementId}`],
});

export const recordPayoutAction = action({
  perm: "payroll.payout",
  feature: "payroll",
  input: z.object({
    userId: uuid,
    settlementIds: z.array(uuid).min(1),
    method: z.enum([
      "ach_nacha",
      "zelle",
      "check",
      "cash",
      "payroll_provider",
      "other",
    ]),
    amountCents: z.number().int().positive("Enter the amount."),
    reference: z.string().trim().max(120).nullish(),
    paidOn: day,
    proofMediaId: uuid.nullish(),
  }),
  async run({ input, tx, actor }) {
    return recordPayout(tx, input, actor);
  },
  revalidate: ({ input }) => [
    ...PAY,
    ...input.settlementIds.map((id) => `/pay/settlements/${id}`),
  ],
});

export const closeStatement = action({
  perm: "payroll.approve",
  feature: "payroll",
  input: z.object({ settlementId: uuid }),
  async run({ input, tx, actor }) {
    await closeWithoutPayout(tx, input.settlementId, actor);
    return { ok: true };
  },
  revalidate: ({ input }) => [...PAY, `/pay/settlements/${input.settlementId}`],
});

export const exportNachaAction = action({
  perm: "payroll.payout",
  feature: "payroll",
  input: z.object({
    settlementIds: z.array(uuid).min(1),
    effectiveDate: day.refine(isBusinessDay, {
      message: "Banks settle ACH Monday to Friday. Pick a weekday.",
    }),
  }),
  async run({ input, tx, actor }) {
    const r = await exportNacha(tx, input, actor);
    return {
      batchId: r.batchId,
      filename: r.filename,
      included: r.included.map((c) => ({
        name: c.name,
        amountCents: c.amountCents,
      })),
      excluded: r.excluded.map((c) => ({ name: c.name, reason: c.reason })),
    };
  },
  revalidate: () => PAY,
});

export const markBankVerified = action({
  perm: "payroll.payout",
  feature: "payroll",
  input: z.object({ userId: uuid }),
  async run({ input, user, tx, audit }) {
    const now = new Date();
    await tx
      .update(users)
      .set({ bankVerifiedAt: now, bankVerifiedBy: user.id, updatedAt: now })
      .where(eq(users.id, input.userId));
    await audit({
      action: "user.bank_verified",
      entity: { type: "user", id: input.userId },
      after: { verified_by: user.id, at: now.toISOString() },
    });
    return { ok: true };
  },
  revalidate: () => PAY,
});

/** Apply or waive a needs_review deduction (W-2 tool/chargeback/recall lines). */
export const reviewLedgerEntry = action({
  perm: "payroll.manage",
  feature: "payroll",
  input: z.object({
    ledgerEntryId: uuid,
    decision: z.enum(["apply", "waive"]),
  }),
  async run({ input, tx, actor, audit }) {
    const [e] = await tx
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, input.ledgerEntryId))
      .limit(1);
    if (!e || !e.needsReview || e.reversesId) throw new NotFoundError("Line");
    const [rev] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.reversesId, e.id))
      .limit(1);
    if (rev)
      throw new ConflictError(
        "already_reviewed",
        "This line was already reviewed.",
      );
    const today = todayKey(await companyTz(tx));
    await reverseEntries(
      tx,
      [e],
      input.decision === "apply"
        ? "applied after review"
        : "waived after review",
      {
        actorUserId: actor.userId,
        today,
      },
    );
    if (input.decision === "apply")
      await insertPostings(
        tx,
        [
          {
            userId: e.userId,
            type: e.type as never,
            amountCents: e.amountCents,
            wageClass: e.wageClass as never,
            memo: `${e.memo ?? e.type} (reviewed)`,
          },
        ],
        {
          effectiveDate: e.effectiveDate,
          jobId: e.jobId,
          refTable: e.refTable ?? "ledger_entries",
          refId: e.refId ?? e.id,
          actorUserId: actor.userId,
          today,
          keepDate: true,
        },
      );
    await audit({
      action: `ledger.review_${input.decision}`,
      entity: { type: "ledger_entry", id: e.id },
      after: { amount_cents: e.amountCents, type: e.type },
    });
    const soft = await tx
      .select({ id: settlements.id })
      .from(settlements)
      .where(
        and(
          eq(settlements.userId, e.userId),
          inArray(settlements.status, ["draft", "tech_review"]),
        ),
      );
    for (const s of soft) await refreshSettlement(tx, s.id);
    return { ok: true };
  },
  revalidate: () => PAY,
});

export const postAdjustment = action({
  perm: "payroll.manage",
  feature: "payroll",
  input: z.object({
    userId: uuid,
    amountCents: z
      .number()
      .int()
      .refine((n) => n !== 0, "Enter an amount."),
    memo: z.string().trim().min(3, "Say what it's for.").max(200),
    effectiveDate: day,
    settlementId: uuid.nullish(),
  }),
  audit: "ledger.adjustment",
  async run({ input, tx, actor, activity }) {
    const [u] = await tx
      .select({ workerType: users.workerType })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!u) throw new NotFoundError("Person");
    const today = todayKey(await companyTz(tx));
    const [id] = await insertPostings(
      tx,
      [
        {
          userId: input.userId,
          type: "adjustment",
          amountCents: input.amountCents,
          wageClass: "wage",
          // ⚖️ W-2 deductions go to admin review instead of applying automatically.
          needsReview: false,
          memo: input.memo,
        },
      ],
      {
        effectiveDate: input.effectiveDate,
        refTable: "settlements",
        refId: input.settlementId ?? null,
        actorUserId: actor.userId,
        today,
        keepDate: !!input.settlementId,
      },
    );
    if (input.settlementId) await refreshSettlement(tx, input.settlementId);
    await activity({
      entity: { type: "user", id: input.userId },
      kind: "ledger.adjustment",
      summary: `Pay adjustment ${input.amountCents > 0 ? "+" : ""}${formatMoney(input.amountCents)}`,
      data: { ledger_entry_id: id },
    });
    return { ledgerEntryId: id };
  },
  auditEntity: ({ input }) => ({ type: "user", id: input.userId }),
  revalidate: () => PAY,
});

/** Close a pay period now (normally the cron does this after close_delay_hours). */
export const closePeriodNow = action({
  perm: "payroll.manage",
  feature: "payroll",
  input: z.object({ payPeriodId: uuid }),
  audit: "pay_period.closed_manually",
  async run({ input, tx, actor }) {
    const [p] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, input.payPeriodId))
      .limit(1);
    if (!p) throw new NotFoundError("Pay period");
    const today = todayKey(await companyTz(tx));
    if (p.endsOn >= today)
      throw new ConflictError(
        "period_open",
        "This pay period hasn't ended yet.",
      );
    await closePayPeriod(tx, p.id, actor);
    const created = await generateSettlements(tx, p.id, actor);
    return { created };
  },
  revalidate: () => PAY,
});

// ------------------------------------------------------------------ bank details (tech)

export const saveBankDetails = action({
  perm: "payroll.bank_edit_own",
  feature: "payroll",
  input: z
    .object({
      holderName: z
        .string()
        .trim()
        .min(2, "Enter the account holder's name.")
        .max(120),
      routing: z
        .string()
        .trim()
        .regex(/^\d{9}$/, "Routing numbers have 9 digits."),
      account: z
        .string()
        .trim()
        .regex(/^\d{4,17}$/, "Account numbers have 4–17 digits."),
      accountConfirm: z.string().trim(),
      accountType: z.enum(["checking", "savings"]),
      holderType: z.enum(["personal", "business"]),
      authorize: zf.checkbox(),
      typedName: z.string().trim().min(2, "Type your full name."),
    })
    .superRefine((v, ctx) => {
      if (!isValidAba(v.routing))
        ctx.addIssue({
          code: "custom",
          path: ["routing"],
          message:
            "That routing number isn't valid. Check it on a check or your bank's site.",
        });
      if (!isValidAccountNumber(v.account))
        ctx.addIssue({
          code: "custom",
          path: ["account"],
          message: "Enter the account number.",
        });
      if (v.account !== v.accountConfirm)
        ctx.addIssue({
          code: "custom",
          path: ["accountConfirm"],
          message: "The account numbers don't match.",
        });
      if (!v.authorize)
        ctx.addIssue({
          code: "custom",
          path: ["authorize"],
          message: "Agree to the direct-deposit authorization.",
        });
    }),
  async run({ input, user, tx, actor, emit, audit, activity }) {
    const policy = await getCurrentPolicy("direct_deposit_auth", tx);
    const now = new Date();
    const l4 = last4(input.account);
    await tx
      .update(users)
      .set({
        bankRoutingEnc: encrypt(input.routing),
        bankAccountEnc: encrypt(input.account),
        bankLast4: l4,
        bankAccountType: input.accountType,
        bankHolderType: input.holderType,
        bankHolderNameEnc: encrypt(input.holderName.trim()),
        bankChangedAt: now,
        bankVerifiedAt: null,
        bankVerifiedBy: null,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));
    // Never store the numbers in the audit log: last 4 + the authorization evidence only.
    await audit({
      action: "user.bank_changed",
      entity: { type: "user", id: user.id },
      after: {
        last4: l4,
        account_type: input.accountType,
        holder_type: input.holderType,
        holder_name: input.holderName,
        authorization: {
          typed_name: input.typedName,
          policy_version_id: policy?.id ?? null,
          policy_sha256: policy?.sha256 ?? null,
          ip: actor.ip ?? null,
          at: now.toISOString(),
        },
      },
    });
    await emit(
      "user.bank_changed",
      { type: "user", id: user.id },
      { user_id: user.id, last4: l4 },
    );
    await activity({
      entity: { type: "user", id: user.id },
      kind: "user.bank_changed",
      summary: `Direct-deposit account changed (••${l4})`,
    });
    return { last4: l4 };
  },
  revalidate: () => ["/pay", "/pay/bank", "/pay/settlements"],
});

// ------------------------------------------------------------------ comp agreement

export const signCompAgreement = action({
  perm: "payroll.view_own",
  feature: "payroll",
  input: z.object({
    signerName: z.string().trim().min(2),
    esignConsent: z.literal(true),
    signatureMediaId: uuid,
    geo: z
      .object({
        lat: z.number(),
        lng: z.number(),
        accuracyM: z.number().nullish(),
      })
      .nullish(),
    deviceTs: z.string(),
    clientId: uuid,
  }),
  async run({ input, user, tx, actor, audit }) {
    const techCompId = await ensureTechComp(tx, user.id, actor);
    const st = await agreementFor(user.id, tx);
    if (!st) throw new NotFoundError("Agreement");
    const policy = await getCurrentPolicy("comp_agreement", tx);
    const { signatureId } = await captureSignature(
      tx,
      {
        docType: "comp_agreement",
        docId: techCompId,
        docSnapshot: st.doc,
        policyVersionIds: policy ? [policy.id] : [],
        signerName: input.signerName,
        signerKind: "user",
        signerUserId: user.id,
        signatureMediaId: input.signatureMediaId,
        channel: "in_person",
        esignConsent: true,
        consentText:
          "I agree to sign this compensation agreement electronically.",
        geo: input.geo ?? null,
        deviceTs: new Date(input.deviceTs),
      },
      actor,
    );
    await tx
      .update(techComp)
      .set({
        agreementSignatureId: signatureId,
        agreementPlanVersion: st.planVersion,
      })
      .where(eq(techComp.id, techCompId));
    await audit({
      action: "comp_agreement.signed",
      entity: { type: "user", id: user.id },
      after: {
        plan_key: st.planKey,
        plan_version: st.planVersion,
        signature_id: signatureId,
      },
    });
    return { signatureId };
  },
  revalidate: () => ["/pay", "/pay/agreement", "/team"],
});

// ------------------------------------------------------------------ plans & assignment (admin)

/** Emit comp_agreement.required for everyone on `planKey` whose signed version ≠ `version`. */
async function requireResign(
  tx: Tx,
  planKey: string,
  version: number,
  emit: ActionRunContext<unknown>["emit"],
  onlyUserId?: string,
) {
  const rows = await tx
    .select({
      userId: techComp.userId,
      planKey: techComp.planKey,
      signed: techComp.agreementPlanVersion,
      sig: techComp.agreementSignatureId,
      at: techComp.effectiveFrom,
      createdAt: techComp.createdAt,
    })
    .from(techComp)
    .innerJoin(users, eq(users.id, techComp.userId))
    .where(eq(users.status, "active"))
    .orderBy(desc(techComp.effectiveFrom), desc(techComp.createdAt));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    if (onlyUserId && r.userId !== onlyUserId) continue;
    if (r.planKey !== planKey) continue;
    if (r.sig && r.signed === version) continue;
    await emit(
      "comp_agreement.required",
      { type: "user", id: r.userId },
      { user_id: r.userId, plan_key: planKey, version },
    );
  }
}

export const savePlanVersion = action({
  perm: "comp_plans.manage",
  feature: "payroll",
  input: z.object({
    planKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,40}$/, "Use lowercase letters, numbers and _ only."),
    name: z.string().trim().min(2, "Name the plan.").max(80),
    effectiveFrom: day,
    config: z.unknown(),
  }),
  audit: "comp_plan.version_created",
  async run({ input, user, tx, emit }) {
    const parsed = CompPlanSchema.safeParse(input.config);
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const i of parsed.error.issues) {
        const k = `config.${i.path.join(".")}`;
        fe[k] = [...(fe[k] ?? []), i.message];
      }
      throw new ValidationError(
        fe,
        "The plan has errors. Check the highlighted fields.",
      );
    }
    const [last] = await tx
      .select({ version: compPlans.version })
      .from(compPlans)
      .where(eq(compPlans.planKey, input.planKey))
      .orderBy(desc(compPlans.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const [row] = await tx
      .insert(compPlans)
      .values({
        planKey: input.planKey,
        name: input.name,
        version,
        effectiveFrom: input.effectiveFrom,
        config: parsed.data as unknown as Record<string, unknown>,
        createdBy: user.id,
      })
      .returning({ id: compPlans.id });
    if (!row) throw new Error("plan insert failed");
    if (version > 1) await requireResign(tx, input.planKey, version, emit);
    return { planId: row.id, version };
  },
  auditEntity: ({ data }) => ({ type: "comp_plan", id: data.planId }),
  revalidate: () => ["/settings/commission", "/pay", "/pay/agreement", "/team"],
});

export const archivePlan = action({
  perm: "comp_plans.manage",
  feature: "payroll",
  input: z.object({ planKey: z.string().min(1), archived: z.boolean() }),
  audit: "comp_plan.archived",
  async run({ input, tx }) {
    const s = await settingsOf(tx);
    if (input.archived && input.planKey === s.payroll.default_plan_key)
      throw new ConflictError(
        "default_plan",
        "You can't archive the default plan.",
      );
    await tx
      .update(compPlans)
      .set({ archivedAt: input.archived ? new Date() : null })
      .where(eq(compPlans.planKey, input.planKey));
    return { ok: true };
  },
  revalidate: () => ["/settings/commission"],
});

const OverridesInput = z.object({
  rate_bps: z.number().int().min(0).max(10000).nullish(),
  by_service_type: z
    .record(z.string(), z.number().int().min(0).max(10000))
    .optional(),
  tech_keeps_cash: z.boolean().nullish(),
  cash_settlement: z.enum(["net_in_payout", "separate_remittance"]).nullish(),
});

/** Assign a plan + overrides to a person (history row in tech_comp). Audited. */
export const assignPlan = action({
  perm: "comp_plans.manage",
  feature: "payroll",
  input: z.object({
    userId: uuid,
    planKey: z.string().min(1),
    effectiveFrom: day,
    overrides: OverridesInput,
  }),
  audit: "tech_comp.assigned",
  async run({ input, user, tx, emit, activity }) {
    const [u] = await tx
      .select({ workerType: users.workerType })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!u) throw new NotFoundError("Person");
    const plans = await latestPlans(tx);
    const plan = plans.find((p) => p.planKey === input.planKey);
    if (!plan) throw new ValidationError({ planKey: ["Pick a plan."] });
    const o = input.overrides;
    const overrides = {
      ...(o.rate_bps != null ? { rate_bps: o.rate_bps } : {}),
      ...(o.by_service_type && Object.keys(o.by_service_type).length
        ? { by_service_type: o.by_service_type }
        : {}),
      ...(o.tech_keeps_cash != null
        ? { tech_keeps_cash: o.tech_keeps_cash }
        : {}),
      // ⚖️ W-2: cash is never netted against wages.
      ...(o.cash_settlement != null
        ? {
            cash_settlement:
              u.workerType === "w2"
                ? ("separate_remittance" as const)
                : o.cash_settlement,
          }
        : {}),
    };
    const [prev] = await tx
      .select()
      .from(techComp)
      .where(eq(techComp.userId, input.userId))
      .orderBy(desc(techComp.effectiveFrom), desc(techComp.createdAt))
      .limit(1);
    const sameTerms =
      prev?.planKey === input.planKey &&
      JSON.stringify(prev.overrides ?? {}) === JSON.stringify(overrides);
    const [row] = await tx
      .insert(techComp)
      .values({
        userId: input.userId,
        planKey: input.planKey,
        overrides,
        effectiveFrom: input.effectiveFrom,
        // Same plan and terms: the existing signature still covers it.
        agreementSignatureId: sameTerms
          ? (prev?.agreementSignatureId ?? null)
          : null,
        agreementPlanVersion: sameTerms
          ? (prev?.agreementPlanVersion ?? null)
          : null,
        createdBy: user.id,
      })
      .returning({ id: techComp.id });
    if (!row) throw new Error("tech_comp insert failed");
    if (!sameTerms)
      await emit(
        "comp_agreement.required",
        { type: "user", id: input.userId },
        {
          user_id: input.userId,
          plan_key: input.planKey,
          version: plan.version,
        },
      );
    await activity({
      entity: { type: "user", id: input.userId },
      kind: "tech_comp.assigned",
      summary: `Pay plan set to ${plan.name}${o.rate_bps != null ? ` at ${o.rate_bps / 100}%` : ""}`,
      data: { tech_comp_id: row.id, plan_key: input.planKey },
    });
    return { techCompId: row.id };
  },
  auditEntity: ({ input }) => ({ type: "user", id: input.userId }),
  revalidate: ({ input }) => [
    "/settings/commission",
    `/team/${input.userId}`,
    "/team",
    "/pay",
  ],
});

export const savePayrollSettings = action({
  perm: "comp_plans.manage",
  input: z.object({
    period: z.enum(["weekly", "biweekly", "semimonthly"]),
    weekStartsOn: z.coerce.number().int().min(0).max(6),
    biweeklyAnchor: day.optional(),
    closeDelayHours: z.coerce.number().int().min(0).max(240),
    reviewHours: z.coerce.number().int().min(0).max(240),
    negativeBalance: z.enum(["carry_forward", "request_remittance"]),
    bankChangeHoldHours: z.coerce.number().int().min(0).max(720),
    threshold1099Cents: z.number().int().min(0),
    defaultPlanKey: z.string().min(1),
    nachaEnabled: zf.checkbox(),
    nacha: z.object({
      immediate_destination: z
        .string()
        .trim()
        .regex(/^(\d{9})?$/, "9-digit routing number."),
      immediate_destination_name: z.string().trim().max(23),
      immediate_origin: z.string().trim().max(10),
      immediate_origin_name: z.string().trim().max(23),
      company_name: z.string().trim().max(16),
      company_id: z.string().trim().max(10),
      odfi_routing: z
        .string()
        .trim()
        .regex(/^(\d{9})?$/, "9-digit routing number."),
      entry_description: z.string().trim().max(10),
      company_account: z
        .string()
        .trim()
        .regex(/^(\d{4,17})?$/, "4–17 digits.")
        .optional(),
    }),
  }),
  async run({ input, tx, actor }) {
    const s = await settingsOf(tx);
    if (input.nachaEnabled) {
      const n = input.nacha;
      const missing: Record<string, string[]> = {};
      if (!n.immediate_destination)
        missing["nacha.immediate_destination"] = ["Required for NACHA files."];
      if (!n.immediate_origin)
        missing["nacha.immediate_origin"] = ["Required for NACHA files."];
      if (!n.company_name)
        missing["nacha.company_name"] = ["Required for NACHA files."];
      if (!n.company_id)
        missing["nacha.company_id"] = ["Required for NACHA files."];
      if (Object.keys(missing).length) throw new ValidationError(missing);
    }
    const acct = input.nacha.company_account;
    await updateSettings(
      tx,
      {
        payroll: {
          period: input.period,
          week_starts_on: input.weekStartsOn,
          biweekly_anchor: input.biweeklyAnchor ?? s.payroll.biweekly_anchor,
          close_delay_hours: input.closeDelayHours,
          review_hours: input.reviewHours,
          negative_balance: input.negativeBalance,
          bank_change_hold_hours: input.bankChangeHoldHours,
          threshold_1099_cents: input.threshold1099Cents,
          default_plan_key: input.defaultPlanKey,
          nacha_enabled: input.nachaEnabled,
          nacha: {
            immediate_destination: input.nacha.immediate_destination,
            immediate_destination_name: input.nacha.immediate_destination_name,
            immediate_origin: input.nacha.immediate_origin,
            immediate_origin_name: input.nacha.immediate_origin_name,
            company_name: input.nacha.company_name,
            company_id: input.nacha.company_id,
            odfi_routing: input.nacha.odfi_routing,
            entry_description: input.nacha.entry_description || "PAYROLL",
            ...(acct
              ? {
                  company_account_enc: encrypt(acct),
                  company_account_last4: last4(acct),
                }
              : {}),
          },
        },
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/commission"],
});

export const saveRoleRates = action({
  perm: "comp_plans.manage",
  input: z.object({
    rates: z.record(z.string(), z.number().int().min(0).max(10000).nullable()),
  }),
  async run({ input, tx, actor }) {
    const roleKeys = (await tx.select({ key: roles.key }).from(roles)).map(
      (r) => r.key,
    );
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.rates))
      if (v != null && roleKeys.includes(k)) clean[k] = v;
    const s = await settingsOf(tx);
    // Replace the record wholesale (deep merge can't delete keys).
    await updateSettings(
      tx,
      { payroll: { ...s.payroll, role_rates_bps: clean } },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/commission"],
});

export const addMileageRate = action({
  perm: "comp_plans.manage",
  input: z.object({
    effectiveFrom: day,
    centsPerMile: z.coerce.number().positive().max(500),
    source: z.string().trim().max(120).nullish(),
  }),
  audit: "mileage_rate.added",
  async run({ input, tx }) {
    const millicents = Math.round(input.centsPerMile * 1000);
    await tx
      .insert(mileageRates)
      .values({
        effectiveFrom: input.effectiveFrom,
        millicentsPerMile: millicents,
        source: input.source ?? null,
      })
      .onConflictDoUpdate({
        target: mileageRates.effectiveFrom,
        set: { millicentsPerMile: millicents, source: input.source ?? null },
      });
    return { ok: true };
  },
  revalidate: () => ["/settings/commission"],
});
