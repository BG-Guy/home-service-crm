import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import {
  changeOrders,
  customers,
  depositRequests,
  estimateOptions,
  estimates,
  invoices,
  jobs,
  lineItems,
  payments,
  properties,
  serviceTypes,
  signatures,
  stockMoves,
} from "@/db/schema";
import {
  defaultTaxBps,
  emitLinesChanged,
  getOrCreateDraftInvoice,
  insertLines,
  invoiceLines,
  recomputeInvoice,
} from "@/features/invoices/api";
import type {
  LineInput,
  LineType,
  PartSource,
} from "@/features/invoices/contracts";
import {
  isLeadQuoteLine,
  LEAD_QUOTE_LINE_DESCRIPTION,
} from "@/features/invoices/lead-quote";
import {
  changeOrderThresholdExceeded,
  type DocTotals,
} from "@/features/invoices/math";
import { createJob, setJobEstimate } from "@/features/jobs/api";
import { markLeadConverted } from "@/features/leads/api";
import { lockEvidenceMedia } from "@/features/media/api";
import { ensureDepositRequest } from "@/features/payments/api";
import type { DepositBrief } from "@/features/payments/contracts";
import { captureSignature } from "@/features/signatures/api";
import { writeActivity } from "@/lib/activity";
import { nextNumber } from "@/lib/counters";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy, type PolicyVersionRow } from "@/lib/policies";
import { getSettings } from "@/lib/settings";
import type { Actor, Geo } from "@/lib/types";
import type { ChangeOrderStatus, EstimateBrief } from "./contracts";
import {
  buildChangeOrderSnapshot,
  buildEstimateSnapshot,
  canApproveEstimate,
  coolingOffApplies,
  headlineTotal,
  type OptionLineLike,
  optionTotals,
  planInvoiceReplace,
  signedJobTotal,
} from "./logic";

// B3 estimates API (BUILD_PLAN §6.3, SPEC M07). Writes take tx first and actor last,
// run in the caller's transaction, emit B3's own events and write B3's activity.
// The approval path (in person, remote link, verbal) is one function so every
// channel converts the chosen option into job lines, links the job, asks B4 for the
// deposit and emits estimate.approved the same way.

export type * from "./contracts";

type EstimateRow = typeof estimates.$inferSelect;
type OptionRow = typeof estimateOptions.$inferSelect;
type LineRow = typeof lineItems.$inferSelect;
type ChangeOrderRow = typeof changeOrders.$inferSelect;

const DAY = 86_400_000;

// ------------------------------------------------------------------ loading

export interface LoadedOption extends OptionRow {
  lines: LineRow[];
  totals: DocTotals;
}

export interface LoadedEstimate {
  estimate: EstimateRow;
  options: LoadedOption[];
  customer: {
    id: string;
    displayName: string;
    firstName: string | null;
    email: string | null;
    phone: string | null;
    taxExempt: boolean;
  };
  job: {
    id: string;
    number: string;
    status: string;
    propertyId: string;
    serviceTypeId: string | null;
  } | null;
  serviceType: {
    id: string;
    name: string;
    upsellCovered: boolean;
    contractKind: string;
    warrantyDays: number;
  } | null;
  taxBps: number;
  headlineCents: number;
}

export function toOptionLines(lines: readonly LineRow[]): OptionLineLike[] {
  return lines.map((l) => ({
    id: l.id,
    type: l.type as LineType,
    totalCents: l.totalCents,
    taxable: l.taxable,
    taxRateBps: l.taxRateBps,
    isOptional: l.isOptional,
    isSelected: l.isSelected,
    isServiceFee: l.isServiceFee,
    isUpsell: l.isUpsell,
  }));
}

async function linesFor(
  exec: Tx,
  parentType: "estimate_option" | "change_order",
  parentIds: string[],
): Promise<Map<string, LineRow[]>> {
  const out = new Map<string, LineRow[]>();
  if (parentIds.length === 0) return out;
  const rows = await exec
    .select()
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, parentType),
        inArray(lineItems.parentId, parentIds),
      ),
    )
    .orderBy(asc(lineItems.sort), asc(lineItems.createdAt));
  for (const r of rows) {
    const list = out.get(r.parentId) ?? [];
    list.push(r);
    out.set(r.parentId, list);
  }
  return out;
}

/** Everything the builder, print page and /e/ page render. No permission checks. */
export async function loadEstimate(
  estimateId: string,
  exec: Tx = db,
): Promise<LoadedEstimate | null> {
  const [est] = await exec
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!est) return null;
  const [opts, [cust], [job], taxBps] = await Promise.all([
    exec
      .select()
      .from(estimateOptions)
      .where(eq(estimateOptions.estimateId, estimateId))
      .orderBy(asc(estimateOptions.sort), asc(estimateOptions.createdAt)),
    exec
      .select({
        id: customers.id,
        displayName: customers.displayName,
        firstName: customers.firstName,
        email: customers.email,
        phone: customers.phone,
        taxExempt: customers.taxExempt,
      })
      .from(customers)
      .where(eq(customers.id, est.customerId))
      .limit(1),
    est.jobId
      ? exec
          .select({
            id: jobs.id,
            number: jobs.number,
            status: jobs.status,
            propertyId: jobs.propertyId,
            serviceTypeId: jobs.serviceTypeId,
          })
          .from(jobs)
          .where(eq(jobs.id, est.jobId))
          .limit(1)
      : Promise.resolve([]),
    defaultTaxBps(exec),
  ]);
  const stId = job?.serviceTypeId ?? est.serviceTypeId ?? null;
  const [st] = stId
    ? await exec
        .select({
          id: serviceTypes.id,
          name: serviceTypes.name,
          upsellCovered: serviceTypes.upsellCovered,
          contractKind: serviceTypes.contractKind,
          warrantyDays: serviceTypes.warrantyDays,
        })
        .from(serviceTypes)
        .where(eq(serviceTypes.id, stId))
        .limit(1)
    : [];
  const byOption = await linesFor(
    exec,
    "estimate_option",
    opts.map((o) => o.id),
  );
  const taxExempt = cust?.taxExempt ?? false;
  const options: LoadedOption[] = opts.map((o) => {
    const lines = byOption.get(o.id) ?? [];
    return {
      ...o,
      lines,
      totals: optionTotals(toOptionLines(lines), taxBps, { taxExempt }),
    };
  });
  return {
    estimate: est,
    options,
    customer: cust ?? {
      id: est.customerId,
      displayName: "Customer",
      firstName: null,
      email: null,
      phone: null,
      taxExempt: false,
    },
    job: job ?? null,
    serviceType: st ?? null,
    taxBps,
    headlineCents: headlineTotal(
      options.map((o) => ({
        recommended: o.recommended,
        totalCents: o.totals.totalCents,
        approved: o.id === est.approvedOptionId,
      })),
    ),
  };
}

/** Whether the FTC cooling-off notice attaches to this estimate (any option). */
export function estimateNeedsCoolingOff(e: LoadedEstimate): boolean {
  const atHome = !!(e.estimate.propertyId ?? e.job?.propertyId);
  return e.options.some((o) =>
    coolingOffApplies({
      totalCents: o.totals.totalCents,
      atHome,
      serviceTypeUpsellCovered: e.serviceType?.upsellCovered ?? false,
      hasUpsellLines: o.lines.some((l) => l.isUpsell),
    }),
  );
}

/** Policies shown inline on the estimate and pinned (id + hash) into the signature. */
export async function estimatePolicies(
  coolingOff: boolean,
  exec: Tx = db,
): Promise<PolicyVersionRow[]> {
  const kinds = [
    "warranty",
    "deposit",
    "cancellation",
    "esign_consent",
    ...(coolingOff ? (["cooling_off"] as const) : []),
  ] as const;
  const rows = await Promise.all(kinds.map((k) => getCurrentPolicy(k, exec)));
  return rows.filter((r): r is PolicyVersionRow => !!r);
}

