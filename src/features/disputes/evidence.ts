import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  changeOrders,
  company,
  customers,
  depositRequests,
  estimates,
  invoices,
  jobAssignments,
  jobStatusEvents,
  jobs,
  lineItems,
  messages,
  payments,
  policyVersions,
  portalAccessLog,
  properties,
  publicTokens,
  refunds,
  serviceTypes,
  signatures,
  users,
} from "@/db/schema";
import {
  getMediaUrls,
  listJobMediaForEvidence,
  type MediaItem,
} from "@/features/media/api";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import { previewReadiness } from "./api";
import type { ReadinessResult } from "./contracts";
import type { DisputeCategory, NarrativeFacts } from "./narrative";

// Evidence assembly for the printable pack (/jobs/[id]/evidence) and the dispute
// evidence JSON (SPEC M10, RESEARCH §2.4). Reads only.

const PAID = ["succeeded", "partially_refunded", "refunded", "disputed"];

export const DOC_TYPE_LABEL: Record<string, string> = {
  estimate: "Estimate / work authorization",
  change_order: "Change order",
  completion: "Completion acknowledgment",
  deposit_terms: "Deposit terms",
  ownership: "Ownership / authority",
  card_on_file: "Card-on-file authorization",
  cooling_off_waiver: "Cooling-off waiver",
};

export interface EvidenceSignature {
  id: string;
  docType: string;
  docLabel: string;
  signerName: string;
  signedAt: Date;
  channel: string;
  ip: string | null;
  userAgent: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  docSha256: string;
  esignConsent: boolean;
  consentText: string | null;
  policies: { id: string; title: string; version: number; sha256: string }[];
  imageUrl: string | null;
  mediaId: string | null;
}

export interface EvidencePayment {
  id: string;
  kind: string;
  method: string;
  methodLabel: string;
  status: string;
  amountCents: number;
  tipCents: number;
  at: Date | null;
  entryMode: string | null;
  brand: string | null;
  funding: string | null;
  last4: string | null;
  avs: string | null;
  cvc: string | null;
  threeDs: string | null;
  wallet: string | null;
  reference: string | null;
  providerRef: string | null;
  collectedBy: string | null;
  verifiedAt: Date | null;
  refundedCents: number;
}

export interface EvidencePack {
  generatedAt: Date;
  tz: string;
  company: {
    name: string;
    legalName: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    descriptor: string | null;
  };
  job: {
    id: string;
    number: string;
    title: string;
    status: string;
    serviceName: string;
    createdAt: Date;
    scheduledStart: Date | null;
    windowStart: Date | null;
    windowEnd: Date | null;
    arrivedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    address: string;
    serviceFeeDisclosure: string | null;
    techs: { name: string; license: string | null }[];
  };
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  geostamps: {
    status: string;
    at: Date;
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
    distanceM: number | null;
    actor: string | null;
  }[];
  signatures: EvidenceSignature[];
  changeOrders: {
    number: string;
    reason: string;
    status: string;
    deltaCents: number;
    signed: boolean;
  }[];
  photos: { before: MediaItem[]; after: MediaItem[]; other: MediaItem[] };
  invoice: {
    id: string;
    number: string;
    status: string;
    issuedAt: Date | null;
    totalCents: number;
    taxCents: number;
    lines: {
      name: string;
      qty: number;
      unitCents: number;
      totalCents: number;
    }[];
  } | null;
  payments: EvidencePayment[];
  deposit: {
    amountCents: number;
    status: string;
    policyTitle: string | null;
    specialOrderPoAt: Date | null;
  } | null;
  messages: {
    at: Date;
    direction: string;
    channel: string;
    status: string;
    templateKey: string | null;
    body: string;
  }[];
  portalLog: {
    at: Date;
    action: string;
    path: string;
    ip: string | null;
    userAgent: string | null;
  }[];
  policies: {
    id: string;
    kind: string;
    title: string;
    version: number;
    sha256: string;
    body: string;
  }[];
  priorJobs: number;
  readiness: ReadinessResult | null;
}

function addressOf(p: {
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
}): string {
  return `${p.street}${p.unit ? ` ${p.unit}` : ""}, ${p.city}, ${p.state} ${p.zip}`;
}

