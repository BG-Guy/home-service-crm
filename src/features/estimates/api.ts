import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import {
  changeOrders,
  customers,
  estimateOptions,
  estimates,
  invoices,
  jobs,
  lineItems,
  properties,
  serviceTypes,
  signatures,
} from "@/db/schema";
import {
  defaultTaxBps,
  getOrCreateDraftInvoice,
  insertLines,
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
  nextOptionLabel,
  type OptionLineLike,
  optionTotals,
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

// ------------------------------------------------------------------ contract: create

/**
 * Draft estimate with one recommended option. Prefill (lead or job): a service line
 * at the quoted price (or the service type's default), the service type's warranty.
 * With leadId the lead is linked, not booked: B1 markLeadConverted runs when the
 * estimate is first sent or approved.
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
      label: nextOptionLabel(s.estimates.option_labels, []),
      recommended: true,
      sort: 0,
    })
    .returning({ id: estimateOptions.id });
  const price =
    input.prefill?.quotedPriceCents ?? st?.defaultPriceCents ?? null;
  // Prefill only a priced line: a "$0.00" placeholder would reach the customer
  // if nobody edits it (QA T2-19). Without a price the option starts empty.
  if (opt && price != null && price > 0)
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

/** Signed total = approved estimate option (as signed) + approved, signed change orders. */
async function signedTotalForJob(jobId: string, exec: Tx = db) {
  const ests = await exec
    .select({
      id: estimates.id,
      approvedOptionId: estimates.approvedOptionId,
      signatureId: estimates.signatureId,
    })
    .from(estimates)
    .where(and(eq(estimates.jobId, jobId), eq(estimates.status, "approved")))
    .orderBy(desc(estimates.approvedAt));
  let base: number | null = null;
  for (const e of ests) {
    if (e.signatureId) {
      const [sig] = await exec
        .select({ snap: signatures.docSnapshot })
        .from(signatures)
        .where(eq(signatures.id, e.signatureId))
        .limit(1);
      const t = (sig?.snap as { totals?: { totalCents?: number } } | null)
        ?.totals?.totalCents;
      if (typeof t === "number") {
        base = (base ?? 0) + t;
        continue;
      }
    }
    if (e.approvedOptionId) {
      const loaded = await loadEstimate(e.id, exec);
      const opt = loaded?.options.find((o) => o.id === e.approvedOptionId);
      if (opt) base = (base ?? 0) + opt.totals.totalCents;
    }
  }
  const cos = await exec
    .select({ delta: changeOrders.deltaCents })
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.jobId, jobId),
        eq(changeOrders.status, "approved"),
        sql`${changeOrders.signatureId} is not null`,
      ),
    );
  if (base == null) return null;
  return base + cos.reduce((a, c) => a + c.delta, 0);
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
      `Estimate ${est.number} is already ${est.status}.`,
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

/**
 * Copy approved lines onto the job's DRAFT invoice. The service-call fee is
 * "credited if you approve the repair": fee lines on the estimate are not copied,
 * and fee lines already on the invoice get a matching credit line.
 */