export const DEFAULT_ESIGN_CONSENT =
  "By checking the box and signing, you agree to sign this document electronically. Your electronic signature has the same legal effect as a handwritten one (ESIGN Act). You can ask us for a paper copy at any time.";

/** The discount line that credits a service-call fee once a repair is approved. */
const FEE_CREDIT_NAME = "Service call fee credited";

const isFeeCredit = (l: { type: string; name: string }) =>
  l.type === "discount" && l.name === FEE_CREDIT_NAME;

/** The job's latest non-void invoice, when it is still a draft. */
async function jobDraftInvoice(
  tx: Tx,
  jobId: string,
): Promise<{ id: string; number: string; totalCents: number } | null> {
  const [inv] = await tx
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      totalCents: invoices.totalCents,
    })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return inv?.status === "draft" ? inv : null;
}

/**
 * The work already on the job's draft invoice, as estimate lines: a new estimate on
 * the job starts from it instead of the service's default price, so approving it
 * (which replaces the draft's lines) bills the same work once (E1). Service-call
 * fees and their credit stay on the invoice; the lead-quote marker, purchases and
 * serial numbers belong to the invoice line only.
 */
async function draftScopeLines(tx: Tx, jobId: string): Promise<LineInput[]> {
  const inv = await jobDraftInvoice(tx, jobId);
  if (!inv) return [];
  const rows = await tx
    .select()
    .from(lineItems)
    .where(
      and(eq(lineItems.parentType, "invoice"), eq(lineItems.parentId, inv.id)),
    )
    .orderBy(asc(lineItems.sort), asc(lineItems.createdAt));
  return rows
    .filter((l) => !l.isServiceFee && !isFeeCredit(l))
    .map((l) => ({
      type: l.type as LineType,
      pricebookItemId: l.pricebookItemId,
      name: l.name,
      description:
        l.description === LEAD_QUOTE_LINE_DESCRIPTION ? null : l.description,
      qty: Number(l.qty),
      unitPriceCents: l.unitPriceCents,
      unitCostCents: l.unitCostCents,
      discountCents: l.discountCents,
      taxable: l.taxable,
      partSource: (l.partSource as PartSource | null) ?? null,
      warrantyDays: l.warrantyDays,
      manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
      isUpsell: l.isUpsell,
    }));
}

// ------------------------------------------------------------------ contract: create

/**
 * Draft estimate with one recommended option. Prefill: on a job whose draft invoice
 * already has lines, those lines (the job's real scope, E1); else (lead or job) a
 * service line at the quoted price or the service type's default. The service
 * type's warranty. With leadId the lead is linked, not booked: B1 markLeadConverted
 * runs when the estimate is first sent or approved.
 */
export async function createEstimateDraft(
  tx: Tx,
  input: {
    customerId: string;
    propertyId?: string | null;
    jobId?: string | null;
    leadId?: string | null;
    title?: string | null;
    prefill?: {
      serviceTypeId?: string | null;
      quotedPriceCents?: number | null;
      notes?: string | null;
    };
  },
  actor: Actor,
): Promise<{ estimateId: string; number: string }> {
  const s = await getSettings();
  let propertyId = input.propertyId ?? null;
  let serviceTypeId = input.prefill?.serviceTypeId ?? null;
  if (input.jobId) {
    const [j] = await tx
      .select({
        customerId: jobs.customerId,
        propertyId: jobs.propertyId,
        serviceTypeId: jobs.serviceTypeId,
      })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .limit(1);
    if (!j) throw new NotFoundError("Job");
    if (j.customerId !== input.customerId)
      throw new ValidationError({
        customerId: ["The job belongs to another customer."],
      });
    propertyId = propertyId ?? j.propertyId;
    serviceTypeId = serviceTypeId ?? j.serviceTypeId;
  }
  const [st] = serviceTypeId
    ? await tx
        .select()
        .from(serviceTypes)
        .where(eq(serviceTypes.id, serviceTypeId))
        .limit(1)
    : [];
  const number = await nextNumber(tx, "estimate");
  const [row] = await tx
    .insert(estimates)
    .values({
      number,
      customerId: input.customerId,
      propertyId,
      jobId: input.jobId ?? null,
      serviceTypeId: st?.id ?? null,
      title: input.title?.trim() || st?.name || null,
      notes: input.prefill?.notes ?? null,
      warrantyText: st?.warrantyDays
        ? `${st.warrantyDays}-day workmanship warranty from the date of service.`
        : null,
      expiresAt: new Date(Date.now() + s.estimates.expiry_days * DAY),
      createdBy: actor.userId,
    })
    .returning({ id: estimates.id });
  if (!row) throw new Error("estimate insert failed");
  const [opt] = await tx
    .insert(estimateOptions)
    .values({
      estimateId: row.id,
      label: s.estimates.option_labels[0] ?? "Option 1",
      recommended: true,
      sort: 0,
    })
    .returning({ id: estimateOptions.id });
  const price =
    input.prefill?.quotedPriceCents ?? st?.defaultPriceCents ?? null;
  const scope = input.jobId ? await draftScopeLines(tx, input.jobId) : [];
  if (opt && scope.length > 0)
    await insertLines(tx, "estimate_option", opt.id, scope);
  // Prefill only a priced line: a "$0.00" placeholder would reach the customer
  // if nobody edits it (QA T2-19). Without a price the option starts empty.
  else if (opt && price != null && price > 0)
    await insertLines(tx, "estimate_option", opt.id, [
      {
        type: "service",
        name: st?.name ?? input.title?.trim() ?? "Service",
        qty: 1,
        unitPriceCents: price,
        taxable: s.taxes.labor_taxable,
        warrantyDays: st?.warrantyDays ?? null,
      },
    ]);
  // The lead link rides on the creation row (estimates has no lead column): the
  // lead is booked only when the estimate is sent or approved (QA T2-15), so a
  // draft doesn't end the lead's SLA or count as a booking.
  await writeActivity(tx, {
    entity: { type: "estimate", id: row.id },
    customerId: input.customerId,
    jobId: input.jobId ?? null,
    kind: "estimate.created",
    summary: `Estimate ${number} drafted`,
    data: input.leadId ? { lead_id: input.leadId } : undefined,
    actorUserId: actor.userId,
  });
  return { estimateId: row.id, number };
}

/** The lead an estimate was started from (its `estimate.created` activity row). */
export async function leadForEstimate(
  tx: Tx,
  estimateId: string,
): Promise<string | null> {
  const [r] = await execRows<{ lead_id: string | null }>(
    sql`select data->>'lead_id' as lead_id from activity
        where entity_type = 'estimate' and entity_id = ${estimateId}
          and kind = 'estimate.created' and data ? 'lead_id'
        order by created_at limit 1`,
    tx,
  );
  return r?.lead_id ?? null;
}

/** Books the source lead (B1 markLeadConverted, idempotent) once the estimate goes out. */
async function convertSourceLead(
  tx: Tx,
  estimateId: string,
  actor: Actor,
): Promise<void> {
  const leadId = await leadForEstimate(tx, estimateId);
  if (leadId) await markLeadConverted(tx, leadId, { estimateId }, actor);
}

// ------------------------------------------------------------------ contract: reads

/** A signed estimate / change-order authorization exists for the job (verbal only if allowed). */
export async function hasSignedAuthorization(
  jobId: string,
  opts?: { allowVerbal?: boolean },
): Promise<boolean> {
  const est = await db
    .select({ id: estimates.id })
    .from(estimates)
    .where(eq(estimates.jobId, jobId));
  const cos = await db
    .select({ id: changeOrders.id })
    .from(changeOrders)
    .where(eq(changeOrders.jobId, jobId));
  const docIds = [...est.map((e) => e.id), ...cos.map((c) => c.id)];
  if (docIds.length === 0) return false;
  const conds = [
    inArray(signatures.docId, docIds),
    or(
      eq(signatures.docType, "estimate"),
      eq(signatures.docType, "change_order"),
    ),
  ];
  if (!opts?.allowVerbal)
    conds.push(
      and(ne(signatures.channel, "verbal"), eq(signatures.esignConsent, true)),
    );
  const rows = await db
    .select({ id: signatures.id })
    .from(signatures)
    .where(and(...conds))
    .limit(1);
  return rows.length > 0;
}

