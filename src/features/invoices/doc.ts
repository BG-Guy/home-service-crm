import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  creditNotes,
  customers,
  invoiceBalances,
  invoiceRevisions,
  invoices,
  jobAssignments,
  jobs,
  lineItems,
  payments,
  properties,
  refunds,
  serviceTypes,
  users,
} from "@/db/schema";
import { getMediaUrls } from "@/features/media/api";
import { getCurrentPolicy } from "@/lib/policies";
import { findCompany, getSettings } from "@/lib/settings";
import { areaLine } from "./masking";
import { balanceOf, isOverdue } from "./math";
import {
  buildInvoiceMoneyLines,
  type DocCredit,
  type DocTipLine,
} from "./money-lines";

// Read models shared by the invoice detail, the print page, the statement and the
// public /i/[token] page. NO permission checks here — every caller authorizes first
// (requireUser + assertInvoiceAccess, or a valid magic link).

export interface DocCompany {
  name: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLines: string[];
  licenses: string[];
  logoUrl: string | null;
  headerStyle: "standard" | "centered" | "minimal";
}

export interface DocLine {
  id: string;
  sort: number;
  type: string;
  pricebookItemId: string | null;
  name: string;
  description: string | null;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number | null;
  discountCents: number;
  totalCents: number;
  taxable: boolean;
  partSource: string | null;
  partPurchaseId: string | null;
  warrantyDays: number | null;
  manufacturerWarrantyMonths: number | null;
  serial: string | null;
  isOptional: boolean;
  isSelected: boolean;
  isUpsell: boolean;
  isServiceFee: boolean;
}

export type { DocCredit, DocTipLine } from "./money-lines";

export interface InvoiceDoc {
  invoice: {
    id: string;
    number: string;
    status: string;
    version: number;
    issuedAt: Date | null;
    dueAt: Date | null;
    terms: string | null;
    notes: string | null;
    warrantyText: string | null;
    showPhotos: boolean;
    photoMediaIds: string[];
    descriptorSuffix: string | null;
    voidedAt: Date | null;
    voidReason: string | null;
    createdAt: Date;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    paidCents: number;
    refundedCents: number;
    creditedCents: number;
    balanceCents: number;
    overdue: boolean;
  };
  company: DocCompany;
  customer: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    type: string;
    taxExempt: boolean;
  };
  /** `areaLines` = city/state/ZIP only, shown outside the contact window. */
  property: { addressLines: string[]; areaLines: string[] } | null;
  job: {
    id: string;
    number: string;
    title: string;
    status: string;
    serviceDate: Date | null;
    serviceTypeName: string | null;
  } | null;
  techs: { id: string; name: string; license: string | null }[];
  lines: DocLine[];
  /** Balance lines under the total (they reconcile with balanceCents). */
  credits: DocCredit[];
  /** Tips paid and refunded: shown apart, never part of the balance (QA2). */
  tips: DocTipLine[];
  revisions: {
    version: number;
    createdAt: Date;
    reason: string | null;
    sha256: string;
    byName: string | null;
    afterPayment: boolean;
  }[];
  descriptor: string;
  warrantyPolicy: { title: string; body: string } | null;
  footer: string;
  /** Company time zone for every date on the document. */
  timezone: string;
}

export function addressLines(
  a:
    | {
        street?: string | null;
        unit?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
      }
    | null
    | undefined,
): string[] {
  if (!a) return [];
  const l1 = [a.street, a.unit].filter(Boolean).join(", ");
  const l2 = [a.city, [a.state, a.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [l1, l2].filter(Boolean);
}

const METHOD: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  ach: "Bank transfer",
  other: "Other",
  card: "Card",
};

export function paymentMethodLabel(p: {
  method: string;
  cardBrand?: string | null;
  cardLast4?: string | null;
  reference?: string | null;
}): string {
  if (p.method === "card" && p.cardLast4) {
    const brand = p.cardBrand
      ? p.cardBrand.charAt(0).toUpperCase() + p.cardBrand.slice(1)
      : "Card";
    return `${brand} ••${p.cardLast4}`;
  }
  const base = METHOD[p.method] ?? p.method;
  return p.method === "check" && p.reference ? `${base} #${p.reference}` : base;
}

const fmtDay = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: tz,
  }).format(d);

