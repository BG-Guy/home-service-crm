import "server-only";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { hasCardProcessor } from "@/adapters/payments";
import { db, type Tx } from "@/db";
import {
  checkoutSessions,
  depositRequests,
  invoiceBalances,
  invoices,
  jobs,
  media,
  payments,
  users,
} from "@/db/schema";
import { syncInvoicePaymentState } from "@/features/invoices/api";
import { cancelScheduledMessages } from "@/features/messaging/api";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { getSettings, isEnabled } from "@/lib/settings";
import { revokePublicTokens } from "@/lib/tokens";
import type { Actor } from "@/lib/types";
import type {
  DepositBrief,
  InvoiceBalance,
  JobMoney,
  ReceiptData,
  RecordPaymentInput,
} from "./contracts";
import {
  type DepositFacts,
  evaluateDepositRules,
} from "./engine/deposit-rules";
import { configuredFee } from "./engine/fees";
import {
  activeDepositRules,
  balanceOf,
  companyState,
  depositFactsForEstimate,
  depositFactsForJob,
  depositPolicyShort,
  LIVE_DEPOSIT_STATUSES,
  METHOD_LABEL,
  methodLabel,
  OPEN_DEPOSIT_STATUSES,
  PAID_STATUSES,
  policySha,
  recomputeJobPaymentStatus,
  refundedByPayment,
  toDepositBrief,
  toPaymentBrief,
} from "./internal";

// B4 payments API (BUILD_PLAN §6.4, SPEC M09). Writes run in the caller's transaction,
// emit this module's events and write their own activity/audit rows.

export type * from "./contracts";

/** Derived balance (invoice_balances view). */
export async function getInvoiceBalance(
  invoiceId: string,
): Promise<InvoiceBalance> {
  const [b] = await db
    .select()
    .from(invoiceBalances)
    .where(eq(invoiceBalances.invoiceId, invoiceId))
    .limit(1);
  if (!b) throw new NotFoundError("Invoice");
  const totalCents = Number(b.totalCents);
  const paidCents = Number(b.paidCents);
  const refundedCents = Number(b.refundedCents);
  const creditedCents = Number(b.creditedCents);
  return {
    invoiceId,
    totalCents,
    paidCents,
    refundedCents,
    creditedCents,
    balanceCents: totalCents - paidCents + refundedCents - creditedCents,
  };
}

/** Everything money for a job: latest invoice balance, payments, deposits. */
export async function getJobMoney(jobId: string): Promise<JobMoney> {
  const [job] = await db
    .select({ paymentStatus: jobs.paymentStatus })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) throw new NotFoundError("Job");
  const [inv] = await db
    .select({ id: invoices.id, total: invoices.totalCents })
    .from(invoices)
    .where(
      and(eq(invoices.jobId, jobId), notInArray(invoices.status, ["void"])),
    )
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  const pays = await db
    .select()
    .from(payments)
    .where(eq(payments.jobId, jobId))
    .orderBy(desc(payments.createdAt));
  const refunded = await refundedByPayment(pays.map((p) => p.id));
  const deps = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.jobId, jobId))
    .orderBy(desc(depositRequests.createdAt));
  const ok = (s: string) => (PAID_STATUSES as readonly string[]).includes(s);
  const paidCents = pays
    .filter((p) => ok(p.status))
    .reduce((s, p) => s + p.amountCents - (refunded.get(p.id) ?? 0), 0);
  const depositPaidCents = pays
    .filter((p) => ok(p.status) && p.kind === "deposit")
    .reduce((s, p) => s + p.amountCents - (refunded.get(p.id) ?? 0), 0);
  const bal = inv ? await balanceOf(db, inv.id) : null;
  return {
    jobId,
    invoiceId: inv?.id ?? null,
    totalCents: inv ? Number(inv.total) : 0,
    balanceCents: bal ? bal.balanceCents : 0,
    paidCents,
    depositPaidCents,
    paymentStatus: job.paymentStatus as JobMoney["paymentStatus"],
    deposits: deps.map((d) =>
      toDepositBrief(
        d,
        pays.find((p) => p.id === d.paymentId)?.succeededAt ?? null,
      ),
    ),
    payments: pays.map((p) => toPaymentBrief(p, refunded.get(p.id) ?? 0)),
  };
}

