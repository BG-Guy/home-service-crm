import "server-only";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { aiProviderName, queueAiTask } from "@/adapters/ai";
import type { Tx } from "@/db";
import {
  approvals,
  fuelLogs,
  jobs,
  media,
  partPurchases,
  serviceRecords,
  toolMaintenanceLogs,
} from "@/db/schema";
import { createApproval, decideApproval } from "@/features/approvals/api";
import { attachMedia } from "@/features/media/api";
import { recomputeJobFinancials } from "@/features/payroll/server/financials";
import { insertPostings } from "@/features/payroll/server/ledger";
import {
  companyTz,
  emitB6,
  settingsOf,
  todayKey,
} from "@/features/payroll/server/util";
import { writeActivity } from "@/lib/activity";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { dateKey } from "@/lib/time";
import { type Actor, SYSTEM_ACTOR } from "@/lib/types";
import type { CreatePartPurchaseInput } from "../contracts";
import {
  type AutoApproveResult,
  evaluateAutoApprove,
  type PurchaseFlag,
} from "../rules";

// Part purchases, both money trees (SPEC M15):
//   company (stock/po/card/account) → approved immediately, no ledger line;
//   tech (personal card/cash) → pending → auto-approve rules or an approvals row →
//     approved: job purchase → recompute job financials (reimbursement_parts to the
//     purchaser + tech_parts deducted from the commission base); non-job purchase →
//     reimbursement_expense (never touches a commission base).

export type PurchaseRow = typeof partPurchases.$inferSelect;

export const CATEGORY_LABEL: Record<string, string> = {
  part: "Part",
  fuel: "Fuel",
  vehicle: "Vehicle supplies",
  tool: "Tool",
  supplies: "Supplies",
  other: "Other",
};

function payload(p: PurchaseRow, approvalId: string | null) {
  return {
    part_purchase_id: p.id,
    paid_by: (p.paidBy === "company" ? "company" : "tech") as
      | "company"
      | "tech",
    total_cents: p.totalCents,
    purchaser_user_id: p.purchaserUserId ?? "",
    job_id: p.jobId,
    category: p.category,
    approval_id: approvalId,
  };
}

async function loadPurchase(tx: Tx, id: string): Promise<PurchaseRow> {
  const [p] = await tx
    .select()
    .from(partPurchases)
    .where(eq(partPurchases.id, id))
    .limit(1);
  if (!p) throw new NotFoundError("Receipt");
  return p;
}

/** Reference date for the "within N days of the job" rule (job day, else submission day). */
async function referenceDate(tx: Tx, p: PurchaseRow, tz: string) {
  if (p.jobId) {
    const [j] = await tx
      .select({
        completedAt: jobs.completedAt,
        startedAt: jobs.startedAt,
        scheduledStart: jobs.scheduledStart,
      })
      .from(jobs)
      .where(eq(jobs.id, p.jobId))
      .limit(1);
    const at = j?.completedAt ?? j?.startedAt ?? j?.scheduledStart ?? null;
    if (at) return dateKey(at, tz);
  }
  return dateKey(p.createdAt, tz);
}

// ------------------------------------------------------------------ receipt media (QA2 NEW-4)

/** Who may use an uploaded file as the receipt of a purchase. */
export interface ReceiptMediaPolicy {
  /** Users whose own uploads may be used: the purchaser and whoever submits it. */
  uploaders: readonly (string | null | undefined)[];
  /** Staff who approve reimbursements may attach anyone's upload. */
  anyUploader?: boolean;
  /** The purchase being updated (re-attaching its own receipt is fine). */
  purchaseId?: string | null;
}

const RECEIPT_KINDS: ReadonlySet<string> = new Set(["receipt", "document"]);
/** Tool maintenance takes a photo tagged as a receipt (ToolSheets). */
const RECEIPT_TAGS: ReadonlySet<string> = new Set(["receipt", "document"]);
/** Upload contexts a receipt is re-filed from; anything else stays where it is. */
const REBINDABLE: ReadonlySet<string> = new Set(["job"]);

const ALREADY_USED = "That receipt is already on another claim.";

/**
 * A receipt must be the submitter's own upload (QA2 NEW-4: tech1 claimed tech2's
 * receipt twice and got two auto-approved reimbursements), a receipt or document,
 * and not already the receipt of another purchase, fuel log, service record or tool
 * maintenance entry. Returns whether the file may be re-filed under the purchase:
 * only unattached and job-level uploads are; a file that belongs to another record
 * (a planned fuel log, a tool) keeps its owner and the purchase just points at it.
 */
