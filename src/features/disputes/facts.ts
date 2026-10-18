import "server-only";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  approvals,
  changeOrders,
  customers,
  depositRequests,
  disputes,
  entityTags,
  estimates,
  invoices,
  jobStatusEvents,
  jobs,
  leadSources,
  leads,
  lineItems,
  media,
  messages,
  payments,
  properties,
  reviewRequests,
  riskAssessments,
  serviceTypes,
  signatures,
  tags,
} from "@/db/schema";
import {
  getChangeOrderStatus,
  hasSignedAuthorization,
} from "@/features/estimates/api";
import { getSettings, isEnabled } from "@/lib/settings";
import type { ControlFacts } from "./controls";
import type { ReadinessFacts } from "./readiness";
import { bandRank, type RiskBand, type RiskFacts } from "./risk";

// DB → engine facts loaders for the pure engines (risk.ts, readiness.ts, controls.ts).
// Reads only (any table is readable, BUILD_PLAN §3.2). `db` routes to the open
// transaction when called inside one (src/db/index.ts), so handlers stay consistent.

const PAID = ["succeeded", "partially_refunded", "refunded", "disputed"];
const OPEN_DISPUTE = ["inquiry", "needs_response", "under_review"];

type JobRow = typeof jobs.$inferSelect;

export async function loadJob(jobId: string): Promise<JobRow | null> {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return j ?? null;
}