/** An approved estimate's total as signed (the snapshot), else as stored now. */
async function approvedEstimateTotal(
  e: {
    id: string;
    approvedOptionId: string | null;
    signatureId: string | null;
  },
  exec: Tx,
): Promise<number | null> {
  if (e.signatureId) {
    const [sig] = await exec
      .select({ snap: signatures.docSnapshot })
      .from(signatures)
      .where(eq(signatures.id, e.signatureId))
      .limit(1);
    const t = (sig?.snap as { totals?: { totalCents?: number } } | null)?.totals
      ?.totalCents;
    if (typeof t === "number") return t;
  }
  if (!e.approvedOptionId) return null;
  const loaded = await loadEstimate(e.id, exec);
  return (
    loaded?.options.find((o) => o.id === e.approvedOptionId)?.totals
      .totalCents ?? null
  );
}

/**
 * Signed total (logic `signedJobTotal`): the newest approved estimate as signed (it
 * replaced earlier ones on the invoice, E1) + signed change orders approved after it.
 */
async function signedTotalForJob(jobId: string, exec: Tx = db) {
  const ests = await exec
    .select({
      id: estimates.id,
      approvedOptionId: estimates.approvedOptionId,
      signatureId: estimates.signatureId,
      approvedAt: estimates.approvedAt,
    })
    .from(estimates)
    .where(and(eq(estimates.jobId, jobId), eq(estimates.status, "approved")))
    .orderBy(desc(estimates.approvedAt));
  // Newest first: only the first one with a total matters.
  let newest: { approvedAt: Date | null; totalCents: number } | null = null;
  for (const e of ests) {
    const t = await approvedEstimateTotal(e, exec);
    if (t != null) {
      newest = { approvedAt: e.approvedAt, totalCents: t };
      break;
    }
  }
  if (!newest) return null;
  const cos = await exec
    .select({ delta: changeOrders.deltaCents, signedAt: signatures.signedAt })
    .from(changeOrders)
    .leftJoin(signatures, eq(signatures.id, changeOrders.signatureId))
    .where(
      and(
        eq(changeOrders.jobId, jobId),
        eq(changeOrders.status, "approved"),
        sql`${changeOrders.signatureId} is not null`,
      ),
    );
  return signedJobTotal(
    [newest],
    cos.map((c) => ({ signedAt: c.signedAt, deltaCents: c.delta })),
  );
}

/**
 * Change-order requirement (M07): exceeded when the job's current invoice total is
 * above the signed total by more than the configured % (or $ when set). `required`
 * = exceeded (approved+signed COs are already in the signed total).
 */
export async function getChangeOrderStatus(
  jobId: string,
): Promise<ChangeOrderStatus> {
  const [pending, signed, [inv], s] = await Promise.all([
    db
      .select({ id: changeOrders.id })
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.jobId, jobId),
          inArray(changeOrders.status, ["draft", "sent"]),
        ),
      ),
    signedTotalForJob(jobId),
    db
      .select({ total: invoices.totalCents })
      .from(invoices)
      .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
      .orderBy(desc(invoices.createdAt))
      .limit(1),
    getSettings(),
  ]);
  const current = inv?.total ?? 0;
  const exceeded = changeOrderThresholdExceeded(
    signed,
    current,
    s.estimates.change_order_threshold_pct,
    s.estimates.change_order_threshold_cents,
  );
  return {
    signedTotalCents: signed,
    currentTotalCents: current,
    thresholdExceeded: exceeded,
    required: exceeded,
    pendingChangeOrderIds: pending.map((p) => p.id),
  };
}

/** Briefs with the headline total (recommended option, else the max; tax included). */
export async function getEstimateBriefs(q: {
  jobId?: string;
  customerId?: string;
}): Promise<EstimateBrief[]> {
  if (!q.jobId && !q.customerId) return [];
  const rows = await db
    .select({ id: estimates.id })
    .from(estimates)
    .where(
      q.jobId
        ? eq(estimates.jobId, q.jobId)
        : eq(estimates.customerId, q.customerId as string),
    )
    .orderBy(desc(estimates.createdAt))
    .limit(50);
  const loaded = await Promise.all(rows.map((r) => loadEstimate(r.id)));
  return loaded
    .filter((l): l is LoadedEstimate => !!l)
    .map((l) => ({
      id: l.estimate.id,
      number: l.estimate.number,
      status: l.estimate.status as EstimateBrief["status"],
      jobId: l.estimate.jobId,
      customerId: l.estimate.customerId,
      totalCents: l.headlineCents,
      sentAt: l.estimate.sentAt,
      expiresAt: l.estimate.expiresAt,
    }));
}

// ------------------------------------------------------------------ status changes

export async function markEstimateSent(
  tx: Tx,
  est: EstimateRow,
  channel: string,
  actor: Actor,
): Promise<void> {
  const now = new Date();
  const first = est.status === "draft";
  await tx
    .update(estimates)
    .set({
      status: first ? "sent" : est.status,
      sentAt: est.sentAt ?? now,
      updatedAt: now,
    })
    .where(eq(estimates.id, est.id));
  const entity = { type: "estimate", id: est.id } as const;
  await emit(
    tx,
    "estimate.sent",
    entity,
    { estimate_id: est.id, channel },
    {
      actor,
    },
  );
  await writeActivity(tx, {
    entity,
    customerId: est.customerId,
    jobId: est.jobId,
    kind: "estimate.sent",
    summary: `Estimate ${est.number} ${first ? "sent" : "re-sent"} (${channel.replace("_", " ")})`,
    data: { channel },
    actorUserId: actor.userId,
  });
  if (first) await convertSourceLead(tx, est.id, actor);
}

/** First open of /e/ after sending: sent → viewed (+ estimate.viewed). Idempotent. */
export async function markEstimateViewed(
  tx: Tx,
  estimateId: string,
  tokenId: string,
  actor: Actor,
): Promise<boolean> {
  const rows = await tx
    .update(estimates)
    .set({ status: "viewed", viewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(estimates.id, estimateId), eq(estimates.status, "sent")))
    .returning({
      number: estimates.number,
      customerId: estimates.customerId,
      jobId: estimates.jobId,
    });
  const r = rows[0];
  if (!r) return false;
  const entity = { type: "estimate", id: estimateId } as const;
  await emit(
    tx,
    "estimate.viewed",
    entity,
    { estimate_id: estimateId, token_id: tokenId },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: r.customerId,
    jobId: r.jobId,
    kind: "estimate.viewed",
    summary: `Customer opened estimate ${r.number}`,
    actorUserId: null,
  });
  return true;
}

export async function declineEstimateTx(
  tx: Tx,
  estimateId: string,
  reason: string | null,
  actor: Actor,
): Promise<void> {
  const [est] = await tx
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1)
    .for("update");
  if (!est) throw new NotFoundError("Estimate");
  if (est.status === "declined") return;
  if (!["draft", "sent", "viewed", "expired"].includes(est.status))
    throw new ConflictError(
      "estimate_closed",
      est.status === "superseded"
        ? `Estimate ${est.number} was already replaced by a newer one.`
        : `Estimate ${est.number} is already ${est.status}.`,
    );
  const now = new Date();
  await tx
    .update(estimates)
    .set({
      status: "declined",
      declinedAt: now,
      declineReason: reason?.slice(0, 500) || null,
      updatedAt: now,
    })
    .where(eq(estimates.id, estimateId));
  const entity = { type: "estimate", id: estimateId } as const;
  await emit(
    tx,
    "estimate.declined",
    entity,
    { estimate_id: estimateId, reason: reason || null },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: est.customerId,
    jobId: est.jobId,
    kind: "estimate.declined",
    summary:
      `Estimate ${est.number} declined${reason ? `: ${reason}` : ""}`.slice(
        0,
        200,
      ),
    actorUserId: actor.userId,
  });
}