export async function assertReceiptMedia(
  tx: Tx,
  mediaId: string,
  policy: ReceiptMediaPolicy,
): Promise<{ rebind: boolean }> {
  const refuse = (message: string): never => {
    throw new ValidationError({ receiptMediaId: [message] }, message);
  };
  const [m] = await tx
    .select({
      kind: media.kind,
      tag: media.tag,
      uploaderId: media.uploaderId,
      entityType: media.entityType,
      entityId: media.entityId,
      evidenceLocked: media.evidenceLocked,
      deletedAt: media.deletedAt,
    })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  if (!m || m.deletedAt)
    return refuse("That receipt photo is gone. Take a new one.");
  if (!RECEIPT_KINDS.has(m.kind) && !RECEIPT_TAGS.has(m.tag ?? ""))
    return refuse("That photo isn't a receipt. Take a photo of the receipt.");
  const mine =
    !!m.uploaderId && policy.uploaders.some((u) => !!u && u === m.uploaderId);
  if (!mine && !policy.anyUploader)
    return refuse("Use a receipt photo you took yourself.");
  const own =
    !!policy.purchaseId &&
    m.entityType === "part_purchase" &&
    m.entityId === policy.purchaseId;
  if (m.entityType === "part_purchase" && !own) return refuse(ALREADY_USED);
  if (m.evidenceLocked && !own) return refuse(ALREADY_USED);
  const [claimed] = await tx
    .select({ id: partPurchases.id })
    .from(partPurchases)
    .where(
      and(
        eq(partPurchases.receiptMediaId, mediaId),
        policy.purchaseId ? ne(partPurchases.id, policy.purchaseId) : undefined,
      ),
    )
    .limit(1);
  if (claimed) return refuse(ALREADY_USED);
  // Logged elsewhere already (e.g. a company-paid fill, then claimed as personal).
  const [fuel] = await tx
    .select({ id: fuelLogs.id })
    .from(fuelLogs)
    .where(eq(fuelLogs.receiptMediaId, mediaId))
    .limit(1);
  const [service] = fuel
    ? []
    : await tx
        .select({ id: serviceRecords.id })
        .from(serviceRecords)
        .where(eq(serviceRecords.receiptMediaId, mediaId))
        .limit(1);
  const [maint] =
    fuel || service
      ? []
      : await tx
          .select({ id: toolMaintenanceLogs.id })
          .from(toolMaintenanceLogs)
          .where(eq(toolMaintenanceLogs.mediaId, mediaId))
          .limit(1);
  if (fuel || service || maint) return refuse(ALREADY_USED);
  return { rebind: m.entityType == null || REBINDABLE.has(m.entityType) };
}

/**
 * Another live claim carries the same file (same original or stored hash): a re-upload
 * of a receipt that was already reimbursed or is waiting. Goes to review, never auto.
 */
async function hasDuplicateReceipt(tx: Tx, p: PurchaseRow): Promise<boolean> {
  if (!p.receiptMediaId) return false;
  const [m] = await tx
    .select({ a: media.sha256Original, b: media.sha256Stored })
    .from(media)
    .where(eq(media.id, p.receiptMediaId))
    .limit(1);
  const hashes = [m?.a, m?.b].filter((h): h is string => !!h);
  if (hashes.length === 0) return false;
  const [dup] = await tx
    .select({ id: partPurchases.id })
    .from(partPurchases)
    .innerJoin(media, eq(media.id, partPurchases.receiptMediaId))
    .where(
      and(
        ne(partPurchases.id, p.id),
        ne(partPurchases.status, "rejected"),
        ne(media.id, p.receiptMediaId),
        isNull(media.deletedAt),
        or(
          inArray(media.sha256Original, hashes),
          inArray(media.sha256Stored, hashes),
        ),
      ),
    )
    .limit(1);
  return !!dup;
}

interface AiExtract {
  total_cents?: number | null;
  vendor?: string | null;
  date?: string | null;
  subtotal_cents?: number | null;
  tax_cents?: number | null;
}