const ENTRY: Record<RecordPaymentInput["method"], string> = {
  cash: "cash",
  check: "check",
  zelle: "p2p",
  venmo: "p2p",
  ach: "online",
  other: "p2p",
};

/** Extra optional fields accepted by recordPayment (additive; BUILD_PLAN §11.3). */
export interface RecordPaymentExtras {
  /** Offline capture: the proof photo's upload client id (resolved to a media id later). */
  proofClientId?: string | null;
  /** Skip the reference/photo rules (imports, seeds). */
  skipRules?: boolean;
  /** Mark verified immediately (office collected it in person with verify permission). */
  verified?: boolean;
}

/**
 * Manual methods (cash/check/Zelle/Venmo/ACH/other). Overpayment guard →
 * ConflictError('overpayment'); reference # / check-photo rules; status succeeded,
 * unverified; in-tx: invoice sync (B3) + job payment status (B2); emits
 * payment.succeeded (+ deposit.paid). Idempotent on clientId.
 */
export async function recordPayment(
  tx: Tx,
  input: RecordPaymentInput & RecordPaymentExtras,
  actor: Actor,
): Promise<{ paymentId: string; balanceCents: number | null }> {
  if (input.clientId) {
    const [prior] = await tx
      .select({ id: payments.id, invoiceId: payments.invoiceId })
      .from(payments)
      .where(eq(payments.clientId, input.clientId))
      .limit(1);
    if (prior) {
      const bal = prior.invoiceId
        ? ((await balanceOf(tx, prior.invoiceId))?.balanceCents ?? null)
        : null;
      return { paymentId: prior.id, balanceCents: bal };
    }
  }
  const settings = await getSettings();
  const amount = Math.round(input.amountCents);
  const tip = Math.max(0, Math.round(input.tipCents ?? 0));
  if (amount < 0 || tip < 0)
    throw new ValidationError({ amountCents: ["Enter a positive amount."] });
  if (input.kind === "tip_only" ? tip === 0 || amount !== 0 : amount === 0)
    throw new ValidationError({
      amountCents: ["Enter an amount greater than zero."],
    });
  const reference = input.reference?.trim() || null;
  if (!input.skipRules) {
    const needRef = (
      settings.payments.reference_required as readonly string[]
    ).includes(input.method);
    if (needRef && !reference)
      throw new ValidationError({
        reference: [
          input.method === "check"
            ? "Enter the check number."
            : `Enter the ${METHOD_LABEL[input.method] ?? "payment"} confirmation #.`,
        ],
      });
    if (
      input.method === "check" &&
      settings.payments.require_check_photo &&
      !input.proofMediaId &&
      !input.proofClientId
    )
      throw new ValidationError({
        proofMediaId: ["Take a photo of the check."],
      });
  }

  // Resolve the job/invoice and guard against overpayment.
  let jobId = input.jobId ?? null;
  let invoiceId = input.invoiceId ?? null;
  if (invoiceId) {
    const [inv] = await tx
      .select({ jobId: invoices.jobId, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "void")
      throw new ConflictError("invoice_void", "This invoice was voided.");
    jobId = jobId ?? inv.jobId;
  } else if (jobId && input.kind !== "deposit") {
    const [inv] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.jobId, jobId), notInArray(invoices.status, ["void"])),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    invoiceId = inv?.id ?? null;
  }
  if (invoiceId && input.kind !== "tip_only") {
    const bal = await balanceOf(tx, invoiceId);
    if (bal && amount > bal.balanceCents)
      throw new ConflictError(
        "overpayment",
        `That's more than the ${formatMoney(Math.max(0, bal.balanceCents))} balance due.`,
      );
  }
  let deposit: typeof depositRequests.$inferSelect | null = null;
  if (input.depositRequestId) {
    const [d] = await tx
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.id, input.depositRequestId))
      .limit(1);
    if (!d) throw new NotFoundError("Deposit");
    if (!(OPEN_DEPOSIT_STATUSES as readonly string[]).includes(d.status))
      throw new ConflictError(
        "deposit_closed",
        "This deposit was already paid or closed.",
      );
    if (amount > d.amountCents)
      throw new ConflictError(
        "overpayment",
        `The deposit is ${formatMoney(d.amountCents)}.`,
      );
    deposit = d;
    jobId = jobId ?? d.jobId;
  }

  // Resolve an offline proof photo uploaded before this payment existed.
  let proofMediaId = input.proofMediaId ?? null;
  if (!proofMediaId && input.proofClientId) {
    const [m] = await tx
      .select({ id: media.id })
      .from(media)
      .where(eq(media.clientId, input.proofClientId))
      .limit(1);
    proofMediaId = m?.id ?? null;
  }
  if (proofMediaId) {
    // The proof photo must be the recorder's own upload (or this job's photo) and not
    // already attached elsewhere: it is re-parented and evidence-locked below.
    const [m] = await tx
      .select({
        uploaderId: media.uploaderId,
        jobId: media.jobId,
        entityType: media.entityType,
        evidenceLocked: media.evidenceLocked,
        deletedAt: media.deletedAt,
      })
      .from(media)
      .where(eq(media.id, proofMediaId))
      .limit(1);
    const mine =
      !!m && (m.uploaderId === actor.userId || (!!jobId && m.jobId === jobId));
    if (
      !m ||
      m.deletedAt ||
      !mine ||
      m.evidenceLocked ||
      (m.entityType != null && m.entityType !== "job")
    )
      throw new ValidationError({
        proofMediaId: ["That photo can't be used as proof. Take a new one."],
      });
  }

  const bps = settings.payments.fee_pct_by_method[input.method] ?? 0;
  const fee = configuredFee({ amountCents: amount, tipCents: tip, bps });
  const now = new Date();
  const kind =
    input.kind === "payment" && deposit ? ("deposit" as const) : input.kind;
  // A deposit paid when the job's invoice already exists is applied right away.
  let linkInvoice = invoiceId;
  if (kind === "deposit" && !linkInvoice && jobId) {
    const [inv] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.jobId, jobId), notInArray(invoices.status, ["void"])),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    linkInvoice = inv?.id ?? null;
  }
  // An explicit null means "nobody collected it in person" (e.g. a mailed check).
  const collectedBy =
    input.collectedByUserId !== undefined
      ? input.collectedByUserId
      : input.method === "cash" || input.method === "check"
        ? actor.userId
        : null;
  const [row] = await tx
    .insert(payments)
    .values({
      invoiceId: linkInvoice,
      jobId,
      customerId: input.customerId,
      depositRequestId: deposit?.id ?? null,
      kind,
      method: input.method,
      provider: "manual",
      status: "succeeded",
      amountCents: amount,
      tipCents: tip,
      feeCents: fee.feeCents,
      feeOnTipCents: fee.feeOnTipCents,
      feeSource: "configured",
      entryMode: ENTRY[input.method],
      reference,
      proofMediaId,
      collectedByUserId: collectedBy,
      payerName: input.payerName?.trim() || null,
      verifiedAt: input.verified ? now : null,
      verifiedBy: input.verified ? actor.userId : null,
      succeededAt: input.clientTs ?? now,
      clientId: input.clientId ?? null,
      raw: input.proofClientId
        ? { proof_client_id: input.proofClientId }
        : null,
    })
    .returning({ id: payments.id });
  if (!row) throw new Error("payment insert failed");
  if (proofMediaId) {
    await tx
      .update(media)
      .set({
        entityType: "payment",
        entityId: row.id,
        evidenceLocked: true,
        ...(jobId ? { jobId } : {}),
        customerId: input.customerId,
      })
      .where(eq(media.id, proofMediaId));
  }

  let balance: number | null = null;
  if (linkInvoice) {
    balance = (await syncInvoicePaymentState(tx, linkInvoice, actor))
      .balanceCents;
  }
  if (deposit) {
    await tx
      .update(depositRequests)
      .set({
        status: linkInvoice ? "applied" : "paid",
        paymentId: row.id,
        updatedAt: now,
      })
      .where(eq(depositRequests.id, deposit.id));
  }
  if (jobId) await recomputeJobPaymentStatus(tx, jobId);
  // An open deposit request the invoice payments now cover is moot (QA2 re-check).
  if (linkInvoice && kind !== "tip_only")
    await settleCoveredDeposits(tx, jobId, actor);

  const entityRef = { type: "payment", id: row.id } as const;
  await emit(
    tx,
    "payment.succeeded",
    entityRef,
    {
      payment_id: row.id,
      invoice_id: linkInvoice,
      method: input.method,
      amount_cents: amount,
      collected_by: collectedBy,
      job_id: jobId,
      customer_id: input.customerId,
      kind,
      tip_cents: tip,
      deposit_request_id: deposit?.id ?? null,
      provider: "manual",
      entry_mode: ENTRY[input.method],
    },
    { actor },
  );
  await writeActivity(tx, {
    entity: jobId
      ? { type: "job", id: jobId }
      : { type: "customer", id: input.customerId },
    customerId: input.customerId,
    jobId,
    kind: "payment.succeeded",
    summary: `${kind === "deposit" ? "Deposit" : kind === "tip_only" ? "Tip" : "Payment"} ${formatMoney(amount + tip)} by ${METHOD_LABEL[input.method]?.toLowerCase() ?? input.method}`,
    data: { payment_id: row.id, amount_cents: amount, tip_cents: tip },
    actorUserId: actor.userId,
  });
  if (deposit) {
    await emit(
      tx,
      "deposit.paid",
      { type: "deposit_request", id: deposit.id },
      { deposit_request_id: deposit.id, payment_id: row.id },
      { actor },
    );
    if (jobId)
      await writeActivity(tx, {
        entity: { type: "job", id: jobId },
        customerId: input.customerId,
        jobId,
        kind: "deposit.paid",
        summary: `Deposit ${formatMoney(amount)} paid`,
        data: { deposit_request_id: deposit.id, payment_id: row.id },
        actorUserId: actor.userId,
      });
  }
  return { paymentId: row.id, balanceCents: balance };
}