/** `estimates.expire` cron: sent/viewed past expires_at → expired (+ estimate.expired). */
export async function expireEstimates(now: Date): Promise<number> {
  const due = await db
    .select({ id: estimates.id })
    .from(estimates)
    .where(
      and(
        inArray(estimates.status, ["sent", "viewed"]),
        sql`${estimates.expiresAt} < ${now}`,
      ),
    )
    .limit(500);
  let n = 0;
  for (const d of due) {
    const done = await db.transaction(async (tx) => {
      const rows = await tx
        .update(estimates)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(estimates.id, d.id),
            inArray(estimates.status, ["sent", "viewed"]),
          ),
        )
        .returning();
      const e = rows[0];
      if (!e) return false;
      const entity = { type: "estimate", id: e.id } as const;
      await emit(
        tx,
        "estimate.expired",
        entity,
        { estimate_id: e.id },
        {
          actor: { kind: "system", userId: null },
        },
      );
      await writeActivity(tx, {
        entity,
        customerId: e.customerId,
        jobId: e.jobId,
        kind: "estimate.expired",
        summary: `Estimate ${e.number} expired`,
        actorUserId: null,
      });
      return true;
    });
    if (done) n++;
  }
  return n;
}

// ------------------------------------------------------------------ approval

export interface SignInput {
  signerName: string;
  signatureMediaId: string | null;
  channel: "in_person" | "remote_link" | "verbal";
  esignConsent: boolean;
  consentText?: string | null;
  geo?: Geo | null;
  deviceTs?: Date | null;
  tokenId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  signerUserId?: string | null;
}

/** The job the estimate converts into: its own, else a new unscheduled job (B2). */
async function ensureJobForEstimate(
  tx: Tx,
  loaded: LoadedEstimate,
  actor: Actor,
): Promise<string> {
  const est = loaded.estimate;
  if (est.jobId) return est.jobId;
  let propertyId = est.propertyId;
  if (!propertyId) {
    const [p] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.customerId, est.customerId),
          isNull(properties.deletedAt),
        ),
      )
      .orderBy(desc(properties.isPrimary), asc(properties.createdAt))
      .limit(1);
    propertyId = p?.id ?? null;
  }
  if (!propertyId)
    throw new ValidationError({
      propertyId: ["Add a service address for this customer first."],
    });
  const { jobId } = await createJob(
    tx,
    {
      customerId: est.customerId,
      propertyId,
      title: est.title ?? `Estimate ${est.number}`,
      estimateId: est.id,
    },
    actor,
  );
  await tx
    .update(estimates)
    .set({ jobId, propertyId, updatedAt: new Date() })
    .where(eq(estimates.id, est.id));
  return jobId;
}

function lineInputFrom(l: LineRow): LineInput {
  return {
    type: l.type as LineType,
    pricebookItemId: l.pricebookItemId,
    name: l.name,
    description: l.description,
    qty: Number(l.qty),
    unitPriceCents: l.unitPriceCents,
    unitCostCents: l.unitCostCents,
    discountCents: l.discountCents,
    taxable: l.taxable,
    partSource: (l.partSource as PartSource | null) ?? null,
    partPurchaseId: l.partPurchaseId,
    warrantyDays: l.warrantyDays,
    manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
    serial: l.serial,
    isServiceFee: false,
    isUpsell: l.isUpsell,
  };
}

/** Draft-invoice lines tied to parts: bought for the job or taken from stock. */
async function partTiedLineIds(
  tx: Tx,
  lines: readonly { id: string; partPurchaseId: string | null }[],
): Promise<Set<string>> {
  const tied = new Set(lines.filter((l) => l.partPurchaseId).map((l) => l.id));
  if (lines.length === 0) return tied;
  const moves = await tx
    .selectDistinct({ id: stockMoves.lineItemId })
    .from(stockMoves)
    .where(
      inArray(
        stockMoves.lineItemId,
        lines.map((l) => l.id),
      ),
    );
  for (const m of moves) if (m.id) tied.add(m.id);
  return tied;
}

const lineCount = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

interface LinesToInvoiceResult {
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The invoice was already issued: nothing changed (revise it to add the lines). */
  skipped: boolean;
  added: number;
  removed: number;
}

/**
 * Put approved lines on the job's DRAFT invoice, tagged with their source. An
 * estimate REPLACES what the draft already bills for the same work (logic
 * `planInvoiceReplace`: the lead's quote, earlier estimates, manual lines; parts
 * used on the job and service-call fees stay), so the job is never billed twice
 * (E1). A change order adds to the work. The service-call fee is "credited if you
 * approve the repair": fee lines on the document are not copied, and fee lines on
 * the invoice get one matching credit. An issued invoice is never touched.
 */
async function linesToInvoice(
  tx: Tx,
  jobId: string,
  lines: LineRow[],
  source: { type: "estimate" | "change_order"; id: string; label: string },
  actor: Actor,
): Promise<LinesToInvoiceResult> {
  const { invoiceId } = await getOrCreateDraftInvoice(tx, jobId, actor);
  // Locked: two approvals on the same job (online and in person at once) take
  // turns replacing the draft's lines instead of interleaving.
  const [inv] = await tx
    .select({
      status: invoices.status,
      number: invoices.number,
      customerId: invoices.customerId,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1)
    .for("update");
  const none = { added: 0, removed: 0 };
  if (!inv)
    return { invoiceId: null, invoiceNumber: null, skipped: false, ...none };
  const entity = { type: "invoice", id: invoiceId } as const;
  if (inv.status !== "draft") {
    await writeActivity(tx, {
      entity,
      customerId: inv.customerId,
      jobId,
      kind: "invoice.lines_skipped",
      summary: `${source.label} approved after ${inv.number} was issued — revise the invoice to add its lines`,
      data: { source: source.label, source_id: source.id },
      actorUserId: actor.userId,
    });
    return { invoiceId, invoiceNumber: inv.number, skipped: true, ...none };
  }
  const approved = lines.filter((l) => !l.isServiceFee);
  let copy = approved;
  let removed = 0;
  if (source.type === "estimate" && approved.length > 0) {
    // The fee credit stays: the credit rule below keeps it to one.
    const draft = (await invoiceLines(tx, invoiceId)).filter(
      (l) => !isFeeCredit(l),
    );
    const tied = await partTiedLineIds(tx, draft);
    const plan = planInvoiceReplace(
      draft.map((l) => ({ ...l, partTied: tied.has(l.id) })),
      approved,
    );
    copy = plan.add;
    if (plan.remove.length > 0) {
      const ids = plan.remove.map((l) => l.id);
      await tx.delete(lineItems).where(inArray(lineItems.id, ids));
      removed = ids.length;
      const cents = plan.remove.reduce((a, l) => a + l.totalCents, 0);
      // QA2: never bill the lead's quote AND the approved estimate.
      const quoteOnly = plan.remove.every(
        (l) => l.sourceType === "lead_quote" || isLeadQuoteLine(l),
      );
      await writeActivity(tx, {
        entity,
        customerId: inv.customerId,
        jobId,
        kind: "invoice.line_removed",
        summary: (quoteOnly
          ? `Quoted price ${formatMoney(cents)} replaced by ${source.label}`
          : `${lineCount(removed)} (${formatMoney(cents)}) replaced by ${source.label}`
        ).slice(0, 200),
        data: {
          source: source.label,
          source_id: source.id,
          line_item_ids: ids,
          lines: plan.remove.map((l) => ({
            name: l.name,
            qty: Number(l.qty),
            total_cents: l.totalCents,
          })),
          reason: quoteOnly ? "lead_quote_replaced" : "replaced_by_estimate",
        },
        actorUserId: actor.userId,
      });
    }
  }
  const inputs: LineInput[] = copy.map((l) => ({
    ...lineInputFrom(l),
    sourceType: source.type,
    sourceId: source.id,
  }));
  const [fees, credited] = await Promise.all([
    tx
      .select({ total: lineItems.totalCents })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.parentType, "invoice"),
          eq(lineItems.parentId, invoiceId),
          eq(lineItems.isServiceFee, true),
        ),
      ),
    tx
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.parentType, "invoice"),
          eq(lineItems.parentId, invoiceId),
          eq(lineItems.type, "discount"),
          eq(lineItems.name, FEE_CREDIT_NAME),
        ),
      )
      .limit(1),
  ]);
  const feeCents = fees.reduce((a, f) => a + f.total, 0);
  // Not tagged: the credit belongs to the visit's fee, not to the approved work.
  if (feeCents > 0 && credited.length === 0 && approved.length > 0)
    inputs.push({
      type: "discount",
      name: FEE_CREDIT_NAME,
      description: "Credited because you approved the repair",
      qty: 1,
      unitPriceCents: feeCents,
      taxable: false,
    });
  await insertLines(tx, "invoice", invoiceId, inputs);
  await recomputeInvoice(tx, invoiceId);
  const covered = approved.length - copy.length;
  if (inputs.length > 0 || covered > 0)
    await writeActivity(tx, {
      entity,
      customerId: inv.customerId,
      jobId,
      kind: "invoice.line_added",
      summary: `${lineCount(inputs.length)} added from ${source.label}${covered > 0 ? ` (${covered} already on it as parts used)` : ""}`,
      data: { source: source.label, source_id: source.id },
      actorUserId: actor.userId,
    });
  // Deposit rules ("total ≥ $X") re-check against the new lines.
  if (inputs.length > 0 || removed > 0)
    await emitLinesChanged(tx, invoiceId, jobId, actor);
  return {
    invoiceId,
    invoiceNumber: inv.number,
    skipped: false,
    added: inputs.length,
    removed,
  };
}