/** Run the auto-approve rules for a (tech-paid, pending) purchase. */
export async function evaluatePurchase(
  tx: Tx,
  p: PurchaseRow,
): Promise<AutoApproveResult> {
  const s = await settingsOf(tx);
  const tz = await companyTz(tx);
  const ai = (p.aiExtract ?? null) as AiExtract | null;
  return evaluateAutoApprove({
    totalCents: p.totalCents,
    limitCents: s.limits.auto_approve_under_cents,
    hasReceipt: !!p.receiptMediaId,
    receiptRequiredOverCents: s.parts.receipt_required_over_cents,
    aiConfigured: aiProviderName() !== "none",
    aiState:
      p.aiStatus === "queued" ||
      p.aiStatus === "done" ||
      p.aiStatus === "failed" ||
      p.aiStatus === "skipped"
        ? p.aiStatus
        : null,
    aiTotalCents: ai?.total_cents ?? null,
    toleranceCents: s.parts.ai_match_tolerance_cents,
    purchasedOn: p.purchasedOn ?? todayKey(tz),
    referenceDate: await referenceDate(tx, p, tz),
    maxAgeDays: s.parts.receipt_max_age_days,
    duplicateReceipt: await hasDuplicateReceipt(tx, p),
  });
}

function evidenceOf(p: PurchaseRow, r: AutoApproveResult) {
  const ai = (p.aiExtract ?? null) as AiExtract | null;
  return {
    typed: {
      vendor: p.vendor,
      purchased_on: p.purchasedOn,
      total_cents: p.totalCents,
      subtotal_cents: p.subtotalCents,
      tax_cents: p.taxCents,
    },
    ai: ai
      ? {
          vendor: ai.vendor ?? null,
          date: ai.date ?? null,
          total_cents: ai.total_cents ?? null,
        }
      : null,
    ai_status: p.aiStatus,
    awaiting_ai: r.decision === "wait",
    flags: r.flags,
    clean: r.clean,
    receipt_media_id: p.receiptMediaId,
    job_id: p.jobId,
    category: p.category,
  };
}

async function pendingApproval(tx: Tx, purchaseId: string) {
  const [a] = await tx
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, "part_purchase"),
        eq(approvals.entityId, purchaseId),
        eq(approvals.status, "pending"),
      ),
    )
    .limit(1);
  return a ?? null;
}

/**
 * Re-run the rules after a change (receipt added, AI result): auto-approve when clean,
 * otherwise create or refresh the approvals row with the evidence and flags.
 */
export async function routePurchase(
  tx: Tx,
  purchaseId: string,
  actor: Actor,
): Promise<{ status: "pending" | "approved"; flags: PurchaseFlag[] }> {
  const p = await loadPurchase(tx, purchaseId);
  if (p.status !== "pending" || p.paidBy !== "tech")
    return {
      status: p.status === "approved" ? "approved" : "pending",
      flags: [],
    };
  const r = await evaluatePurchase(tx, p);
  const existing = await pendingApproval(tx, p.id);
  if (r.decision === "approve") {
    if (existing)
      await decideApproval(
        tx,
        existing.id,
        {
          decision: "approved",
          reason: "Auto-approved: receipt checks passed",
        },
        SYSTEM_ACTOR,
      );
    else
      await decidePurchase(
        tx,
        p.id,
        {
          decision: "approved",
          reason: "Auto-approved: receipt checks passed",
        },
        actor,
        { auto: true },
      );
    return { status: "approved", flags: [] };
  }
  const evidence = evidenceOf(p, r);
  const wasWaiting =
    !!existing &&
    !!((existing.evidence ?? {}) as { awaiting_ai?: boolean }).awaiting_ai;
  let approvalId = existing?.id ?? null;
  if (existing) {
    await tx
      .update(approvals)
      .set({
        evidence,
        policy: r.decision === "wait" ? "auto_if_evidence" : "always_review",
      })
      .where(eq(approvals.id, existing.id));
  } else {
    approvalId = (
      await createApproval(
        tx,
        {
          entityType: "part_purchase",
          entityId: p.id,
          policy: r.decision === "wait" ? "auto_if_evidence" : "always_review",
          requestedBy: p.purchaserUserId,
          evidence,
        },
        actor,
      )
    ).approvalId;
  }
  // "Needs approval" fires once, when the receipt actually lands in review (not while
  // the AI is still reading it, since it may auto-approve seconds later).
  if (r.decision === "review" && (!existing || wasWaiting))
    await emitB6(
      tx,
      "part_purchase.submitted",
      { type: "part_purchase", id: p.id },
      payload(p, approvalId),
      { actor },
    );
  return { status: "pending", flags: r.flags };
}