/**
 * On invoice creation: link the job's succeeded deposit payments (invoice_id set),
 * deposit_requests → applied; audited. Idempotent.
 */
export async function linkDepositsToInvoice(
  tx: Tx,
  jobId: string,
  invoiceId: string,
  actor: Actor,
): Promise<{ linkedPaymentIds: string[] }> {
  const rows = await tx
    .update(payments)
    .set({ invoiceId, updatedAt: new Date() })
    .where(
      and(
        eq(payments.jobId, jobId),
        eq(payments.kind, "deposit"),
        inArray(payments.status, [...PAID_STATUSES]),
        isNull(payments.invoiceId),
      ),
    )
    .returning({ id: payments.id, amount: payments.amountCents });
  if (rows.length) {
    await tx
      .update(depositRequests)
      .set({ status: "applied", updatedAt: new Date() })
      .where(
        and(
          eq(depositRequests.jobId, jobId),
          inArray(depositRequests.status, ["paid", "held"]),
        ),
      );
    await writeAudit(tx, {
      actor,
      action: "deposit.linked",
      entity: { type: "invoice", id: invoiceId },
      after: { payment_ids: rows.map((r) => r.id) },
      full: true,
    });
    const [j] = await tx
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    await writeActivity(tx, {
      entity: { type: "invoice", id: invoiceId },
      customerId: j?.customerId ?? null,
      jobId,
      kind: "deposit.applied",
      summary: `Deposit ${formatMoney(rows.reduce((s, r) => s + r.amount, 0))} applied to the invoice`,
      data: { payment_ids: rows.map((r) => r.id) },
      actorUserId: actor.userId,
    });
  }
  return { linkedPaymentIds: rows.map((r) => r.id) };
}