export interface DraftInvoiceImpact {
  invoiceId: string;
  number: string;
  /** The draft's total now. */
  totalCents: number;
  /** Lines an approval would replace, and what they add up to. */
  replaceCount: number;
  replaceCents: number;
  /** Parts used on the job that stay on the invoice. */
  partsKept: number;
}

/**
 * What approving an estimate would replace on the job's draft invoice (E1), for
 * the builder's note: "Approving this replaces INV-1067's lines ($876.89 now)".
 * Null without a draft or when nothing on it would be replaced.
 */
export async function draftInvoiceImpact(
  jobId: string,
): Promise<DraftInvoiceImpact | null> {
  const inv = await jobDraftInvoice(db, jobId);
  if (!inv) return null;
  const lines = (await invoiceLines(db, inv.id)).filter((l) => !isFeeCredit(l));
  const tied = await partTiedLineIds(db, lines);
  const plan = planInvoiceReplace(
    lines.map((l) => ({ ...l, partTied: tied.has(l.id) })),
    [],
  );
  if (plan.remove.length === 0) return null;
  return {
    invoiceId: inv.id,
    number: inv.number,
    totalCents: inv.totalCents,
    replaceCount: plan.remove.length,
    replaceCents: plan.remove.reduce((a, l) => a + l.totalCents, 0),
    partsKept: plan.keep.filter((l) => !l.isServiceFee).length,
  };
}

/**
 * Other open estimates on the job can't be signed once one is approved (E1): they
 * become `superseded` ("Replaced"), with "Replaced by E-1026" in their activity.
 */
async function supersedeOpenEstimates(
  tx: Tx,
  jobId: string,
  by: { id: string; number: string },
  actor: Actor,
): Promise<string[]> {
  const now = new Date();
  const rows = await tx
    .update(estimates)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(estimates.jobId, jobId),
        ne(estimates.id, by.id),
        inArray(estimates.status, ["draft", "sent", "viewed"]),
      ),
    )
    .returning({
      id: estimates.id,
      number: estimates.number,
      customerId: estimates.customerId,
    });
  for (const r of rows)
    await writeActivity(tx, {
      entity: { type: "estimate", id: r.id },
      customerId: r.customerId,
      jobId,
      kind: "estimate.superseded",
      summary: `Estimate ${r.number} replaced by ${by.number}`,
      data: { by_estimate_id: by.id, by_number: by.number },
      actorUserId: actor.userId,
    });
  return rows.map((r) => r.number);
}

export interface ApproveResult {
  estimateId: string;
  jobId: string;
  invoiceId: string | null;
  signatureId: string | null;
  deposit: DepositBrief | null;
  /** The job's invoice was already issued, so the lines weren't added (E1.7). */
  linesSkipped: { invoiceNumber: string } | null;
}

/**
 * Approve an estimate option (+ chosen add-ons) through any channel. In one tx:
 * capture the signature (snapshot + sha256 + policy versions), mark approved, set
 * add-on selections, create/link the job (B2 createJob / setJobEstimate), copy lines
 * to the draft invoice, ask B4 for the deposit, emit estimate.approved.
 */
export async function approveEstimateTx(
  tx: Tx,
  input: {
    estimateId: string;
    optionId: string;
    addonIds: string[];
    sign: SignInput;
  },
  actor: Actor,
): Promise<ApproveResult> {
  await tx
    .select({ id: estimates.id })
    .from(estimates)
    .where(eq(estimates.id, input.estimateId))
    .for("update");
  const loaded = await loadEstimate(input.estimateId, tx);
  if (!loaded) throw new NotFoundError("Estimate");
  const est = loaded.estimate;
  if (est.status === "approved")
    throw new ConflictError(
      "estimate_approved",
      `Estimate ${est.number} is already approved.`,
    );
  if (est.status === "superseded")
    throw new ConflictError(
      "estimate_replaced",
      "This estimate was replaced by a newer one. Ask us for the current one.",
    );
  if (!canApproveEstimate(est))
    throw new ConflictError(
      "estimate_closed",
      est.status === "declined"
        ? "This estimate was declined."
        : "This estimate has expired. Ask us for an updated one.",
    );
  const option = loaded.options.find((o) => o.id === input.optionId);
  if (!option) throw new ValidationError({ optionId: ["Choose an option."] });
  if (option.lines.length === 0)
    throw new ValidationError({ optionId: ["That option has no items."] });
  const validAddons = new Set(
    option.lines.filter((l) => l.isOptional).map((l) => l.id),
  );
  const addonIds = input.addonIds.filter((id) => validAddons.has(id));
  const totals = optionTotals(toOptionLines(option.lines), loaded.taxBps, {
    taxExempt: loaded.customer.taxExempt,
    selectedAddonIds: addonIds,
  });
  const coolingOff = estimateNeedsCoolingOff(loaded);
  const policies = await estimatePolicies(coolingOff, tx);

  // 1. Signature (verbal approvals carry a "verbal" record with the note).
  const snapshot = buildEstimateSnapshot({
    estimate: est,
    option: { id: option.id, label: option.label },
    lines: option.lines.map((l) => ({ ...l, qty: Number(l.qty) })),
    selectedAddonIds: addonIds,
    totals,
    policies,
    depositCents: null,
  });
  const esignPolicy = policies.find((p) => p.kind === "esign_consent");
  const sig = await captureSignature(
    tx,
    {
      docType: "estimate",
      docId: est.id,
      docSnapshot: snapshot,
      policyVersionIds: policies.map((p) => p.id),
      signerName: input.sign.signerName,
      signerKind: "customer",
      signerUserId: input.sign.signerUserId ?? null,
      customerId: est.customerId,
      signatureMediaId: input.sign.signatureMediaId,
      channel: input.sign.channel,
      esignConsent: input.sign.esignConsent,
      consentText:
        input.sign.consentText ??
        (input.sign.channel === "verbal"
          ? null
          : (esignPolicy?.body ?? DEFAULT_ESIGN_CONSENT)),
      ip: input.sign.ip ?? null,
      userAgent: input.sign.userAgent ?? null,
      geo: input.sign.geo ?? null,
      deviceTs: input.sign.deviceTs ?? null,
      tokenId: input.sign.tokenId ?? null,
    },
    actor,
  );

  // 2. Selections + status.
  if (validAddons.size > 0) {
    const chosen = new Set(addonIds);
    for (const id of validAddons)
      await tx
        .update(lineItems)
        .set({ isSelected: chosen.has(id), updatedAt: new Date() })
        .where(eq(lineItems.id, id));
  }
  const now = new Date();
  await tx
    .update(estimates)
    .set({
      status: "approved",
      approvedAt: now,
      approvedOptionId: option.id,
      signatureId: sig.signatureId,
      approvalChannel: input.sign.channel,
      policyVersionIds: policies.map((p) => p.id),
      updatedAt: now,
    })
    .where(eq(estimates.id, est.id));

  // The photos the customer saw with the signed estimate are evidence now.
  if (est.photoMediaIds.length > 0)
    await lockEvidenceMedia(tx, est.photoMediaIds);

  // 3. Job, other open estimates, invoice lines (replacing, E1), deposit.
  const jobId = await ensureJobForEstimate(tx, loaded, actor);
  await setJobEstimate(tx, jobId, est.id);
  await supersedeOpenEstimates(tx, jobId, est, actor);
  const approvedLines = option.lines.filter(
    (l) => !l.isOptional || addonIds.includes(l.id),
  );
  const lines = await linesToInvoice(
    tx,
    jobId,
    approvedLines,
    { type: "estimate", id: est.id, label: `estimate ${est.number}` },
    actor,
  );
  // B4 evaluates the deposit rules (null when none match or `deposits` is off).
  const deposit: DepositBrief | null = await ensureDepositRequest(
    tx,
    {
      jobId,
      estimateId: est.id,
      optionId: option.id,
      context: "estimate_approved",
    },
    actor,
  );

  // 4. Event + timeline (+ book the source lead if it wasn't sent first).
  await convertSourceLead(tx, est.id, actor);
  const entity = { type: "estimate", id: est.id } as const;
  await emit(
    tx,
    "estimate.approved",
    entity,
    {
      estimate_id: est.id,
      option_id: option.id,
      signature_id: sig.signatureId,
      channel: input.sign.channel,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: est.customerId,
    jobId,
    kind: "estimate.approved",
    summary: `Estimate ${est.number} approved (${option.label}, ${formatMoney(totals.totalCents)})${input.sign.channel === "verbal" ? " · verbal" : ""}`,
    data: {
      option_id: option.id,
      total_cents: totals.totalCents,
      channel: input.sign.channel,
      signature_id: sig.signatureId,
    },
    actorUserId: actor.userId,
  });
  return {
    estimateId: est.id,
    jobId,
    invoiceId: lines.invoiceId,
    signatureId: sig.signatureId,
    deposit,
    linesSkipped:
      lines.skipped && lines.invoiceNumber
        ? { invoiceNumber: lines.invoiceNumber }
        : null,
  };
}