/** createPartPurchase body (api.ts re-exports it with the frozen signature). */
export async function createPurchase(
  tx: Tx,
  input: CreatePartPurchaseInput,
  actor: Actor,
  opts: { anyUploader?: boolean } = {},
): Promise<{ partPurchaseId: string; status: "pending" | "approved" }> {
  if (input.clientId) {
    const [prior] = await tx
      .select({ id: partPurchases.id, status: partPurchases.status })
      .from(partPurchases)
      .where(eq(partPurchases.clientId, input.clientId))
      .limit(1);
    if (prior)
      return {
        partPurchaseId: prior.id,
        status: prior.status === "approved" ? "approved" : "pending",
      };
  }
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0)
    throw new ValidationError({ totalCents: ["Enter the receipt total."] });
  const receipt = input.receiptMediaId
    ? await assertReceiptMedia(tx, input.receiptMediaId, {
        uploaders: [input.purchaserUserId, actor.userId],
        anyUploader: opts.anyUploader,
      })
    : null;
  const company = input.paidBy === "company";
  const hasReceipt = !!input.receiptMediaId;
  const willAi = !company && hasReceipt && aiProviderName() !== "none";
  const now = new Date();
  const [row] = await tx
    .insert(partPurchases)
    .values({
      paidBy: input.paidBy,
      instrument:
        input.instrument ?? (company ? "company_account" : "personal"),
      purchaserUserId: input.purchaserUserId,
      category: input.category,
      jobId: input.jobId ?? null,
      vehicleId: input.vehicleId ?? null,
      toolId: input.toolId ?? null,
      vendor: input.vendor?.trim() || null,
      purchasedOn: input.purchasedOn,
      subtotalCents: input.subtotalCents ?? null,
      taxCents: input.taxCents ?? null,
      totalCents: input.totalCents,
      receiptMediaId: input.receiptMediaId ?? null,
      aiStatus: willAi ? "queued" : hasReceipt ? "skipped" : null,
      status: company ? "approved" : "pending",
      autoApproved: company,
      decidedAt: company ? now : null,
      notes: input.notes?.trim() || null,
      clientId: input.clientId ?? null,
    })
    .returning();
  if (!row) throw new Error("part purchase insert failed");
  if (input.receiptMediaId && receipt?.rebind)
    await attachMedia(
      tx,
      [input.receiptMediaId],
      { type: "part_purchase", id: row.id },
      { jobId: input.jobId ?? null },
    );
  if (willAi && input.receiptMediaId)
    await queueAiTask(tx, {
      kind: "receipt",
      mediaIds: [input.receiptMediaId],
      ref: { module: "parts", entityType: "part_purchase", entityId: row.id },
    });
  const what = `${CATEGORY_LABEL[row.category] ?? "Purchase"} receipt ${formatMoney(row.totalCents)}${row.vendor ? ` · ${row.vendor}` : ""}`;
  await writeActivity(tx, {
    entity: row.jobId
      ? { type: "job", id: row.jobId }
      : { type: "user", id: input.purchaserUserId },
    jobId: row.jobId,
    kind: "part_purchase.created",
    summary: company ? `${what} (company paid)` : `${what} (paid by tech)`,
    data: { part_purchase_id: row.id, paid_by: row.paidBy },
    actorUserId: actor.userId,
  });
  if (company) return { partPurchaseId: row.id, status: "approved" };
  const routed = await routePurchase(tx, row.id, actor);
  return { partPurchaseId: row.id, status: routed.status };
}

/**
 * Decide a pending tech-paid purchase (approvals onDecide, auto rules). Approve →
 * job: recompute financials (reimbursement_parts); non-job: reimbursement_expense.
 */