/**
 * Evaluates deposit_rules (priority, first match). Creates a deposit_request ('required')
 * and emits deposit.required; returns the live one when it already exists; null when no
 * rule matches or the `deposits` flag is off. No processor → mode falls back to manual.
 */
export async function ensureDepositRequest(
  tx: Tx,
  input: {
    jobId?: string | null;
    estimateId?: string | null;
    optionId?: string | null;
    context:
      | "estimate_approved"
      | "job_scheduled"
      | "special_order"
      | "risk_changed"
      | "manual"
      /** Re-evaluated after the job's lines/schedule changed before the visit (T6-09). */
      | "lines_changed";
  },
  actor: Actor,
): Promise<DepositBrief | null> {
  if (!(await isEnabled("deposits"))) return null;
  if (!input.jobId && !input.estimateId) return null;
  const scope = [
    input.jobId ? eq(depositRequests.jobId, input.jobId) : undefined,
    input.estimateId
      ? eq(depositRequests.estimateId, input.estimateId)
      : undefined,
  ].filter(Boolean);
  const existing = await tx
    .select()
    .from(depositRequests)
    .where(
      and(
        scope.length === 2 ? or(...scope) : scope[0],
        inArray(depositRequests.status, [...LIVE_DEPOSIT_STATUSES]),
      ),
    )
    .orderBy(desc(depositRequests.createdAt))
    .limit(1);
  if (existing[0]) {
    const d = existing[0];
    // An estimate deposit becomes the job's once the job exists.
    if (input.jobId && !d.jobId)
      await tx
        .update(depositRequests)
        .set({ jobId: input.jobId, updatedAt: new Date() })
        .where(eq(depositRequests.id, d.id));
    return toDepositBrief(
      { ...d, jobId: d.jobId ?? input.jobId ?? null },
      null,
    );
  }

  const settings = await getSettings();
  let facts: DepositFacts | null = null;
  let customerId: string | null = null;
  let jobId = input.jobId ?? null;
  if (input.estimateId && (input.context === "estimate_approved" || !jobId)) {
    const ef = await depositFactsForEstimate(input.estimateId, input.optionId);
    if (ef) {
      facts = ef.facts;
      customerId = ef.customerId;
      jobId = jobId ?? ef.jobId;
    }
  }
  if (!facts && jobId) {
    const jf = await depositFactsForJob(jobId);
    if (jf) {
      facts = jf.facts;
      customerId = jf.customerId;
    }
  }
  if (!facts || !customerId) return null;
  // Don't ask for a deposit once the job is (pre)paid.
  if (jobId) {
    const paid = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.jobId, jobId),
          inArray(payments.status, [...PAID_STATUSES]),
        ),
      )
      .limit(1);
    if (paid.length) return null;
  }
  const decision = evaluateDepositRules(await activeDepositRules(), facts, {
    hasProcessor: hasCardProcessor(),
    holdMaxDaysOut: settings.deposits.hold_max_days_out,
    defaultRoundToCents: settings.deposits.round_to_cents,
    state: await companyState(),
    capWarnings: settings.compliance.deposit_cap_warnings,
  });
  if (!decision) return null;
  const policyId =
    decision.policyVersionId ??
    (await getCurrentPolicy("deposit", tx))?.id ??
    null;
  const now = new Date();
  const dueAt =
    settings.deposits.due_hours != null
      ? new Date(now.getTime() + settings.deposits.due_hours * 3_600_000)
      : null;
  const [row] = await tx
    .insert(depositRequests)
    .values({
      jobId,
      estimateId: input.estimateId ?? null,
      ruleId: decision.ruleId,
      amountCents: decision.amountCents,
      mode: decision.mode,
      status: "required",
      policyVersionId: policyId,
      policySha256: await policySha(policyId),
      dueAt,
      capWarning: decision.capWarning,
    })
    .returning();
  if (!row) throw new Error("deposit insert failed");
  const ref = { type: "deposit_request", id: row.id } as const;
  await emit(
    tx,
    "deposit.required",
    ref,
    {
      deposit_request_id: row.id,
      job_id: jobId,
      amount_cents: row.amountCents,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity: jobId
      ? { type: "job", id: jobId }
      : { type: "estimate", id: input.estimateId as string },
    customerId,
    jobId,
    kind: "deposit.required",
    summary: `Deposit ${formatMoney(row.amountCents)} required (${decision.ruleName})`,
    data: {
      deposit_request_id: row.id,
      context: input.context,
      mode: row.mode,
      fell_back_to_manual: decision.fellBackToManual,
    },
    actorUserId: actor.userId,
  });
  return toDepositBrief(row, null);
}