/** Everything the printable evidence pack shows (null = job not found). */
export async function loadEvidencePack(
  jobId: string,
): Promise<EvidencePack | null> {
  const [row] = await db
    .select({
      job: jobs,
      customer: customers,
      property: properties,
      serviceName: serviceTypes.name,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) return null;
  const { job, customer, property } = row;
  const [co] = await db
    .select()
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  const settings = await getSettings();
  const tz = await getCompanyTimezone();

  const techRows = await db
    .select({
      name: users.name,
      licenses: users.licenseNumbers,
      role: jobAssignments.role,
    })
    .from(jobAssignments)
    .innerJoin(users, eq(users.id, jobAssignments.userId))
    .where(eq(jobAssignments.jobId, jobId));
  const stateLicense = (l: { state: string; number: string }[]) =>
    l.find((x) => x.state === property.state)?.number ?? l[0]?.number ?? null;

  const stamps = await db
    .select({ e: jobStatusEvents, actor: users.name })
    .from(jobStatusEvents)
    .leftJoin(users, eq(users.id, jobStatusEvents.actorUserId))
    .where(eq(jobStatusEvents.jobId, jobId))
    .orderBy(asc(jobStatusEvents.at));

  // Documents signed for this job: estimates + change orders + the job itself.
  const estIds = (
    await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.jobId, jobId))
  ).map((e) => e.id);
  const cos = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.jobId, jobId))
    .orderBy(asc(changeOrders.createdAt));
  const deps = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.jobId, jobId))
    .orderBy(desc(depositRequests.createdAt));
  const docIds = [
    jobId,
    ...estIds,
    ...cos.map((c) => c.id),
    ...deps.map((d) => d.id),
  ];
  const sigRows = await db
    .select()
    .from(signatures)
    .where(
      and(
        inArray(signatures.docId, docIds),
        inArray(signatures.docType, [
          "estimate",
          "change_order",
          "completion",
          "deposit_terms",
          "ownership",
          "card_on_file",
          "cooling_off_waiver",
        ]),
      ),
    )
    .orderBy(asc(signatures.signedAt));
  const policyIds = [
    ...new Set([
      ...sigRows.flatMap((s) => s.policyVersionIds ?? []),
      ...deps.map((d) => d.policyVersionId).filter((x): x is string => !!x),
      ...(job.cancellationPolicyVersionId
        ? [job.cancellationPolicyVersionId]
        : []),
    ]),
  ];
  const pols = policyIds.length
    ? await db
        .select()
        .from(policyVersions)
        .where(inArray(policyVersions.id, policyIds))
    : [];
  const polById = new Map(pols.map((p) => [p.id, p]));
  const sigImages = await getMediaUrls(
    sigRows.map((s) => s.signatureMediaId).filter((x): x is string => !!x),
  );

  const allMedia = await listJobMediaForEvidence(jobId);
  const photos = allMedia.filter((m) => m.kind === "photo");

  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  const lines = inv
    ? await db
        .select()
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "invoice"),
            eq(lineItems.parentId, inv.id),
          ),
        )
        .orderBy(asc(lineItems.sort))
    : [];

  const payRows = await db
    .select({ p: payments, collector: users.name })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.collectedByUserId))
    .where(eq(payments.jobId, jobId))
    .orderBy(asc(payments.createdAt));
  const refundRows = payRows.length
    ? await db
        .select()
        .from(refunds)
        .where(
          and(
            inArray(
              refunds.paymentId,
              payRows.map((r) => r.p.id),
            ),
            eq(refunds.status, "succeeded"),
          ),
        )
    : [];

  const msgs = await db
    .select()
    .from(messages)
    .where(and(eq(messages.jobId, jobId), isNotNull(messages.customerId)))
    .orderBy(asc(messages.createdAt))
    .limit(40);

  const tokenIds = (
    await db
      .select({ id: publicTokens.id })
      .from(publicTokens)
      .where(
        or(
          eq(publicTokens.jobId, jobId),
          inArray(publicTokens.entityId, [
            jobId,
            ...estIds,
            ...(inv ? [inv.id] : []),
          ]),
        ),
      )
  ).map((t) => t.id);
  const portal = tokenIds.length
    ? await db
        .select()
        .from(portalAccessLog)
        .where(inArray(portalAccessLog.tokenId, tokenIds))
        .orderBy(asc(portalAccessLog.createdAt))
        .limit(60)
    : [];

  const prior = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customer.id),
        ne(jobs.id, jobId),
        inArray(jobs.status, ["completed", "closed"]),
      ),
    );

  const brandOf = (b: string | null) =>
    b ? b.charAt(0).toUpperCase() + b.slice(1) : "Card";

  return {
    generatedAt: new Date(),
    tz,
    company: {
      name: co?.name ?? "",
      legalName: co?.legalName ?? null,
      phone: co?.phone ?? null,
      email: co?.email ?? null,
      website: co?.website ?? null,
      address: co?.address
        ? [co.address.street, co.address.city, co.address.state, co.address.zip]
            .filter(Boolean)
            .join(", ")
        : null,
      descriptor: settings.payments.statement_descriptor,
    },
    job: {
      id: job.id,
      number: job.number,
      title: job.title,
      status: job.status,
      serviceName: row.serviceName ?? job.title,
      createdAt: job.createdAt,
      scheduledStart: job.scheduledStart,
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      arrivedAt: job.arrivedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      address: addressOf(property),
      serviceFeeDisclosure: job.serviceFeeDisclosure,
      techs: techRows.map((t) => ({
        name: t.name,
        license: stateLicense(t.licenses ?? []),
      })),
    },
    customer: {
      id: customer.id,
      name: customer.displayName,
      email: customer.email,
      phone: customer.phone,
    },
    geostamps: stamps.map((s) => ({
      status: s.e.toStatus,
      at: s.e.at,
      lat: s.e.lat,
      lng: s.e.lng,
      accuracyM: s.e.accuracyM,
      distanceM: s.e.distanceM,
      actor: s.actor,
    })),
    signatures: sigRows.map((s) => ({
      id: s.id,
      docType: s.docType,
      docLabel: DOC_TYPE_LABEL[s.docType] ?? s.docType,
      signerName: s.signerName,
      signedAt: s.signedAt,
      channel: s.channel,
      ip: s.ip,
      userAgent: s.userAgent,
      lat: s.lat,
      lng: s.lng,
      accuracyM: s.accuracyM,
      docSha256: s.docSha256,
      esignConsent: s.esignConsent,
      consentText: s.consentText,
      policies: (s.policyVersionIds ?? [])
        .map((id) => polById.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
          id: p.id,
          title: p.title,
          version: p.version,
          sha256: p.sha256,
        })),
      imageUrl: s.signatureMediaId
        ? (sigImages[s.signatureMediaId] ?? null)
        : null,
      mediaId: s.signatureMediaId,
    })),
    changeOrders: cos.map((c) => ({
      number: c.number,
      reason: c.reason,
      status: c.status,
      deltaCents: c.deltaCents,
      signed: !!c.signatureId,
    })),
    photos: {
      before: photos.filter((p) => p.tag === "before"),
      after: photos.filter((p) => p.tag === "after"),
      other: photos.filter((p) => p.tag !== "before" && p.tag !== "after"),
    },
    invoice: inv
      ? {
          id: inv.id,
          number: inv.number,
          status: inv.status,
          issuedAt: inv.issuedAt,
          totalCents: inv.totalCents,
          taxCents: inv.taxCents,
          lines: lines.map((l) => ({
            name: l.name,
            qty: Number(l.qty),
            unitCents: l.unitPriceCents,
            totalCents: l.totalCents,
          })),
        }
      : null,
    payments: payRows.map(({ p, collector }) => ({
      id: p.id,
      kind: p.kind,
      method: p.method,
      methodLabel:
        p.method === "card"
          ? `${brandOf(p.cardBrand)}${p.cardLast4 ? ` ••${p.cardLast4}` : ""}`
          : p.method.charAt(0).toUpperCase() + p.method.slice(1),
      status: p.status,
      amountCents: p.amountCents,
      tipCents: p.tipCents,
      at: p.succeededAt ?? p.authorizedAt ?? p.createdAt,
      entryMode: p.entryMode,
      brand: p.cardBrand,
      funding: p.cardFunding,
      last4: p.cardLast4,
      avs: p.avsResult,
      cvc: p.cvcResult,
      threeDs: p.threeDs,
      wallet: p.wallet,
      reference: p.reference,
      providerRef: p.providerRef,
      collectedBy: collector,
      verifiedAt: p.verifiedAt,
      refundedCents: refundRows
        .filter((r) => r.paymentId === p.id)
        .reduce((s, r) => s + r.amountCents, 0),
    })),
    deposit: deps[0]
      ? {
          amountCents: deps[0].amountCents,
          status: deps[0].status,
          policyTitle: deps[0].policyVersionId
            ? (polById.get(deps[0].policyVersionId)?.title ?? null)
            : null,
          specialOrderPoAt: deps[0].specialOrderPoAt,
        }
      : null,
    messages: msgs.map((m) => ({
      at: m.sentAt ?? m.createdAt,
      direction: m.direction,
      channel: m.channel,
      status: m.status,
      templateKey: m.templateKey,
      body: m.body,
    })),
    portalLog: portal.map((l) => ({
      at: l.createdAt,
      action: l.action,
      path: l.path,
      ip: l.ip,
      userAgent: l.userAgent,
    })),
    policies: pols.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      version: p.version,
      sha256: p.sha256,
      body: p.body.replaceAll("{company}", co?.name ?? "We"),
    })),
    priorJobs: prior.length,
    readiness: await previewReadiness(jobId),
  };
}