// ------------------------------------------------------------------ change orders

export interface LoadedChangeOrder {
  changeOrder: ChangeOrderRow;
  lines: LineRow[];
  totals: DocTotals;
  job: { id: string; number: string; customerId: string; status: string };
  customer: { id: string; displayName: string; taxExempt: boolean };
  taxBps: number;
  signedTotalCents: number | null;
}

export async function loadChangeOrder(
  coId: string,
  exec: Tx = db,
): Promise<LoadedChangeOrder | null> {
  const [co] = await exec
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.id, coId))
    .limit(1);
  if (!co) return null;
  const [[job], taxBps, lines] = await Promise.all([
    exec
      .select({
        id: jobs.id,
        number: jobs.number,
        customerId: jobs.customerId,
        status: jobs.status,
      })
      .from(jobs)
      .where(eq(jobs.id, co.jobId))
      .limit(1),
    defaultTaxBps(exec),
    linesFor(exec, "change_order", [co.id]).then((m) => m.get(co.id) ?? []),
  ]);
  if (!job) return null;
  const [cust] = await exec
    .select({
      id: customers.id,
      displayName: customers.displayName,
      taxExempt: customers.taxExempt,
    })
    .from(customers)
    .where(eq(customers.id, job.customerId))
    .limit(1);
  const totals = optionTotals(toOptionLines(lines), taxBps, {
    taxExempt: cust?.taxExempt,
  });
  return {
    changeOrder: co,
    lines,
    totals,
    job,
    customer: cust ?? {
      id: job.customerId,
      displayName: "Customer",
      taxExempt: false,
    },
    taxBps,
    signedTotalCents: await signedTotalForJob(job.id, exec),
  };
}

export async function createChangeOrderTx(
  tx: Tx,
  input: { jobId: string; reason: string },
  actor: Actor,
): Promise<{ changeOrderId: string; number: string }> {
  const [job] = await tx
    .select({
      id: jobs.id,
      customerId: jobs.customerId,
      estimateId: jobs.estimateId,
    })
    .from(jobs)
    .where(eq(jobs.id, input.jobId))
    .limit(1);
  if (!job) throw new NotFoundError("Job");
  const number = await nextNumber(tx, "change_order");
  const [row] = await tx
    .insert(changeOrders)
    .values({
      number,
      jobId: job.id,
      estimateId: job.estimateId,
      reason: input.reason.trim().slice(0, 500),
      createdBy: actor.userId,
    })
    .returning({ id: changeOrders.id });
  if (!row) throw new Error("change order insert failed");
  await writeActivity(tx, {
    entity: { type: "change_order", id: row.id },
    customerId: job.customerId,
    jobId: job.id,
    kind: "change_order.created",
    summary: `Change order ${number} started: ${input.reason}`.slice(0, 200),
    actorUserId: actor.userId,
  });
  return { changeOrderId: row.id, number };
}

/** Recompute the stored delta (the CO's total incl. tax) after a line change. */
export async function recomputeChangeOrder(tx: Tx, coId: string) {
  const loaded = await loadChangeOrder(coId, tx);
  if (!loaded) throw new NotFoundError("Change order");
  await tx
    .update(changeOrders)
    .set({ deltaCents: loaded.totals.totalCents, updatedAt: new Date() })
    .where(eq(changeOrders.id, coId));
  return loaded.totals;
}

export async function approveChangeOrderTx(
  tx: Tx,
  input: { changeOrderId: string; sign: SignInput },
  actor: Actor,
): Promise<{ changeOrderId: string; jobId: string; signatureId: string }> {
  await tx
    .select({ id: changeOrders.id })
    .from(changeOrders)
    .where(eq(changeOrders.id, input.changeOrderId))
    .for("update");
  const loaded = await loadChangeOrder(input.changeOrderId, tx);
  if (!loaded) throw new NotFoundError("Change order");
  const co = loaded.changeOrder;
  if (co.status === "approved")
    throw new ConflictError("co_approved", `${co.number} is already approved.`);
  if (co.status === "declined")
    throw new ConflictError("co_declined", `${co.number} was declined.`);
  if (loaded.lines.length === 0)
    throw new ValidationError({ lines: ["Add at least one item first."] });
  const policies = await estimatePolicies(false, tx);
  const snapshot = buildChangeOrderSnapshot({
    changeOrder: co,
    lines: loaded.lines.map((l) => ({ ...l, qty: Number(l.qty) })),
    totals: loaded.totals,
    signedTotalCents: loaded.signedTotalCents,
    policies,
  });
  const esign = policies.find((p) => p.kind === "esign_consent");
  const sig = await captureSignature(
    tx,
    {
      docType: "change_order",
      docId: co.id,
      docSnapshot: snapshot,
      policyVersionIds: policies.map((p) => p.id),
      signerName: input.sign.signerName,
      signerKind: "customer",
      customerId: loaded.customer.id,
      signatureMediaId: input.sign.signatureMediaId,
      channel: input.sign.channel,
      esignConsent: input.sign.esignConsent,
      consentText:
        input.sign.consentText ??
        (input.sign.channel === "verbal"
          ? null
          : (esign?.body ?? DEFAULT_ESIGN_CONSENT)),
      ip: input.sign.ip ?? null,
      userAgent: input.sign.userAgent ?? null,
      geo: input.sign.geo ?? null,
      deviceTs: input.sign.deviceTs ?? null,
      tokenId: input.sign.tokenId ?? null,
    },
    actor,
  );
  await tx
    .update(changeOrders)
    .set({
      status: "approved",
      signatureId: sig.signatureId,
      deltaCents: loaded.totals.totalCents,
      updatedAt: new Date(),
    })
    .where(eq(changeOrders.id, co.id));
  // A change order really is extra work: it adds to the invoice (tagged).
  await linesToInvoice(
    tx,
    co.jobId,
    loaded.lines,
    { type: "change_order", id: co.id, label: `change order ${co.number}` },
    actor,
  );
  const entity = { type: "change_order", id: co.id } as const;
  await emit(
    tx,
    "change_order.approved",
    entity,
    {
      change_order_id: co.id,
      job_id: co.jobId,
      delta_cents: loaded.totals.totalCents,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: loaded.customer.id,
    jobId: co.jobId,
    kind: "change_order.approved",
    summary: `Change order ${co.number} approved · ${formatMoney(loaded.totals.totalCents)}${input.sign.channel === "verbal" ? " · verbal" : ""}`,
    actorUserId: actor.userId,
  });
  return {
    changeOrderId: co.id,
    jobId: co.jobId,
    signatureId: sig.signatureId,
  };
}