export async function decidePurchase(
  tx: Tx,
  purchaseId: string,
  d: {
    decision: "approved" | "rejected";
    reason?: string | null;
    edits?: Record<string, unknown>;
  },
  actor: Actor,
  opts: { auto?: boolean; approvalId?: string | null } = {},
): Promise<void> {
  const p = await loadPurchase(tx, purchaseId);
  if (p.status !== "pending")
    throw new ConflictError(
      "already_decided",
      "This receipt was already decided.",
    );
  if (d.decision === "rejected" && !d.reason?.trim())
    throw new ValidationError({ reason: ["Say why it was rejected."] });
  const edits = d.edits ?? {};
  const editedTotal =
    typeof edits.totalCents === "number" &&
    Number.isInteger(edits.totalCents) &&
    edits.totalCents > 0
      ? edits.totalCents
      : null;
  const editedVendor =
    typeof edits.vendor === "string" && edits.vendor.trim()
      ? edits.vendor.trim()
      : null;
  const editedDate =
    typeof edits.purchasedOn === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(edits.purchasedOn)
      ? edits.purchasedOn
      : null;
  const now = new Date();
  const [row] = await tx
    .update(partPurchases)
    .set({
      status: d.decision,
      decidedBy: actor.userId,
      decidedAt: now,
      rejectReason: d.decision === "rejected" ? (d.reason ?? null) : null,
      autoApproved: !!opts.auto,
      ...(editedTotal != null ? { totalCents: editedTotal } : {}),
      ...(editedVendor ? { vendor: editedVendor } : {}),
      ...(editedDate ? { purchasedOn: editedDate } : {}),
      updatedAt: now,
    })
    .where(eq(partPurchases.id, p.id))
    .returning();
  const cur = row ?? p;
  const tz = await companyTz(tx);
  const today = todayKey(tz);
  if (
    d.decision === "approved" &&
    cur.paidBy === "tech" &&
    cur.purchaserUserId
  ) {
    if (cur.jobId) {
      await recomputeJobFinancials(
        tx,
        cur.jobId,
        actor,
        "part_purchase.approved",
      );
    } else {
      const [ledgerId] = await insertPostings(
        tx,
        [
          {
            userId: cur.purchaserUserId,
            type: "reimbursement_expense",
            amountCents: cur.totalCents,
            wageClass: "reimbursement",
            memo: `${CATEGORY_LABEL[cur.category] ?? "Expense"} reimbursement${cur.vendor ? ` · ${cur.vendor}` : ""}`,
          },
        ],
        {
          effectiveDate: cur.purchasedOn ?? today,
          refTable: "part_purchases",
          refId: cur.id,
          actorUserId: actor.userId,
          today,
        },
      );
      if (ledgerId)
        await tx
          .update(partPurchases)
          .set({ ledgerEntryId: ledgerId })
          .where(eq(partPurchases.id, cur.id));
    }
  } else if (d.decision === "rejected" && cur.jobId) {
    // Clears the "pending reimbursement" flag on the job's financials.
    await recomputeJobFinancials(
      tx,
      cur.jobId,
      actor,
      "part_purchase.rejected",
    );
  }
  await emitB6(
    tx,
    d.decision === "approved"
      ? "part_purchase.approved"
      : "part_purchase.rejected",
    { type: "part_purchase", id: cur.id },
    payload(cur, opts.approvalId ?? null),
    { actor },
  );
  await writeActivity(tx, {
    entity: cur.jobId
      ? { type: "job", id: cur.jobId }
      : { type: "user", id: cur.purchaserUserId ?? actor.userId ?? "" },
    jobId: cur.jobId,
    kind:
      d.decision === "approved"
        ? "part_purchase.approved"
        : "part_purchase.rejected",
    summary:
      d.decision === "approved"
        ? `Receipt ${formatMoney(cur.totalCents)} approved${opts.auto ? " automatically" : ""}`
        : `Receipt ${formatMoney(cur.totalCents)} rejected: ${(d.reason ?? "").slice(0, 120)}`,
    data: { part_purchase_id: cur.id, auto: !!opts.auto },
    actorUserId: actor.userId,
  });
}

/** Attach (or replace) the receipt photo of a purchase, then re-run the rules. */
export async function attachReceipt(
  tx: Tx,
  purchaseId: string,
  mediaId: string,
  actor: Actor,
  opts: { anyUploader?: boolean } = {},
): Promise<{ status: "pending" | "approved"; flags: PurchaseFlag[] }> {
  const p = await loadPurchase(tx, purchaseId);
  if (p.status === "rejected")
    throw new ConflictError("rejected", "This receipt was rejected.");
  // Same file again (a retried tap): nothing to change.
  if (p.receiptMediaId === mediaId)
    return p.status === "approved"
      ? { status: "approved", flags: [] }
      : routePurchase(tx, p.id, actor);
  const receipt = await assertReceiptMedia(tx, mediaId, {
    uploaders: [p.purchaserUserId, actor.userId],
    anyUploader: opts.anyUploader,
    purchaseId: p.id,
  });
  const willAi = p.paidBy === "tech" && aiProviderName() !== "none";
  await tx
    .update(partPurchases)
    .set({
      receiptMediaId: mediaId,
      aiStatus: willAi ? "queued" : "skipped",
      aiExtract: null,
      updatedAt: new Date(),
    })
    .where(eq(partPurchases.id, p.id));
  if (receipt.rebind)
    await attachMedia(
      tx,
      [mediaId],
      { type: "part_purchase", id: p.id },
      { jobId: p.jobId },
    );
  if (willAi)
    await queueAiTask(tx, {
      kind: "receipt",
      mediaIds: [mediaId],
      ref: { module: "parts", entityType: "part_purchase", entityId: p.id },
    });
  if (p.status === "approved") return { status: "approved", flags: [] };
  return routePurchase(tx, p.id, actor);
}