/** Company block for document headers (cached per request). */
export const loadDocCompany = cache(async (): Promise<DocCompany> => {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const logoId = company?.logoMediaId ?? null;
  const urls = logoId ? await getMediaUrls([logoId], "full") : {};
  return {
    name: settings.branding.app_name || company?.name || "Your company",
    legalName: company?.legalName ?? null,
    phone: company?.phone ?? null,
    email: company?.email ?? null,
    website: company?.website ?? null,
    addressLines: addressLines(company?.address ?? null),
    licenses: settings.company.license_numbers.map(
      (l) => `${l.state} ${l.trade} #${l.number}`,
    ),
    logoUrl: logoId ? (urls[logoId] ?? null) : null,
    headerStyle: settings.branding.invoice_header_style,
  };
});

/** Statement descriptor line text, e.g. "ACME HOME SVCS* J1042". */
export async function descriptorFor(suffix: string | null): Promise<string> {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const base = (
    settings.payments.statement_descriptor ||
    company?.name ||
    "COMPANY"
  )
    .toUpperCase()
    .replace(/[^A-Z0-9 &.-]/g, "")
    .slice(0, 22)
    .trim();
  return suffix ? `${base}* ${suffix}` : base;
}

export const loadInvoiceDoc = cache(
  async (invoiceId: string): Promise<InvoiceDoc | null> => {
    const [row] = await db
      .select({
        inv: invoices,
        bal: {
          paidCents: invoiceBalances.paidCents,
          refundedCents: invoiceBalances.refundedCents,
          creditedCents: invoiceBalances.creditedCents,
        },
      })
      .from(invoices)
      .leftJoin(invoiceBalances, eq(invoiceBalances.invoiceId, invoices.id))
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!row) return null;
    const inv = row.inv;
    const [company, settings, tz] = await Promise.all([
      loadDocCompany(),
      getSettings(),
      findCompany().then((c) => c?.timezone ?? "America/New_York"),
    ]);
    const [cust] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, inv.customerId))
      .limit(1);
    const [prop] = inv.propertyId
      ? await db
          .select()
          .from(properties)
          .where(eq(properties.id, inv.propertyId))
          .limit(1)
      : [];
    const [job] = inv.jobId
      ? await db
          .select({
            id: jobs.id,
            number: jobs.number,
            title: jobs.title,
            status: jobs.status,
            completedAt: jobs.completedAt,
            startedAt: jobs.startedAt,
            scheduledStart: jobs.scheduledStart,
            windowStart: jobs.windowStart,
            serviceTypeName: serviceTypes.name,
          })
          .from(jobs)
          .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
          .where(eq(jobs.id, inv.jobId))
          .limit(1)
      : [];
    const techRows = inv.jobId
      ? await db
          .select({
            id: users.id,
            name: users.name,
            role: jobAssignments.role,
            licenses: users.licenseNumbers,
          })
          .from(jobAssignments)
          .innerJoin(users, eq(users.id, jobAssignments.userId))
          .where(eq(jobAssignments.jobId, inv.jobId))
          .orderBy(asc(jobAssignments.role))
      : [];
    const lines = await db
      .select()
      .from(lineItems)
      .where(
        and(
          eq(lineItems.parentType, "invoice"),
          eq(lineItems.parentId, inv.id),
        ),
      );
    lines.sort(
      (a, b) =>
        a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const pays = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, inv.id),
          inArray(payments.status, [
            "succeeded",
            "partially_refunded",
            "refunded",
            "disputed",
          ]),
        ),
      )
      .orderBy(asc(payments.succeededAt));
    const refs = pays.length
      ? await db
          .select()
          .from(refunds)
          .where(
            and(
              inArray(
                refunds.paymentId,
                pays.map((p) => p.id),
              ),
              eq(refunds.status, "succeeded"),
            ),
          )
      : [];
    const cns = await db
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.invoiceId, inv.id))
      .orderBy(asc(creditNotes.createdAt));
    const revs = await db
      .select({
        version: invoiceRevisions.version,
        createdAt: invoiceRevisions.createdAt,
        reason: invoiceRevisions.reason,
        sha256: invoiceRevisions.sha256,
        diff: invoiceRevisions.diff,
        byName: users.name,
      })
      .from(invoiceRevisions)
      .leftJoin(users, eq(users.id, invoiceRevisions.createdBy))
      .where(eq(invoiceRevisions.invoiceId, inv.id))
      .orderBy(desc(invoiceRevisions.version));
    const warranty = await getCurrentPolicy("warranty");

    // Refund lines carry only their invoice part; the tip part goes to `tips`, so
    // the lines reconcile with the capped invoice_balances view (QA2).
    const { credits, tips } = buildInvoiceMoneyLines({
      payments: pays.map((p) => {
        const at = p.succeededAt ?? p.createdAt;
        return {
          id: p.id,
          kind: p.kind,
          amountCents: p.amountCents,
          tipCents: p.tipCents,
          status: p.status,
          at,
          day: fmtDay(at, tz),
          method: paymentMethodLabel(p),
        };
      }),
      refunds: refs.map((r) => {
        const at = r.completedAt ?? r.createdAt;
        return {
          id: r.id,
          paymentId: r.paymentId,
          amountCents: r.amountCents,
          reason: r.reason,
          at,
          day: fmtDay(at, tz),
        };
      }),
      creditNotes: cns.map((c) => ({
        id: c.id,
        number: c.number,
        reason: c.reason,
        amountCents: c.amountCents,
        at: c.createdAt,
      })),
    });

    const paid = Number(row.bal?.paidCents ?? 0);
    const refunded = Number(row.bal?.refundedCents ?? 0);
    const credited = Number(row.bal?.creditedCents ?? 0);
    const balance =
      inv.status === "void"
        ? 0
        : balanceOf({
            totalCents: inv.totalCents,
            paidCents: paid,
            refundedCents: refunded,
            creditedCents: credited,
          });
    const firstPaidAt =
      pays.find((p) => p.kind !== "tip_only")?.succeededAt ?? null;

    return {
      invoice: {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        version: inv.version,
        issuedAt: inv.issuedAt,
        dueAt: inv.dueAt,
        terms: inv.terms,
        notes: inv.notes,
        warrantyText: inv.warrantyText,
        showPhotos: inv.showPhotos,
        photoMediaIds: inv.photoMediaIds,
        descriptorSuffix: inv.descriptorSuffix,
        voidedAt: inv.voidedAt,
        voidReason: inv.voidReason,
        createdAt: inv.createdAt,
        subtotalCents: inv.subtotalCents,
        discountCents: inv.discountCents,
        taxCents: inv.taxCents,
        totalCents: inv.totalCents,
        paidCents: paid,
        refundedCents: refunded,
        creditedCents: credited,
        balanceCents: balance,
        // Overdue from the local day after the due date (QA2: never on issue day).
        overdue:
          (inv.status === "issued" || inv.status === "partially_paid") &&
          isOverdue(inv.dueAt, new Date(), tz) &&
          balance > 0,
      },
      company,
      customer: {
        id: cust?.id ?? inv.customerId,
        displayName: cust?.displayName ?? "Customer",
        companyName: cust?.companyName ?? null,
        email: cust?.email ?? null,
        phone: cust?.phone ?? null,
        type: cust?.type ?? "residential",
        taxExempt: cust?.taxExempt ?? false,
      },
      property: prop
        ? {
            addressLines: addressLines(prop),
            areaLines: [areaLine(prop)].filter((l): l is string => !!l),
          }
        : null,
      job: job
        ? {
            id: job.id,
            number: job.number,
            title: job.title,
            status: job.status,
            serviceDate:
              job.completedAt ??
              job.startedAt ??
              job.scheduledStart ??
              job.windowStart,
            serviceTypeName: job.serviceTypeName,
          }
        : null,
      techs: techRows.map((t) => {
        const lic = (t.licenses ?? [])[0];
        return {
          id: t.id,
          name: t.name,
          license: lic ? `${lic.state} #${lic.number}` : null,
        };
      }),
      lines: lines.map((l) => ({
        id: l.id,
        sort: l.sort,
        type: l.type,
        pricebookItemId: l.pricebookItemId,
        name: l.name,
        description: l.description,
        qty: Number(l.qty),
        unitPriceCents: l.unitPriceCents,
        unitCostCents: l.unitCostCents,
        discountCents: l.discountCents,
        totalCents: l.totalCents,
        taxable: l.taxable,
        partSource: l.partSource,
        partPurchaseId: l.partPurchaseId,
        warrantyDays: l.warrantyDays,
        manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
        serial: l.serial,
        isOptional: l.isOptional,
        isSelected: l.isSelected,
        isUpsell: l.isUpsell,
        isServiceFee: l.isServiceFee,
      })),
      credits,
      tips,
      revisions: revs.map((r) => ({
        version: r.version,
        createdAt: r.createdAt,
        reason: r.reason,
        sha256: r.sha256,
        byName: r.byName ?? null,
        afterPayment:
          !!(r.diff as { afterPayment?: boolean } | null)?.afterPayment ||
          (r.version > 1 && !!firstPaidAt && r.createdAt > firstPaidAt),
      })),
      descriptor: await descriptorFor(inv.descriptorSuffix),
      warrantyPolicy: warranty
        ? {
            title: warranty.title,
            body: warranty.body.replaceAll("{company}", company.name),
          }
        : null,
      footer: settings.invoices.footer,
      timezone: tz,
    };
  },
);