export async function declineChangeOrderTx(
  tx: Tx,
  coId: string,
  reason: string | null,
  actor: Actor,
): Promise<{ jobId: string }> {
  const [co] = await tx
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.id, coId))
    .limit(1);
  if (!co) throw new NotFoundError("Change order");
  if (co.status === "approved")
    throw new ConflictError("co_approved", `${co.number} is already approved.`);
  if (co.status !== "declined") {
    await tx
      .update(changeOrders)
      .set({ status: "declined", updatedAt: new Date() })
      .where(eq(changeOrders.id, coId));
    const [job] = await tx
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, co.jobId))
      .limit(1);
    await writeActivity(tx, {
      entity: { type: "change_order", id: coId },
      customerId: job?.customerId ?? null,
      jobId: co.jobId,
      kind: "change_order.declined",
      summary:
        `Change order ${co.number} declined${reason ? `: ${reason}` : ""}`.slice(
          0,
          200,
        ),
      actorUserId: actor.userId,
    });
  }
  return { jobId: co.jobId };
}

/** Estimates still open for sale (draft/sent/viewed) — used by S12 and the board. */
export async function countOpenEstimates(customerId: string): Promise<number> {
  const [r] = await execRows<{ n: number }>(
    sql`select count(*)::int as n from estimates where customer_id = ${customerId} and status in ('draft','sent','viewed')`,
  );
  return Number(r?.n ?? 0);
}

// ------------------------------------------------------------------ after signing: now or later

const OPEN_DEPOSIT = ["required", "requested"];
const PAID_DEPOSIT = ["paid", "held", "applied"];
const CLOSED_JOB = ["completed", "closed", "cancelled"];

/**
 * "When is the work?" after signing (Quote to Paid E5). `now`: the approved lines
 * are on this visit's invoice. `later`: they moved to an unscheduled follow-up job
 * for the same customer and address (the office books it), recorded in the
 * estimate's activity (`estimate.work_later` / `estimate.work_now`, like the lead
 * link rides on `estimate.created`). The choice locks once a deposit is paid.
 */
export interface WorkState {
  mode: "now" | "later";
  /** The job the work is billed on now. */
  job: { id: string; number: string; status: string } | null;
  /** Later: the visit it was signed on. */
  originJob: { id: string; number: string } | null;
  /** That job's latest invoice. */
  invoice: { id: string; number: string; status: string } | null;
  /** Lines from this estimate on that invoice (line_items.source). */
  linesOnInvoice: number;
  /** The invoice was already issued when it was approved: nothing was added. */
  linesSkipped: boolean;
  /** An open deposit request for this estimate. */
  deposit: { id: string; amountCents: number; status: string } | null;
  depositPaid: boolean;
  canScheduleLater: boolean;
  canMoveBack: boolean;
  /** Why the choice can't change, in plain words. */
  locked: string | null;
}

async function latestWorkMove(
  exec: Tx,
  estimateId: string,
): Promise<{ kind: string; from: string; to: string } | null> {
  const [r] = await execRows<{ kind: string; f: string; t: string }>(
    sql`select kind, data->>'from_job_id' as f, data->>'to_job_id' as t from activity
        where entity_type = 'estimate' and entity_id = ${estimateId}
          and kind in ('estimate.work_later', 'estimate.work_now')
        order by created_at desc limit 1`,
    exec,
  );
  return r ? { kind: r.kind, from: r.f, to: r.t } : null;
}

async function latestJobInvoice(exec: Tx, jobId: string) {
  const [inv] = await exec
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
    })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return inv ?? null;
}

/** The job's latest non-void invoice, for the link strip EST → job → invoice. */
export function jobInvoiceBrief(
  jobId: string,
): Promise<{ id: string; number: string; status: string } | null> {
  return latestJobInvoice(db, jobId);
}

const estimateLinesOn = (invoiceId: string, estimateId: string) =>
  and(
    eq(lineItems.parentType, "invoice"),
    eq(lineItems.parentId, invoiceId),
    eq(lineItems.sourceType, "estimate"),
    eq(lineItems.sourceId, estimateId),
  );

/** Where an approved estimate's work is billed, and what may change (E5). */
export async function workState(
  estimateId: string,
  exec: Tx = db,
): Promise<WorkState | null> {
  const [est] = await exec
    .select({
      id: estimates.id,
      status: estimates.status,
      jobId: estimates.jobId,
    })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!est || est.status !== "approved") return null;
  const move = await latestWorkMove(exec, est.id);
  const later =
    move?.kind === "estimate.work_later" &&
    !!est.jobId &&
    move.to === est.jobId;
  const [job] = est.jobId
    ? await exec
        .select({ id: jobs.id, number: jobs.number, status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, est.jobId))
        .limit(1)
    : [];
  const [origin] =
    later && move
      ? await exec
          .select({ id: jobs.id, number: jobs.number })
          .from(jobs)
          .where(eq(jobs.id, move.from))
          .limit(1)
      : [];
  const invoice = job ? await latestJobInvoice(exec, job.id) : null;
  const [count] = invoice
    ? await exec
        .select({ n: sql<number>`count(*)::int` })
        .from(lineItems)
        .where(estimateLinesOn(invoice.id, est.id))
    : [];
  const linesOnInvoice = Number(count?.n ?? 0);
  const deps = await exec
    .select({
      id: depositRequests.id,
      amountCents: depositRequests.amountCents,
      status: depositRequests.status,
    })
    .from(depositRequests)
    .where(eq(depositRequests.estimateId, est.id))
    .orderBy(desc(depositRequests.createdAt));
  const deposit = deps.find((d) => OPEN_DEPOSIT.includes(d.status)) ?? null;
  const depositPaid = deps.some((d) => PAID_DEPOSIT.includes(d.status));
  let canMoveBack = false;
  if (later && job && origin && !depositPaid) {
    const [paid] = await exec
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(eq(payments.jobId, job.id), eq(payments.status, "succeeded")));
    const back = await latestJobInvoice(exec, origin.id);
    canMoveBack =
      job.status === "unscheduled" &&
      Number(paid?.n ?? 0) === 0 &&
      (invoice?.status ?? "draft") === "draft" &&
      (back?.status ?? "draft") === "draft";
  }
  const canScheduleLater =
    !later &&
    !!job &&
    !CLOSED_JOB.includes(job.status) &&
    invoice?.status === "draft" &&
    linesOnInvoice > 0 &&
    !depositPaid;
  const locked = depositPaid
    ? "The deposit is paid, so the work stays where it is."
    : later && !canMoveBack
      ? "The follow-up is booked or paid, so the work stays on it."
      : !later && invoice && invoice.status !== "draft"
        ? `${invoice.number} was already sent, so the work stays on this job.`
        : null;
  return {
    mode: later ? "later" : "now",
    job: job ?? null,
    originJob: origin ?? null,
    invoice,
    linesOnInvoice,
    linesSkipped:
      !!invoice && invoice.status !== "draft" && linesOnInvoice === 0,
    deposit,
    depositPaid,
    canScheduleLater,
    canMoveBack,
    locked,
  };
}