/**
 * QA2: a not-started job whose lines/risk no longer match ANY deposit rule drops the
 * UNPAID deposit request a rule created automatically (status → expired): pay links
 * revoked, open checkouts expired, the queued `deposit.request` texts (and their 24 h
 * reminder) canceled, with audit + activity. A request an office user created by hand
 * (no rule) is never touched, nor one that's paid, held or waived. Returns the
 * canceled request id, or null. The caller checks the job hasn't started.
 */
export async function cancelUnneededDeposit(
  tx: Tx,
  jobId: string,
  actor: Actor,
): Promise<string | null> {
  if (!(await isEnabled("deposits"))) return null;
  const [d] = await tx
    .select()
    .from(depositRequests)
    .where(
      and(
        eq(depositRequests.jobId, jobId),
        inArray(depositRequests.status, [...OPEN_DEPOSIT_STATUSES]),
        isNotNull(depositRequests.ruleId),
        isNull(depositRequests.paymentId),
      ),
    )
    .orderBy(desc(depositRequests.createdAt))
    .limit(1);
  if (!d) return null;
  const jf = await depositFactsForJob(jobId);
  if (!jf) return null;
  const settings = await getSettings();
  const decision = evaluateDepositRules(await activeDepositRules(), jf.facts, {
    hasProcessor: hasCardProcessor(),
    holdMaxDaysOut: settings.deposits.hold_max_days_out,
    defaultRoundToCents: settings.deposits.round_to_cents,
    state: await companyState(),
    capWarnings: settings.compliance.deposit_cap_warnings,
  });
  if (decision) return null; // still required (amount changes are left alone)
  const now = new Date();
  const [row] = await tx
    .update(depositRequests)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(depositRequests.id, d.id),
        inArray(depositRequests.status, [...OPEN_DEPOSIT_STATUSES]),
      ),
    )
    .returning({ id: depositRequests.id });
  if (!row) return null;
  const ref = { type: "deposit_request", id: d.id } as const;
  await revokePublicTokens(tx, { kind: "pay", entity: ref });
  await tx
    .update(checkoutSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(checkoutSessions.depositRequestId, d.id),
        eq(checkoutSessions.status, "open"),
      ),
    );
  const canceledSends = await cancelScheduledMessages(
    tx,
    { entity: ref },
    "deposit_not_needed",
  );
  await writeAudit(tx, {
    actor,
    action: "deposit.canceled",
    entity: ref,
    before: { status: d.status, amount_cents: d.amountCents },
    after: { status: "expired", reason: "no_rule_applies" },
    full: true,
  });
  await writeActivity(tx, {
    entity: { type: "job", id: jobId },
    customerId: jf.customerId,
    jobId,
    kind: "deposit.canceled",
    summary: `Deposit request ${formatMoney(d.amountCents)} canceled: no deposit rule applies to the job anymore`,
    data: {
      deposit_request_id: d.id,
      rule_id: d.ruleId,
      canceled_sends: canceledSends,
    },
    actorUserId: actor.userId,
  });
  return d.id;
}