/** Selected line total of the approved estimate option for the job (0 when none). */
async function approvedOptionTotal(jobId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${lineItems.totalCents}), 0)::bigint`,
    })
    .from(estimates)
    .innerJoin(
      lineItems,
      and(
        eq(lineItems.parentType, "estimate_option"),
        eq(lineItems.parentId, estimates.approvedOptionId),
        eq(lineItems.isSelected, true),
      ),
    )
    .where(and(eq(estimates.jobId, jobId), eq(estimates.status, "approved")));
  return Number(row?.total ?? 0);
}

async function latestInvoice(jobId: string) {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return inv ?? null;
}

async function invoiceLines(invoiceId: string | null) {
  if (!invoiceId) return [];
  return db
    .select()
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "invoice"),
        eq(lineItems.parentId, invoiceId),
      ),
    );
}

/** Ticket = max(approved estimate option, invoice total, quoted price) — SPEC §11.1. */
export async function jobTicketCents(job: JobRow): Promise<number> {
  const [opt, inv, lead] = await Promise.all([
    approvedOptionTotal(job.id),
    latestInvoice(job.id),
    job.leadId
      ? db
          .select({ q: leads.quotedPriceCents })
          .from(leads)
          .where(eq(leads.id, job.leadId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const quoted = Number((lead as { q: number | null }[])[0]?.q ?? 0);
  return Math.max(opt, Number(inv?.totalCents ?? 0), quoted);
}

function cardCountry(raw: unknown): string | null {
  try {
    const r = raw as Record<string, unknown> | null;
    const charge = r?.latest_charge as Record<string, unknown> | undefined;
    const pmd = charge?.payment_method_details as
      | Record<string, unknown>
      | undefined;
    const card = (pmd?.card ?? pmd?.card_present) as
      | Record<string, unknown>
      | undefined;
    const c = card?.country ?? (r?.card_country as unknown);
    return typeof c === "string" ? c : null;
  } catch {
    return null;
  }
}

export async function loadRiskFacts(
  job: JobRow,
  now = new Date(),
): Promise<RiskFacts> {
  const settings = await getSettings();
  const [cust] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, job.customerId))
    .limit(1);
  const [prop] = await db
    .select({ siteContactName: properties.siteContactName })
    .from(properties)
    .where(eq(properties.id, job.propertyId))
    .limit(1);
  const inv = await latestInvoice(job.id);
  const lines = await invoiceLines(inv?.id ?? null);
  const optLines = await db
    .select({ isUpsell: lineItems.isUpsell })
    .from(estimates)
    .innerJoin(
      lineItems,
      and(
        eq(lineItems.parentType, "estimate_option"),
        eq(lineItems.parentId, estimates.approvedOptionId),
      ),
    )
    .where(and(eq(estimates.jobId, job.id), eq(lineItems.isUpsell, true)))
    .limit(1);
  const pays = await db
    .select()
    .from(payments)
    .where(eq(payments.jobId, job.id));
  const [ticketCents, signed, co] = await Promise.all([
    jobTicketCents(job),
    hasSignedAuthorization(job.id),
    getChangeOrderStatus(job.id).catch(() => ({ required: false })),
  ]);

  // Prior jobs of the customer (completed/closed, not this one).
  const prior = await db
    .select({
      id: jobs.id,
      paymentStatus: jobs.paymentStatus,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, job.customerId),
        ne(jobs.id, job.id),
        inArray(jobs.status, ["completed", "closed"]),
      ),
    );
  let disputedPrior = new Set<string>();
  if (prior.length) {
    const d = await db
      .select({ jobId: payments.jobId })
      .from(disputes)
      .innerJoin(payments, eq(payments.id, disputes.paymentId))
      .where(
        inArray(
          payments.jobId,
          prior.map((p) => p.id),
        ),
      );
    disputedPrior = new Set(d.map((x) => x.jobId).filter(Boolean) as string[]);
  }
  const priorPaidUndisputed = prior.filter(
    (p) => p.paymentStatus === "paid" && !disputedPrior.has(p.id),
  ).length;

  // Lead source: the job's lead, else the customer's first source.
  let leadSource: string | null = null;
  const srcId =
    (job.leadId
      ? (
          await db
            .select({ s: leads.leadSourceId })
            .from(leads)
            .where(eq(leads.id, job.leadId))
            .limit(1)
        )[0]?.s
      : null) ??
    cust?.leadSourceId ??
    null;
  if (srcId) {
    const [src] = await db
      .select({ kind: leadSources.kind })
      .from(leadSources)
      .where(eq(leadSources.id, srcId))
      .limit(1);
    leadSource = src?.kind ?? null;
  } else if (cust?.source) {
    leadSource = cust.source;
  }

  // Disputed card fingerprints (any job).
  const fps = [
    ...new Set(
      [
        ...pays.map((p) => p.cardFingerprint),
        ...(cust?.cardFingerprints ?? []),
      ].filter((x): x is string => !!x),
    ),
  ];
  let fingerprintDisputed = false;
  if (fps.length) {
    const hit = await db
      .select({ id: disputes.id })
      .from(disputes)
      .innerJoin(payments, eq(payments.id, disputes.paymentId))
      .where(inArray(payments.cardFingerprint, fps))
      .limit(1);
    fingerprintDisputed = hit.length > 0;
  }

  // Complaint: tag "complaint", rating ≤ 2, or staff flag (jobs.custom.customer_unhappy).
  const tagHit = await db
    .select({ id: tags.id })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(
      and(
        or(
          and(
            eq(entityTags.entityType, "job"),
            eq(entityTags.entityId, job.id),
          ),
          and(
            eq(entityTags.entityType, "customer"),
            eq(entityTags.entityId, job.customerId),
          ),
        ),
        ilike(tags.name, "complaint%"),
      ),
    )
    .limit(1);
  const lowRating = await db
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.jobId, job.id),
        isNotNull(reviewRequests.rating),
        sql`${reviewRequests.rating} <= 2`,
      ),
    )
    .limit(1);
  const custom = (job.custom ?? {}) as Record<string, unknown>;
  const complaint =
    tagHit.length > 0 ||
    lowRating.length > 0 ||
    custom.customer_unhappy === true;

  const premiumId = settings.company.after_hours_premium_item_id;
  const hasPremiumLine = lines.some(
    (l) =>
      (premiumId && l.pricebookItemId === premiumId) ||
      (l.type === "fee" && /after.?hours|emergency|premium/i.test(l.name)),
  );

  return {
    ticketCents,
    hasSignedAuthorization: signed,
    overageUnsigned: !!co.required,
    payments: pays
      .filter((p) => p.method === "card" || p.entryMode === "keyed")
      .map((p) => ({
        status: p.status,
        entryMode: p.entryMode,
        payerName: p.payerName,
        avsResult: p.avsResult,
        cardCountry: cardCountry(p.raw),
        threeDs: p.threeDs,
      }))
      .concat(
        pays
          .filter((p) => p.method !== "card" && p.payerName)
          .map((p) => ({
            status: p.status,
            entryMode: p.entryMode,
            payerName: p.payerName,
            avsResult: null,
            cardCountry: null,
            threeDs: null,
          })),
      ),
    customerName: cust?.displayName ?? "",
    siteContactName: prop?.siteContactName ?? null,
    afterHours: job.afterHours,
    emergency: job.priority === "emergency",
    hasPremiumLine,
    hasUpsellLine: lines.some((l) => l.isUpsell) || optLines.length > 0,
    priorCompletedJobs: prior.length,
    priorPaidUndisputedJobs: priorPaidUndisputed,
    leadSource,
    customerDisputeHistory: !!cust?.disputeHistory,
    fingerprintDisputed,
    complaint,
    depositTaken: pays.some(
      (p) => p.kind === "deposit" && PAID.includes(p.status),
    ),
    scheduledStart: job.scheduledStart ?? job.windowStart,
    now,
  };
}

export async function photosEnabled(): Promise<boolean> {
  return (await isEnabled("photos")) && (await isEnabled("before_after"));
}

/** Stamped job photos by tag: geostamped, or not flagged as picked from the library. */
async function stampedPhotoCounts(
  jobId: string,
): Promise<{ before: number; after: number }> {
  const rows = await db
    .select({ tag: media.tag, n: sql<number>`count(*)::int` })
    .from(media)
    .where(
      and(
        eq(media.jobId, jobId),
        eq(media.kind, "photo"),
        sql`${media.deletedAt} is null`,
        inArray(media.tag, ["before", "after"]),
        or(
          isNotNull(media.lat),
          sql`not ('possibly_from_library' = any(${media.flags}))`,
        ),
      ),
    )
    .groupBy(media.tag);
  const by = Object.fromEntries(rows.map((r) => [r.tag, Number(r.n)]));
  return { before: by.before ?? 0, after: by.after ?? 0 };
}

async function photoCounts(
  jobId: string,
): Promise<{ before: number; after: number }> {
  const rows = await db
    .select({ tag: media.tag, n: sql<number>`count(*)::int` })
    .from(media)
    .where(
      and(
        eq(media.jobId, jobId),
        eq(media.kind, "photo"),
        sql`${media.deletedAt} is null`,
        inArray(media.tag, ["before", "after"]),
      ),
    )
    .groupBy(media.tag);
  const by = Object.fromEntries(rows.map((r) => [r.tag, Number(r.n)]));
  return { before: by.before ?? 0, after: by.after ?? 0 };
}

export async function loadReadinessFacts(job: JobRow): Promise<ReadinessFacts> {
  const settings = await getSettings();
  const ticket = await jobTicketCents(job);
  const estIds = (
    await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.jobId, job.id))
  ).map((e) => e.id);
  const estSig = estIds.length
    ? await db
        .select({ policies: signatures.policyVersionIds })
        .from(signatures)
        .where(
          and(
            eq(signatures.docType, "estimate"),
            inArray(signatures.docId, estIds),
            ne(signatures.channel, "verbal"),
          ),
        )
    : [];
  const completion = await db
    .select({ id: signatures.id })
    .from(signatures)
    .where(
      and(eq(signatures.docType, "completion"), eq(signatures.docId, job.id)),
    )
    .limit(1);
  const photos = await stampedPhotoCounts(job.id);
  const stamps = await db
    .select({ to: jobStatusEvents.toStatus })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.jobId, job.id),
        isNotNull(jobStatusEvents.lat),
        isNotNull(jobStatusEvents.lng),
        inArray(jobStatusEvents.toStatus, ["arrived", "completed"]),
      ),
    );
  const cos = await db
    .select({ status: changeOrders.status, sig: changeOrders.signatureId })
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.jobId, job.id),
        inArray(changeOrders.status, ["sent", "approved"]),
      ),
    );
  const co = await getChangeOrderStatus(job.id).catch(() => ({
    required: false,
  }));
  const pays = await db
    .select()
    .from(payments)
    .where(and(eq(payments.jobId, job.id), inArray(payments.status, PAID)));
  const nonTip = pays.filter((p) => p.kind !== "tip_only");
  const [receipts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.jobId, job.id),
        eq(messages.templateKey, "payment.receipt"),
        inArray(messages.status, ["sent", "sent_manual", "delivered"]),
      ),
    );
  const [comms] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.jobId, job.id), isNotNull(messages.customerId)));
  const cards = pays.filter((p) => p.method === "card");
  const strong = cards.filter(
    (p) =>
      p.entryMode === "tap" ||
      p.entryMode === "chip" ||
      p.threeDs === "authenticated" ||
      (p.avsResult === "pass" && p.cvcResult === "pass"),
  );
  return {
    signedEstimateWithPolicies: estSig.some(
      (s) => (s.policies?.length ?? 0) > 0,
    ),
    estimateApplicable: ticket >= settings.risk.no_estimate_min_ticket_cents,
    completionSigned: completion.length > 0,
    photosEnabled: await photosEnabled(),
    beforePhotos: photos.before,
    afterPhotos: photos.after,
    arrivedGeostamp: stamps.some((s) => s.to === "arrived"),
    completedGeostamp: stamps.some((s) => s.to === "completed"),
    changeOrdersTotal: cos.length,
    changeOrdersSigned: cos.filter((c) => c.status === "approved" && c.sig)
      .length,
    changeOrderRequired: !!co.required,
    paymentsCount: nonTip.length,
    receiptsDelivered: Number(receipts?.n ?? 0),
    customerMessages: Number(comms?.n ?? 0),
    cardPayments: cards.length,
    strongAuthPayments: strong.length,
  };
}

/**
 * The risk band the work started under: the assessment the start transition writes
 * (computeJobRisk "manual" in jobs/transition), i.e. the latest one up to just after
 * `startedAt`. Null before the job starts or when none was recorded.
 */
async function bandAtStart(job: JobRow): Promise<RiskBand | null> {
  if (!job.startedAt) return null;
  const [r] = await db
    .select({ band: riskAssessments.band })
    .from(riskAssessments)
    .where(
      and(
        eq(riskAssessments.jobId, job.id),
        lte(
          riskAssessments.computedAt,
          new Date(job.startedAt.getTime() + 10_000),
        ),
      ),
    )
    .orderBy(desc(riskAssessments.computedAt))
    .limit(1);
  return (r?.band as RiskBand | undefined) ?? null;
}

/**
 * Band for the completion controls: the current band, but never below the band the
 * work started under (QA2 re-check). Risk itself goes back down when a line is
 * removed, so a requirement that only came with the extra line drops with it; the
 * controls a job was started under stay (removing a line can't skip them).
 */
async function controlBand(
  job: JobRow,
  to: "in_progress" | "completed",
): Promise<RiskBand | null> {
  const now = (job.riskBand as RiskBand | null) ?? null;
  if (to !== "completed") return now;
  const atStart = await bandAtStart(job);
  if (!atStart) return now;
  if (!now) return atStart;
  return bandRank(atStart) > bandRank(now) ? atStart : now;
}

export async function loadControlFacts(
  job: JobRow,
  to: "in_progress" | "completed",
): Promise<ControlFacts> {
  const settings = await getSettings();
  const [st] = job.serviceTypeId
    ? await db
        .select()
        .from(serviceTypes)
        .where(eq(serviceTypes.id, job.serviceTypeId))
        .limit(1)
    : [];
  const [signed, co, photos, photosOn, depositsOn] = await Promise.all([
    hasSignedAuthorization(job.id),
    getChangeOrderStatus(job.id).catch(() => ({ required: false })),
    photoCounts(job.id),
    photosEnabled(),
    isEnabled("deposits"),
  ]);
  const completion = await db
    .select({ id: signatures.id })
    .from(signatures)
    .where(
      and(eq(signatures.docType, "completion"), eq(signatures.docId, job.id)),
    )
    .limit(1);
  const deps = await db
    .select({ status: depositRequests.status })
    .from(depositRequests)
    .where(eq(depositRequests.jobId, job.id));
  const pays = await db
    .select({ amount: payments.amountCents, status: payments.status })
    .from(payments)
    .where(and(eq(payments.jobId, job.id), inArray(payments.status, PAID)));
  const paidCents = pays.reduce((s, p) => s + p.amount, 0);
  const ticket = await jobTicketCents(job);
  const [approval] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, "job_start"),
        eq(approvals.entityId, job.id),
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(1);
  return {
    to,
    band: await controlBand(job, to),
    enforceBandControls: settings.risk.enforce_controls,
    photosEnabled: photosOn,
    depositsEnabled: depositsOn,
    serviceType: st
      ? {
          requiresSignedEstimate: st.requiresSignedEstimate,
          photosRequiredBefore: st.photosRequiredBefore,
          photosRequiredAfter: st.photosRequiredAfter,
        }
      : null,
    hasSignedAuthorization: signed,
    beforePhotos: photos.before,
    afterPhotos: photos.after,
    completionSigned: completion.length > 0,
    depositSatisfied:
      deps.some((d) =>
        ["paid", "held", "applied", "waived"].includes(d.status),
      ) || paidCents > 0,
    depositOutstanding: deps.some((d) =>
      ["required", "requested"].includes(d.status),
    ),
    startApproved: approval?.status === "approved",
    prepaid: ticket > 0 && paidCents >= ticket,
    criticalControl: settings.risk.critical_control,
    changeOrderRequired: !!co.required,
  };
}

/** Open (non-terminal) dispute statuses. */
export const OPEN_DISPUTE_STATUSES = OPEN_DISPUTE;