async function linesToInvoice(
  tx: Tx,
  jobId: string,
  lines: LineRow[],
  sourceLabel: string,
  actor: Actor,
  /**
   * Estimate approval: the approved scope REPLACES the lead's quoted-price placeholder
   * line (invoices/lead-quote) on the draft. A change order adds to the scope instead.
   */
  opts: { replaceLeadQuote?: boolean } = {},
): Promise<{ invoiceId: string | null; added: number }> {
  const { invoiceId } = await getOrCreateDraftInvoice(tx, jobId, actor);
  const [inv] = await tx
    .select({
      status: invoices.status,
      number: invoices.number,
      customerId: invoices.customerId,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) return { invoiceId: null, added: 0 };
  if (inv.status !== "draft") {
    await writeActivity(tx, {
      entity: { type: "invoice", id: invoiceId },
      customerId: inv.customerId,
      jobId,
      kind: "invoice.lines_skipped",
      summary: `${sourceLabel} approved after ${inv.number} was issued — revise the invoice to add its lines`,
      actorUserId: actor.userId,
    });
    return { invoiceId, added: 0 };
  }
  const copy = lines.filter((l) => !l.isServiceFee).map(lineInputFrom);
  // QA2: never bill the lead's quote AND the approved estimate (INV-1067 $584.54).
  if (opts.replaceLeadQuote && copy.length > 0) {
    const placeholders = (
      await tx
        .select({
          id: lineItems.id,
          name: lineItems.name,
          totalCents: lineItems.totalCents,
          description: lineItems.description,
          pricebookItemId: lineItems.pricebookItemId,
          type: lineItems.type,
        })
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "invoice"),
            eq(lineItems.parentId, invoiceId),
            eq(lineItems.description, LEAD_QUOTE_LINE_DESCRIPTION),
          ),
        )
    ).filter(isLeadQuoteLine);
    if (placeholders.length > 0) {
      await tx.delete(lineItems).where(
        inArray(
          lineItems.id,
          placeholders.map((p) => p.id),
        ),
      );
      await writeActivity(tx, {
        entity: { type: "invoice", id: invoiceId },
        customerId: inv.customerId,
        jobId,
        kind: "invoice.line_removed",
        summary:
          `Quoted price ${formatMoney(placeholders.reduce((a, p) => a + p.totalCents, 0))} replaced by ${sourceLabel}`.slice(
            0,
            200,
          ),
        data: {
          source: sourceLabel,
          line_item_ids: placeholders.map((p) => p.id),
          reason: "lead_quote_replaced",
        },
        actorUserId: actor.userId,
      });
    }
  }
  const existingFees = await tx
    .select({ total: lineItems.totalCents, name: lineItems.name })
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "invoice"),
        eq(lineItems.parentId, invoiceId),
        eq(lineItems.isServiceFee, true),
      ),
    );
  const feeCents = existingFees.reduce((a, f) => a + f.total, 0);
  const alreadyCredited = await tx
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "invoice"),
        eq(lineItems.parentId, invoiceId),
        eq(lineItems.type, "discount"),
        eq(lineItems.name, "Service call fee credited"),
      ),
    )
    .limit(1);
  if (feeCents > 0 && alreadyCredited.length === 0 && copy.length > 0)
    copy.push({
      type: "discount",
      name: "Service call fee credited",
      description: "Credited because you approved the repair",
      qty: 1,
      unitPriceCents: feeCents,
      taxable: false,
    });
  await insertLines(tx, "invoice", invoiceId, copy);
  await recomputeInvoice(tx, invoiceId);
  await writeActivity(tx, {
    entity: { type: "invoice", id: invoiceId },
    customerId: inv.customerId,
    jobId,
    kind: "invoice.line_added",
    summary: `${copy.length} line${copy.length === 1 ? "" : "s"} added from ${sourceLabel}`,
    data: { source: sourceLabel },
    actorUserId: actor.userId,
  });
  return { invoiceId, added: copy.length };
}

export interface ApproveResult {
  estimateId: string;
  jobId: string;
  invoiceId: string | null;
  signatureId: string | null;
  deposit: DepositBrief | null;
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

  // 3. Job, invoice lines, deposit.
  const jobId = await ensureJobForEstimate(tx, loaded, actor);
  await setJobEstimate(tx, jobId, est.id);
  const approvedLines = option.lines.filter(
    (l) => !l.isOptional || addonIds.includes(l.id),
  );
  const { invoiceId } = await linesToInvoice(
    tx,
    jobId,
    approvedLines,
    `estimate ${est.number}`,
    actor,
    { replaceLeadQuote: true },
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
    invoiceId,
    signatureId: sig.signatureId,
    deposit,
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
  await linesToInvoice(
    tx,
    co.jobId,
    loaded.lines,
    `change order ${co.number}`,
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