/**
 * QA2 re-check: an open deposit request (required/requested, never paid) is moot once
 * payments on the job's invoice cover its amount, e.g. the office asked for $50 by
 * hand and the customer then paid $150 on the invoice. Each such request is closed as
 * satisfied — status `waived` (nothing owed, like an office waiver) with the reason in
 * `waive_reason` and no `waived_by` (the system did it) — its pay links revoked, open
 * checkouts expired and queued `deposit.request` texts canceled
 * (`deposit_covered_by_payments`), with audit + activity. Deposits that were paid,
 * held or applied are never touched. Idempotent; returns the closed request ids.
 * Called from recordPayment (same transaction, so the job header is right at once)
 * and from the `payment.succeeded` handler (card / webhook payments).
 */
export async function settleCoveredDeposits(
  tx: Tx,
  jobId: string | null | undefined,
  actor: Actor,
): Promise<string[]> {
  if (!jobId) return [];
  const open = await tx
    .select()
    .from(depositRequests)
    .where(
      and(
        eq(depositRequests.jobId, jobId),
        inArray(depositRequests.status, [...OPEN_DEPOSIT_STATUSES]),
        isNull(depositRequests.paymentId),
      ),
    );
  if (open.length === 0) return [];
  // Paid on the job's (non-void) invoices, net of refunds; tips aren't in the view.
  const invs = await tx
    .select({
      number: invoices.number,
      net: sql<number>`(${invoiceBalances.paidCents} - ${invoiceBalances.refundedCents})::int`,
    })
    .from(invoices)
    .innerJoin(invoiceBalances, eq(invoiceBalances.invoiceId, invoices.id))
    .where(
      and(eq(invoices.jobId, jobId), notInArray(invoices.status, ["void"])),
    )
    .orderBy(desc(invoices.createdAt));
  const paidNet = invs.reduce((a, r) => a + Math.max(0, Number(r.net)), 0);
  if (paidNet <= 0) return [];
  const numbers = invs
    .filter((r) => Number(r.net) > 0)
    .map((r) => r.number)
    .join(", ");
  const reason = `covered by ${formatMoney(paidNet)} paid on ${numbers}`;
  const [job] = await tx
    .select({ customerId: jobs.customerId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  const closed: string[] = [];
  const now = new Date();
  for (const d of open) {
    if (d.amountCents > paidNet) continue;
    const [row] = await tx
      .update(depositRequests)
      .set({ status: "waived", waiveReason: reason, updatedAt: now })
      .where(
        and(
          eq(depositRequests.id, d.id),
          inArray(depositRequests.status, [...OPEN_DEPOSIT_STATUSES]),
          isNull(depositRequests.paymentId),
        ),
      )
      .returning({ id: depositRequests.id });
    if (!row) continue;
    const ref = { type: "deposit_request", id: d.id } as const;
    await revokePublicTokens(tx, { kind: "pay", entity: ref });
    await tx
      .update(checkoutSessions)
      .set({ status: "expired" })
      .where(
        and(
          eq(checkoutSessions.depositRequestId, d.id),
          eq(checkoutSessions.status, "open"),
        ),
      );
    const canceledSends = await cancelScheduledMessages(
      tx,
      { entity: ref },
      "deposit_covered_by_payments",
    );
    await writeAudit(tx, {
      actor,
      action: "deposit.satisfied",
      entity: ref,
      before: { status: d.status, amount_cents: d.amountCents },
      after: {
        status: "waived",
        reason: "covered_by_invoice_payments",
        paid_net_cents: paidNet,
      },
      full: true,
    });
    await writeActivity(tx, {
      entity: { type: "job", id: jobId },
      customerId: job?.customerId ?? null,
      jobId,
      kind: "deposit.satisfied",
      summary: `Deposit request ${formatMoney(d.amountCents)} closed: ${reason}`,
      data: {
        deposit_request_id: d.id,
        paid_net_cents: paidNet,
        canceled_sends: canceledSends,
      },
      actorUserId: actor.userId,
    });
    closed.push(d.id);
  }
  return closed;
}

/** What deposit the rules would ask for on this estimate option (no insert). */
export async function previewDeposit(input: {
  estimateId: string;
  optionId?: string | null;
}): Promise<{
  amountCents: number;
  mode: DepositBrief["mode"];
  ruleName: string;
  policyShort: string;
  capWarning: string | null;
} | null> {
  if (!(await isEnabled("deposits"))) return null;
  const ef = await depositFactsForEstimate(input.estimateId, input.optionId);
  if (!ef) return null;
  const settings = await getSettings();
  const d = evaluateDepositRules(await activeDepositRules(), ef.facts, {
    hasProcessor: hasCardProcessor(),
    holdMaxDaysOut: settings.deposits.hold_max_days_out,
    defaultRoundToCents: settings.deposits.round_to_cents,
    state: await companyState(),
    capWarnings: settings.compliance.deposit_cap_warnings,
  });
  if (!d) return null;
  return {
    amountCents: d.amountCents,
    mode: d.mode,
    ruleName: d.ruleName,
    policyShort: await depositPolicyShort(),
    capWarning: d.capWarning,
  };
}

/** Log the special-order PO date on the job's deposit (non-refundable from then on). */
export async function markSpecialOrderPo(
  tx: Tx,
  jobId: string,
  at: Date,
  actor: Actor,
): Promise<void> {
  const rows = await tx
    .update(depositRequests)
    .set({ specialOrderPoAt: at, updatedAt: new Date() })
    .where(
      and(
        eq(depositRequests.jobId, jobId),
        isNull(depositRequests.specialOrderPoAt),
        inArray(depositRequests.status, [...LIVE_DEPOSIT_STATUSES]),
      ),
    )
    .returning({ id: depositRequests.id });
  if (rows.length) {
    await writeAudit(tx, {
      actor,
      action: "deposit.po_logged",
      entity: { type: "job", id: jobId },
      after: {
        at: at.toISOString(),
        deposit_request_ids: rows.map((r) => r.id),
      },
      full: true,
    });
    const [j] = await tx
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    await writeActivity(tx, {
      entity: { type: "job", id: jobId },
      customerId: j?.customerId ?? null,
      jobId,
      kind: "deposit.po_logged",
      summary: "Special-order part ordered — deposit is now non-refundable",
      actorUserId: actor.userId,
    });
  }
}

/** Schedule-board flags: deposit required (unpaid) / paid, per job. */
export async function getDepositFlags(
  jobIds: string[],
): Promise<
  Record<string, { required: boolean; paid: boolean; amountCents: number }>
> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      jobId: depositRequests.jobId,
      status: depositRequests.status,
      amount: depositRequests.amountCents,
    })
    .from(depositRequests)
    .where(
      and(
        inArray(depositRequests.jobId, ids),
        inArray(depositRequests.status, [...LIVE_DEPOSIT_STATUSES]),
      ),
    );
  const out: Record<
    string,
    { required: boolean; paid: boolean; amountCents: number }
  > = {};
  for (const r of rows) {
    if (!r.jobId) continue;
    const cur = out[r.jobId] ?? {
      required: false,
      paid: false,
      amountCents: 0,
    };
    const open = (OPEN_DEPOSIT_STATUSES as readonly string[]).includes(
      r.status,
    );
    if (open) {
      cur.required = true;
      cur.amountCents = r.amount;
    } else if (r.status !== "waived") {
      cur.paid = true;
      if (!cur.required) cur.amountCents = r.amount;
    }
    out[r.jobId] = cur;
  }
  return out;
}