/** Move this estimate's lines (by source) between two draft invoices. */
async function moveEstimateLines(
  tx: Tx,
  estimateId: string,
  fromInvoiceId: string,
  toInvoiceId: string,
): Promise<{ count: number; cents: number }> {
  const rows = await tx
    .update(lineItems)
    .set({ parentId: toInvoiceId, updatedAt: new Date() })
    .where(estimateLinesOn(fromInvoiceId, estimateId))
    .returning({ total: lineItems.totalCents });
  await recomputeInvoice(tx, fromInvoiceId);
  await recomputeInvoice(tx, toInvoiceId);
  return {
    count: rows.length,
    cents: rows.reduce((a, r) => a + r.total, 0),
  };
}

/** The estimate, its work, its open deposit: from one job to another. */
async function pointEstimateAt(
  tx: Tx,
  est: { id: string },
  from: string,
  to: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(depositRequests)
    .set({ jobId: to })
    .where(
      and(
        eq(depositRequests.estimateId, est.id),
        inArray(depositRequests.status, OPEN_DEPOSIT),
      ),
    );
  await tx
    .update(estimates)
    .set({ jobId: to, updatedAt: now })
    .where(eq(estimates.id, est.id));
  await setJobEstimate(tx, to, est.id);
  // The visit it left no longer sells this estimate (payroll's "sold by").
  await tx
    .update(jobs)
    .set({ estimateId: null, updatedAt: now })
    .where(and(eq(jobs.id, from), eq(jobs.estimateId, est.id)));
}

/**
 * "Schedule later" (E5): this estimate's lines and its open deposit request move
 * to a new unscheduled follow-up job for the same customer and address ("Follow-up:
 * <title>", with the estimate), which shows in the Assign hub's undated list.
 * Allowed while the work is on this visit's DRAFT invoice and no deposit is paid.
 */
export async function scheduleEstimateLaterTx(
  tx: Tx,
  estimateId: string,
  actor: Actor,
): Promise<{ jobId: string; number: string; fromJobId: string }> {
  await tx
    .select({ id: estimates.id })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .for("update");
  const state = await workState(estimateId, tx);
  if (!state)
    throw new ConflictError(
      "estimate_not_approved",
      "Only an approved estimate's work can be scheduled.",
    );
  if (!state.canScheduleLater || !state.job || !state.invoice)
    throw new ConflictError(
      "work_locked",
      state.locked ?? "This work can't be moved to a follow-up now.",
    );
  const [est] = await tx
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  const [from] = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.id, state.job.id))
    .limit(1);
  if (!est || !from) throw new NotFoundError("Job");
  const created = await createJob(
    tx,
    {
      customerId: from.customerId,
      propertyId: from.propertyId,
      serviceTypeId: from.serviceTypeId,
      title: `Follow-up: ${est.title ?? from.title}`.slice(0, 200),
      estimateId: est.id,
    },
    actor,
  );
  const { invoiceId: toInvoice } = await getOrCreateDraftInvoice(
    tx,
    created.jobId,
    actor,
  );
  const moved = await moveEstimateLines(
    tx,
    est.id,
    state.invoice.id,
    toInvoice,
  );
  await pointEstimateAt(tx, est, from.id, created.jobId);
  const what = `${lineCount(moved.count)} (${formatMoney(moved.cents)})`;
  await writeActivity(tx, {
    entity: { type: "estimate", id: est.id },
    customerId: est.customerId,
    jobId: created.jobId,
    kind: "estimate.work_later",
    summary: `Work scheduled for later: ${what} moved to follow-up ${created.number}`,
    data: { from_job_id: from.id, to_job_id: created.jobId },
    actorUserId: actor.userId,
  });
  await writeActivity(tx, {
    entity: { type: "job", id: from.id },
    customerId: est.customerId,
    jobId: from.id,
    kind: "job.work_moved",
    summary: `${est.number}'s work moved to follow-up ${created.number} (${what})`,
    data: { estimate_id: est.id, to_job_id: created.jobId },
    actorUserId: actor.userId,
  });
  await writeActivity(tx, {
    entity: { type: "job", id: created.jobId },
    customerId: est.customerId,
    jobId: created.jobId,
    kind: "job.work_moved",
    summary: `Follow-up of ${from.number} for ${est.number} (${what})`,
    data: { estimate_id: est.id, from_job_id: from.id },
    actorUserId: actor.userId,
  });
  await emitLinesChanged(tx, state.invoice.id, from.id, actor);
  await emitLinesChanged(tx, toInvoice, created.jobId, actor);
  return { jobId: created.jobId, number: created.number, fromJobId: from.id };
}

/**
 * "Move it back to this job" (E5): undoes Schedule later while the follow-up is
 * still unscheduled and unpaid. The follow-up was made by this flow and never
 * booked, so it is cancelled quietly (no job.cancelled: the customer was never
 * told about it) and its empty draft invoice voided.
 */
export async function moveEstimateBackTx(
  tx: Tx,
  estimateId: string,
  actor: Actor,
): Promise<{ jobId: string; followUpJobId: string }> {
  await tx
    .select({ id: estimates.id })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .for("update");
  const state = await workState(estimateId, tx);
  if (!state?.canMoveBack || !state.job || !state.originJob)
    throw new ConflictError(
      "work_locked",
      state?.locked ?? "This work can't be moved back now.",
    );
  const [est] = await tx
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!est) throw new NotFoundError("Estimate");
  const follow = state.job;
  const origin = state.originJob;
  const { invoiceId: back } = await getOrCreateDraftInvoice(
    tx,
    origin.id,
    actor,
  );
  const moved = state.invoice
    ? await moveEstimateLines(tx, est.id, state.invoice.id, back)
    : { count: 0, cents: 0 };
  await pointEstimateAt(tx, est, follow.id, origin.id);
  const now = new Date();
  await tx
    .update(jobs)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelReason: "duplicate",
      cancelNote: `Work moved back to ${origin.number}`,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, follow.id), eq(jobs.status, "unscheduled")));
  if (state.invoice) {
    const left = await invoiceLines(tx, state.invoice.id);
    if (left.length === 0)
      await tx
        .update(invoices)
        .set({
          status: "void",
          voidedAt: now,
          voidReason: `Work moved back to ${origin.number}`,
          updatedAt: now,
        })
        .where(
          and(eq(invoices.id, state.invoice.id), eq(invoices.status, "draft")),
        );
  }
  const what = `${lineCount(moved.count)} (${formatMoney(moved.cents)})`;
  await writeActivity(tx, {
    entity: { type: "estimate", id: est.id },
    customerId: est.customerId,
    jobId: origin.id,
    kind: "estimate.work_now",
    summary: `Work moved back to ${origin.number}: ${what}`,
    data: { from_job_id: follow.id, to_job_id: origin.id },
    actorUserId: actor.userId,
  });
  await writeActivity(tx, {
    entity: { type: "job", id: origin.id },
    customerId: est.customerId,
    jobId: origin.id,
    kind: "job.work_moved",
    summary: `${est.number}'s work moved back from ${follow.number} (${what})`,
    data: { estimate_id: est.id, from_job_id: follow.id },
    actorUserId: actor.userId,
  });
  await writeActivity(tx, {
    entity: { type: "job", id: follow.id },
    customerId: est.customerId,
    jobId: follow.id,
    kind: "job.work_moved",
    summary: `Follow-up cancelled: ${est.number}'s work moved back to ${origin.number}`,
    data: { estimate_id: est.id, to_job_id: origin.id },
    actorUserId: actor.userId,
  });
  await emitLinesChanged(tx, back, origin.id, actor);
  return { jobId: origin.id, followUpJobId: follow.id };
}