/** Facts for the template narrative / evidence fields from a loaded pack. */
export function narrativeFactsFromPack(
  pack: EvidencePack,
  paymentId: string | null,
): NarrativeFacts {
  const tz = pack.tz;
  const fmt = (d: Date | null | undefined) =>
    d ? formatDateTime(d, tz) : null;
  const pay =
    pack.payments.find((p) => p.id === paymentId) ??
    pack.payments.filter((p) => PAID.includes(p.status)).at(-1) ??
    null;
  const est = pack.signatures.find((s) => s.docType === "estimate");
  const comp = pack.signatures.find((s) => s.docType === "completion");
  const geo = (status: string) =>
    pack.geostamps.some((g) => g.status === status && g.lat != null);
  const deposit = pack.payments.find(
    (p) => p.kind === "deposit" && PAID.includes(p.status),
  );
  const balance = pack.payments.find(
    (p) => p.kind === "payment" && PAID.includes(p.status),
  );
  const refundPolicy = pack.policies.find((p) => p.kind === "refund");
  const cancelPolicy = pack.policies.find((p) => p.kind === "cancellation");
  const lineSummary = pack.invoice?.lines.length
    ? pack.invoice.lines
        .slice(0, 6)
        .map((l) => `${l.name} (${formatMoney(l.totalCents)})`)
        .join("; ")
    : pack.job.title;
  const ip =
    est?.ip ??
    pack.portalLog.find((l) => l.action === "paid" || l.action === "pay_opened")
      ?.ip ??
    null;
  const entry = pay?.entryMode ? ` (${pay.entryMode})` : "";
  return {
    companyName: pack.company.name,
    customerName: pack.customer.name,
    customerEmail: pack.customer.email,
    serviceAddress: pack.job.address,
    jobNumber: pack.job.number,
    serviceName: pack.job.serviceName,
    bookedOn: formatDate(pack.job.createdAt, tz),
    serviceDate: pack.job.completedAt
      ? formatDate(pack.job.completedAt, tz)
      : pack.job.scheduledStart
        ? formatDate(pack.job.scheduledStart, tz)
        : null,
    arrivedAt: fmt(pack.job.arrivedAt),
    completedAt: fmt(pack.job.completedAt),
    techName: pack.job.techs[0]?.name ?? null,
    techLicense: pack.job.techs[0]?.license ?? null,
    lineSummary,
    totalFormatted: formatMoney(
      pack.invoice?.totalCents ?? pay?.amountCents ?? 0,
    ),
    amountFormatted: formatMoney(
      (pay?.amountCents ?? 0) + (pay?.tipCents ?? 0),
    ),
    paymentMethodLabel: pay ? `${pay.methodLabel}${entry}` : "card",
    paidAt: fmt(pay?.at),
    estimateSigned: est
      ? {
          signer: est.signerName,
          at: fmt(est.signedAt) ?? "",
          channel: est.channel,
        }
      : null,
    completionSigned: comp
      ? { signer: comp.signerName, at: fmt(comp.signedAt) ?? "" }
      : null,
    arrivalGeostamped: geo("arrived"),
    completionGeostamped: geo("completed"),
    beforePhotos: pack.photos.before.length,
    afterPhotos: pack.photos.after.length,
    messagesCount: pack.messages.length,
    portalViews: pack.portalLog.length,
    receiptSent: pack.messages.some(
      (m) =>
        m.templateKey === "payment.receipt" &&
        ["sent", "sent_manual", "delivered"].includes(m.status),
    ),
    refundPolicy: refundPolicy
      ? `${refundPolicy.title} v${refundPolicy.version}`
      : null,
    cancellationPolicy: cancelPolicy
      ? `${cancelPolicy.title} (v${cancelPolicy.version}): ${cancelPolicy.body.slice(0, 600)}`
      : null,
    priorJobs: pack.priorJobs,
    depositAndBalance:
      deposit && balance
        ? {
            depositRef: `${formatMoney(deposit.amountCents)} on ${fmt(deposit.at) ?? "—"}`,
            balanceRef: `${formatMoney(balance.amountCents)} on ${fmt(balance.at) ?? "—"}`,
          }
        : null,
    ip,
  };
}

/** Default file evidence: signature images and the first before/after photos (media ids). */
export function defaultEvidenceFiles(
  pack: EvidencePack,
  category: DisputeCategory,
): Record<string, { media_id: string }> {
  const out: Record<string, { media_id: string }> = {};
  const sig =
    pack.signatures.find((s) => s.docType === "estimate" && s.mediaId) ??
    pack.signatures.find((s) => s.mediaId);
  if (sig?.mediaId) out.customer_signature = { media_id: sig.mediaId };
  const svc = pack.photos.after[0] ?? pack.photos.before[0];
  if (svc && category !== "duplicate")
    out.service_documentation = { media_id: svc.id };
  return out;
}