function authCodeOf(raw: unknown): string | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const charge = (r.latest_charge ?? {}) as Record<string, unknown>;
  const v = charge.authorization_code ?? r.authorization_code;
  return typeof v === "string" ? v : null;
}

/** Data for a receipt (B3 receipt view, B5 template context). */
export async function getPaymentReceiptData(
  paymentId: string,
): Promise<ReceiptData | null> {
  const [p] = await db
    .select({ p: payments, jobNumber: jobs.number, collectorName: users.name })
    .from(payments)
    .leftJoin(jobs, eq(jobs.id, payments.jobId))
    .leftJoin(users, eq(users.id, payments.collectedByUserId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p) return null;
  const pay = p.p;
  const remaining = pay.invoiceId
    ? ((await balanceOf(db, pay.invoiceId))?.balanceCents ?? null)
    : null;
  return {
    paymentId: pay.id,
    invoiceId: pay.invoiceId,
    jobId: pay.jobId,
    jobNumber: p.jobNumber ?? null,
    customerId: pay.customerId,
    amountCents: pay.amountCents,
    tipCents: pay.tipCents,
    method: pay.method,
    methodLabel:
      pay.method === "card" ? methodLabel(pay) : pay.method.toLowerCase(),
    last4: pay.cardLast4,
    // Manual methods' entry mode just repeats the method ("Method check · Entry
    // check", T2-20); it only means something for cards (tap/chip/online/wallet).
    entryMode: pay.method === "card" ? pay.entryMode : null,
    authCode: authCodeOf(pay.raw),
    at: pay.succeededAt ?? pay.createdAt,
    collectedByName: p.collectorName ?? null,
    remainingBalanceCents: remaining,
  };
}
