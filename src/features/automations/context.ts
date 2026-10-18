import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  calls,
  customers,
  depositRequests,
  disputes,
  entityTags,
  estimates,
  invoices,
  jobAssignments,
  jobs,
  leadSources,
  leads,
  partPurchases,
  payments,
  payPeriods,
  properties,
  refunds,
  reviewRequests,
  roles,
  serviceTypes,
  settlements,
  tags,
  tasks,
  toolIncidents,
  tools,
  users,
  vehicleDocuments,
  vehicleIssues,
  vehicles,
} from "@/db/schema";
import { getEstimateBriefs } from "@/features/estimates/api";
import { getDefaultBookingLink } from "@/features/leads/api";
import { getInvoiceBalance } from "@/features/payments/api";
import { safeHttpsUrl } from "@/features/reviews/url";
import { appUrl } from "@/lib/env";
import type { EventType } from "@/lib/event-types";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { type CompanySettings, getCompany, getSettings } from "@/lib/settings";
import type { TemplateContext } from "@/lib/template";
import { addDaysToKey, dateKey, safeTimeZone, zonedParts } from "@/lib/time";
import { mintPublicToken, TOKEN_TTL } from "@/lib/tokens";
import type { EntityRef } from "@/lib/types";
import { statusDef } from "@/ui/status";

// buildContext (SPEC §7.4): loads the facts a message is about and formats every
// template variable as a GSM-7-safe string. Links are minted per send (job, estimate,
// invoice, pay, review, tracking tokens) only when the template references them.
// The same facts feed the automation condition evaluator (`conditionContext`).
//
// Reads other modules' tables directly (reads are open, BUILD_PLAN §3.2) and calls
// their read APIs where a derived value exists (invoice balance, estimate totals).

export interface ContextRef {
  customerId?: string | null;
  jobId?: string | null;
  leadId?: string | null;
  entity?: EntityRef | null;
  /** Staff recipient (user.* variables). */
  userId?: string | null;
  /** Triggering event (event.* in conditions; extra variables). */
  event?: { type: string; payload: Record<string, unknown>; at?: Date } | null;
}

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export interface Facts {
  settings: CompanySettings;
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    timezone: string;
    address: string | null;
  };
  tz: string;
  customer: Row<typeof customers> | null;
  customerTags: string[];
  property: Row<typeof properties> | null;
  job: Row<typeof jobs> | null;
  assignees: { userId: string; role: string; name: string }[];
  tech: { id: string; name: string; licenseNumbers: unknown } | null;
  serviceType: Row<typeof serviceTypes> | null;
  /** `reached`: a call on this lead connected since it came in (QA T6-04). */
  lead:
    | (Row<typeof leads> & { sourceName: string | null; reached: boolean })
    | null;
  estimate: (Row<typeof estimates> & { totalCents: number }) | null;
  invoice: (Row<typeof invoices> & { balanceCents: number }) | null;
  payment: Row<typeof payments> | null;
  collector: { name: string; baseRole: string } | null;
  deposit: Row<typeof depositRequests> | null;
  refund: Row<typeof refunds> | null;
  dispute: Row<typeof disputes> | null;
  review: Row<typeof reviewRequests> | null;
  vehicle: Row<typeof vehicles> | null;
  tool: Row<typeof tools> | null;
  task: Row<typeof tasks> | null;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string;
  } | null;
  subjectUser: { id: string; name: string } | null;
  lastJob: { service: string | null; completedAt: Date | null } | null;
  event: ContextRef["event"];
  entity: EntityRef | null;
}

async function one<T>(p: Promise<T[]>): Promise<T | null> {
  return (await p)[0] ?? null;
}

/** Company address one-liner from company.address jsonb (best effort). */
function addressLine(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const parts = [o.street, o.city, o.state].filter(
    (x) => typeof x === "string" && x,
  );
  return parts.length ? parts.join(", ") : null;
}

/**
 * Did a call connect with this lead after it came in? Any connected call on the lead,
 * or on its customer since the lead was created (calls logged from the customer page).
 * Any call attempt moves a lead to `contacted`, so the status alone can't tell.
 */
async function leadReached(
  exec: Tx,
  l: { id: string; customerId: string | null; createdAt: Date },
): Promise<boolean> {
  const r = await one(
    exec
      .select({ id: calls.id })
      .from(calls)
      .where(
        and(
          eq(calls.outcome, "connected"),
          l.customerId
            ? sql`(${calls.leadId} = ${l.id} or (${calls.customerId} = ${l.customerId} and ${calls.createdAt} >= ${l.createdAt}))`
            : eq(calls.leadId, l.id),
        ),
      )
      .limit(1),
  );
  return !!r;
}

/** Load every fact the message could reference. Small PK lookups; no N+1 over lists. */
export async function loadFacts(
  ref: ContextRef,
  exec: Tx = db,
): Promise<Facts> {
  const [settings, companyRow] = await Promise.all([
    getSettings(),
    getCompany(),
  ]);
  const entity = ref.entity ?? null;
  const payload = (ref.event?.payload ?? {}) as Record<string, unknown>;
  const pid = (k: string) =>
    typeof payload[k] === "string" ? (payload[k] as string) : null;
  const eid = (t: string) => (entity?.type === t ? entity.id : null);

  // Entity-level rows first: they tell us the job/customer when the ref doesn't.
  const leadId = ref.leadId ?? eid("lead") ?? pid("lead_id");
  const estimateId = eid("estimate") ?? pid("estimate_id");
  const invoiceId = eid("invoice") ?? pid("invoice_id");
  const paymentId = eid("payment") ?? pid("payment_id");
  const depositId = eid("deposit_request") ?? pid("deposit_request_id");
  const refundId = eid("refund") ?? pid("refund_id");
  const disputeId = eid("dispute") ?? pid("dispute_id");
  const reviewId = eid("review_request") ?? pid("review_request_id");
  const taskId = eid("task") ?? pid("task_id");

  const [
    leadRow,
    estimate,
    invoice,
    payment,
    deposit,
    refund,
    dispute,
    review,
    task,
  ] = await Promise.all([
    leadId
      ? one(
          exec
            .select({ l: leads, sourceName: leadSources.name })
            .from(leads)
            .leftJoin(leadSources, eq(leadSources.id, leads.leadSourceId))
            .where(eq(leads.id, leadId))
            .limit(1),
        ).then((r) => (r ? { ...r.l, sourceName: r.sourceName } : null))
      : null,
    estimateId
      ? one(
          exec
            .select()
            .from(estimates)
            .where(eq(estimates.id, estimateId))
            .limit(1),
        )
      : null,
    invoiceId
      ? one(
          exec
            .select()
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .limit(1),
        )
      : null,
    paymentId
      ? one(
          exec
            .select()
            .from(payments)
            .where(eq(payments.id, paymentId))
            .limit(1),
        )
      : null,
    depositId
      ? one(
          exec
            .select()
            .from(depositRequests)
            .where(eq(depositRequests.id, depositId))
            .limit(1),
        )
      : null,
    refundId
      ? one(
          exec.select().from(refunds).where(eq(refunds.id, refundId)).limit(1),
        )
      : null,
    disputeId
      ? one(
          exec
            .select()
            .from(disputes)
            .where(eq(disputes.id, disputeId))
            .limit(1),
        )
      : null,
    reviewId
      ? one(
          exec
            .select()
            .from(reviewRequests)
            .where(eq(reviewRequests.id, reviewId))
            .limit(1),
        )
      : null,
    taskId
      ? one(exec.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))
      : null,
  ]);

  const lead = leadRow
    ? { ...leadRow, reached: await leadReached(exec, leadRow) }
    : null;

  // Payment → invoice (receipts link to the invoice).
  let inv = invoice;
  if (!inv && payment?.invoiceId)
    inv = await one(
      exec
        .select()
        .from(invoices)
        .where(eq(invoices.id, payment.invoiceId))
        .limit(1),
    );
  let refundPayment = payment;
  if (!refundPayment && refund?.paymentId)
    refundPayment = await one(
      exec
        .select()
        .from(payments)
        .where(eq(payments.id, refund.paymentId))
        .limit(1),
    );
  const disputePayment =
    dispute && !refundPayment
      ? await one(
          exec
            .select()
            .from(payments)
            .where(eq(payments.id, dispute.paymentId))
            .limit(1),
        )
      : null;
  const pay = refundPayment ?? disputePayment;

  const jobId =
    ref.jobId ??
    eid("job") ??
    pid("job_id") ??
    estimate?.jobId ??
    inv?.jobId ??
    pay?.jobId ??
    deposit?.jobId ??
    review?.jobId ??
    task?.jobId ??
    null;

  const job = jobId
    ? await one(exec.select().from(jobs).where(eq(jobs.id, jobId)).limit(1))
    : null;

  const customerId =
    ref.customerId ??
    eid("customer") ??
    pid("customer_id") ??
    job?.customerId ??
    lead?.customerId ??
    estimate?.customerId ??
    inv?.customerId ??
    pay?.customerId ??
    review?.customerId ??
    task?.customerId ??
    null;

  const [customer, property, assigneeRows, serviceType] = await Promise.all([
    customerId
      ? one(
          exec
            .select()
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1),
        )
      : null,
    job?.propertyId
      ? one(
          exec
            .select()
            .from(properties)
            .where(eq(properties.id, job.propertyId))
            .limit(1),
        )
      : customerId
        ? one(
            exec
              .select()
              .from(properties)
              .where(
                and(
                  eq(properties.customerId, customerId),
                  isNull(properties.deletedAt),
                ),
              )
              .orderBy(desc(properties.isPrimary), asc(properties.createdAt))
              .limit(1),
          )
        : null,
    job
      ? exec
          .select({
            userId: jobAssignments.userId,
            role: jobAssignments.role,
            name: users.name,
            lic: users.licenseNumbers,
          })
          .from(jobAssignments)
          .innerJoin(users, eq(users.id, jobAssignments.userId))
          .where(eq(jobAssignments.jobId, job.id))
          .orderBy(asc(jobAssignments.assignedAt))
      : [],
    job?.serviceTypeId || lead?.serviceTypeId
      ? one(
          exec
            .select()
            .from(serviceTypes)
            .where(
              eq(
                serviceTypes.id,
                (job?.serviceTypeId ?? lead?.serviceTypeId) as string,
              ),
            )
            .limit(1),
        )
      : null,
  ]);

  const primary =
    assigneeRows.find((a) => a.role === "primary") ?? assigneeRows[0] ?? null;

  const customerTags = customerId
    ? (
        await exec
          .select({ name: tags.name })
          .from(entityTags)
          .innerJoin(tags, eq(tags.id, entityTags.tagId))
          .where(
            and(
              eq(entityTags.entityType, "customer"),
              eq(entityTags.entityId, customerId),
            ),
          )
      ).map((t) => t.name.toLowerCase())
    : [];

  // Derived money (owner APIs).
  let invoiceFull: Facts["invoice"] = null;
  if (inv) {
    let balanceCents = inv.totalCents;
    try {
      balanceCents = (await getInvoiceBalance(inv.id)).balanceCents;
    } catch {
      /* stub or missing view → total */
    }
    invoiceFull = { ...inv, balanceCents };
  } else if (job && !invoiceId) {
    const latest = await one(
      exec
        .select()
        .from(invoices)
        .where(and(eq(invoices.jobId, job.id), ne(invoices.status, "void")))
        .orderBy(desc(invoices.createdAt))
        .limit(1),
    );
    if (latest) {
      let balanceCents = latest.totalCents;
      try {
        balanceCents = (await getInvoiceBalance(latest.id)).balanceCents;
      } catch {
        /* keep total */
      }
      invoiceFull = { ...latest, balanceCents };
    }
  }
  let estimateFull: Facts["estimate"] = null;
  if (estimate) {
    let totalCents = 0;
    try {
      const briefs = await getEstimateBriefs({
        customerId: estimate.customerId,
      });
      totalCents = briefs.find((b) => b.id === estimate.id)?.totalCents ?? 0;
    } catch {
      /* stub */
    }
    estimateFull = { ...estimate, totalCents };
  }

  // Vehicle / tool / users.
  const vehicleId =
    eid("vehicle") ??
    pid("vehicle_id") ??
    (eid("document")
      ? (
          await one(
            exec
              .select({ v: vehicleDocuments.vehicleId })
              .from(vehicleDocuments)
              .where(eq(vehicleDocuments.id, eid("document") as string))
              .limit(1),
          )
        )?.v
      : null) ??
    (pid("vehicle_document_id")
      ? (
          await one(
            exec
              .select({ v: vehicleDocuments.vehicleId })
              .from(vehicleDocuments)
              .where(
                eq(vehicleDocuments.id, pid("vehicle_document_id") as string),
              )
              .limit(1),
          )
        )?.v
      : null) ??
    (pid("issue_id")
      ? (
          await one(
            exec
              .select({ v: vehicleIssues.vehicleId })
              .from(vehicleIssues)
              .where(eq(vehicleIssues.id, pid("issue_id") as string))
              .limit(1),
          )
        )?.v
      : null) ??
    null;
  const vehicle = vehicleId
    ? await one(
        exec.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1),
      )
    : null;
  const toolId = eid("tool") ?? pid("tool_id");
  const tool = toolId
    ? await one(exec.select().from(tools).where(eq(tools.id, toolId)).limit(1))
    : null;

  const subjectId = subjectUserIdOf(ref.event?.type ?? "", payload);
  const [user, subject] = await Promise.all([
    ref.userId
      ? one(
          exec
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              phone: users.phone,
              role: users.role,
            })
            .from(users)
            .where(eq(users.id, ref.userId))
            .limit(1),
        )
      : null,
    subjectId
      ? one(
          exec
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.id, subjectId))
            .limit(1),
        )
      : null,
  ]);

  const collector = payment?.collectedByUserId
    ? await one(
        exec
          .select({ name: users.name, baseRole: roles.baseRole })
          .from(users)
          .innerJoin(roles, eq(roles.key, users.role))
          .where(eq(users.id, payment.collectedByUserId))
          .limit(1),
      )
    : null;

  // Last completed job (maintenance reminders, "history" variables).
  const lastJobRow = customerId
    ? await one(
        exec
          .select({
            completedAt: jobs.completedAt,
            service: serviceTypes.name,
            title: jobs.title,
          })
          .from(jobs)
          .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
          .where(
            and(
              eq(jobs.customerId, customerId),
              inArray(jobs.status, ["completed", "closed"]),
            ),
          )
          .orderBy(desc(jobs.completedAt))
          .limit(1),
      )
    : null;

  const tz = safeTimeZone(companyRow.timezone);
  return {
    settings,
    company: {
      name: settings.branding.app_name || companyRow.name,
      phone: companyRow.phone,
      email: companyRow.email,
      website: companyRow.website,
      timezone: tz,
      address: addressLine(companyRow.address),
    },
    tz,
    customer,
    customerTags,
    property,
    job,
    assignees: assigneeRows.map((a) => ({
      userId: a.userId,
      role: a.role,
      name: a.name,
    })),
    tech: primary
      ? { id: primary.userId, name: primary.name, licenseNumbers: primary.lic }
      : null,
    serviceType,
    lead,
    estimate: estimateFull,
    invoice: invoiceFull,
    payment: payment ?? pay ?? null,
    collector,
    deposit,
    refund,
    dispute,
    review,
    vehicle,
    tool,
    task,
    user,
    subjectUser: subject,
    lastJob: lastJobRow
      ? {
          service: lastJobRow.service ?? lastJobRow.title,
          completedAt: lastJobRow.completedAt,
        }
      : null,
    event: ref.event ?? null,
    entity,
  };
}

/** The user an event is "about" (settlement owner, purchaser, task assignee, cash holder…). */
export function subjectUserIdOf(
  type: string,
  p: Record<string, unknown>,
): string | null {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  if (type.startsWith("task.")) return s("assignee_user_id");
  if (type.startsWith("part_purchase.")) return s("purchaser_user_id");
  if (type.startsWith("review.")) return s("tech_user_id");
  return (
    s("user_id") ??
    s("purchaser_user_id") ??
    s("assignee_user_id") ??
    s("tech_user_id")
  );
}

// ------------------------------------------------------------------ formatting

/** GSM-safe "1 PM" / "1:30 PM". */
export function fmtClock(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ap = p.hour < 12 ? "AM" : "PM";
  return p.minute
    ? `${h12}:${String(p.minute).padStart(2, "0")} ${ap}`
    : `${h12} ${ap}`;
}

/** "1-3 PM", "11 AM-1 PM", or a single time. GSM-7 only. */
export function fmtWindow(
  start: Date | null,
  end: Date | null,
  tz: string,
): string {
  if (!start) return "";
  if (!end || end.getTime() === start.getTime()) return fmtClock(start, tz);
  const a = fmtClock(start, tz);
  const b = fmtClock(end, tz);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return sameHalf ? `${a.slice(0, -3)}-${b}` : `${a}-${b}`;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MON_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Tue Oct 14" */
export function fmtDateShort(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${DOW[p.weekday]} ${MON[p.month - 1]} ${p.day}`;
}
/** "Tuesday, October 14" */
export function fmtDateLong(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${DOW_LONG[p.weekday]}, ${MON_LONG[p.month - 1]} ${p.day}`;
}

const money = (c: number | null | undefined) =>
  c == null ? "" : formatMoney(c, {});

function firstWord(s: string | null | undefined): string {
  return (s ?? "").trim().split(/\s+/)[0] ?? "";
}

function methodLabel(p: Row<typeof payments>): string {
  switch (p.method) {
    case "card": {
      const brand = p.cardBrand
        ? p.cardBrand.charAt(0).toUpperCase() + p.cardBrand.slice(1)
        : "card";
      const last4 = (p as { cardLast4?: string | null }).cardLast4;
      return last4 ? `${brand} ending ${last4}` : brand;
    }
    case "ach":
      return "bank transfer";
    case "zelle":
      return "Zelle";
    case "venmo":
      return "Venmo";
    default:
      return p.method;
  }
}

/** Entity deep link (BUILD_PLAN Appendix A). */
export function entityUrl(
  e: EntityRef | null | undefined,
  f?: Partial<Facts>,
): string {
  if (!e) return "/notifications";
  switch (e.type) {
    case "job":
      return `/jobs/${e.id}`;
    case "lead":
      return `/leads/${e.id}`;
    case "customer":
      return `/customers/${e.id}`;
    case "estimate":
      return `/estimates/${e.id}`;
    case "change_order":
      return `/estimates/co/${e.id}`;
    case "invoice":
      return `/invoices/${e.id}`;
    case "payment":
      return f?.job ? `/jobs/${f.job.id}?tab=invoice` : "/payments";
    case "refund":
      return "/payments?tab=refunds";
    case "deposit_request":
      return f?.job ? `/jobs/${f.job.id}?tab=invoice` : "/payments";
    case "dispute":
      return `/disputes/${e.id}`;
    case "vehicle":
      return `/vehicles/${e.id}`;
    case "vehicle_issue":
    case "document":
    case "odometer":
    case "fuel":
    case "service":
    case "inspection":
    case "trip":
      return f?.vehicle ? `/vehicles/${f.vehicle.id}` : "/vehicles/approvals";
    case "tool":
      return `/tools/${e.id}`;
    case "tool_audit":
      return `/tools/audits/${e.id}`;
    case "tool_incident":
      return "/tools";
    case "part_purchase":
      return "/approvals?kind=part_purchase";
    case "approval":
      return "/approvals";
    case "settlement":
      return `/pay/statements/${e.id}`;
    case "task":
      return "/tasks";
    case "review_request":
      return "/reviews";
    case "message":
    case "scheduled_message":
      return f?.customer ? `/messages/${f.customer.id}` : "/messages";
    case "user":
      return `/team/${e.id}`;
    case "cash_remittance":
      return "/pay";
    default:
      return "/notifications";
  }
}

/** Variable groups a template needs → which tokens to mint. */
function needs(vars: Set<string> | null, ...keys: string[]): boolean {
  if (!vars) return true;
  return keys.some((k) => vars.has(k));
}

export interface BuildOptions {
  /** Paths referenced by the template (null = everything). */
  variables?: Set<string> | null;
  /** Mint real magic links (false = preview placeholders). */
  mint?: boolean;
  /** Recipient time zone for dates/times (default company zone). */
  timeZone?: string;
  /** Extra pre-formatted variables (eta_minutes, count …). */
  vars?: Record<string, string> | null;
}

const PREVIEW_LINK = (kind: string) => appUrl(`/${kind}/preview-link`);

/**
 * Flat template context: every §7.4 variable as a string. Must run inside the caller's
 * transaction when `mint` is true (tokens are inserted).
 */
export async function buildTemplateContext(
  tx: Tx,
  f: Facts,
  o: BuildOptions = {},
): Promise<TemplateContext> {
  const tz = safeTimeZone(o.timeZone ?? f.tz);
  const v = o.variables ?? null;
  const mint = o.mint ?? false;
  const ctx: Record<string, string> = { _tz: tz };
  const set = (k: string, val: unknown) => {
    if (val === null || val === undefined) return;
    const s = String(val);
    if (s !== "") ctx[k] = s;
  };
  const s = f.settings;

  // company
  set("company.name", f.company.name);
  // Settings → Messaging "Reply phone shown in texts" wins over the company line;
  // always shown formatted, never raw E.164.
  set(
    "company.phone",
    formatPhoneDisplay(s.messaging.reply_phone || f.company.phone),
  );
  set("company.email", f.company.email);
  set("company.website", f.company.website);
  set("company.address_short", f.company.address);
  set("company.lead_response_minutes", s.company.lead_response_minutes);
  set(
    "company.license",
    s.company.license_numbers
      .map((l) => `${l.state} ${l.trade} #${l.number}`)
      .join(", "),
  );
  set("company.review_link", safeHttpsUrl(s.reviews.google_url));
  ctx["company.emergency_line"] = s.company.emergency_phone
    ? ` Emergency? Call ${formatPhoneDisplay(s.company.emergency_phone)}.`
    : "";

  // customer
  const c = f.customer;
  if (c) {
    set("customer.first_name", c.firstName ?? firstWord(c.displayName));
    set("customer.last_name", c.lastName);
    set("customer.display_name", c.displayName);
    set("customer.company_name", c.companyName);
  } else if (f.lead?.name) {
    set("customer.first_name", firstWord(f.lead.name));
    set("customer.display_name", f.lead.name);
  }

  // lead
  if (f.lead) {
    set("lead.service", f.lead.serviceText ?? f.serviceType?.name);
    set("lead.preferred_date", f.lead.preferredDate);
    set("lead.source", f.lead.sourceName);
    set("lead.name", f.lead.name ?? c?.displayName);
    const mins =
      (f.event?.payload?.minutes as number | undefined) ??
      Math.max(
        0,
        Math.round((Date.now() - f.lead.createdAt.getTime()) / 60_000),
      );
    set("lead.sla_minutes", mins);
  }

  // job
  const j = f.job;
  if (j) {
    const when = j.windowStart ?? j.scheduledStart;
    set("job.number", j.number);
    set("job.service", f.serviceType?.name ?? j.title);
    if (when) {
      set("job.date_short", fmtDateShort(when, tz));
      set("job.date_long", fmtDateLong(when, tz));
      set("job.time", fmtClock(when, tz));
      set(
        "job.window",
        fmtWindow(
          j.windowStart ?? j.scheduledStart,
          j.windowEnd ?? j.scheduledEnd,
          tz,
        ),
      );
    }
    if (j.windowEnd) set("job.window_end_time", fmtClock(j.windowEnd, tz));
    if (f.property) {
      const unit = f.property.unit ? ` ${f.property.unit}` : "";
      set("job.address_short", `${f.property.street}${unit}`);
      set(
        "job.address_full",
        `${f.property.street}${unit}, ${f.property.city}, ${f.property.state} ${f.property.zip}`,
      );
    }
    set("job.status_label", statusDef("job", j.status).label);
    const fee = s.jobs.service_call_fee_cents;
    const feeLine =
      j.serviceFeeDisclosure ??
      (fee
        ? `Service call fee ${money(fee)}${s.jobs.service_call_fee_credited ? ", credited if you approve the repair" : ""}.`
        : "");
    ctx["job.service_fee_line"] = feeLine;
    ctx["job.cancel_fee_line"] = "";
    if (needs(v, "job.link"))
      set(
        "job.link",
        mint
          ? (
              await mintPublicToken(tx, {
                kind: "job",
                entity: { type: "job", id: j.id },
                customerId: j.customerId,
                jobId: j.id,
                expiresAt: new Date(
                  Math.max(
                    Date.now(),
                    (j.completedAt ?? j.windowEnd ?? new Date()).getTime(),
                  ) + TOKEN_TTL.job,
                ),
              })
            ).url
          : PREVIEW_LINK("j"),
      );
    if (needs(v, "tracking.link"))
      set(
        "tracking.link",
        mint
          ? (
              await mintPublicToken(tx, {
                kind: "tracking",
                entity: { type: "job", id: j.id },
                customerId: j.customerId,
                jobId: j.id,
              })
            ).url
          : PREVIEW_LINK("t"),
      );
    if (j.etaAt) set("eta_time", fmtClock(j.etaAt, tz));
  }

  // tech
  if (f.tech) {
    set("tech.first_name", firstWord(f.tech.name));
    const lic = Array.isArray(f.tech.licenseNumbers)
      ? (f.tech.licenseNumbers as { state?: string; number?: string }[])
          .map((l) => `${l.state ?? ""} #${l.number ?? ""}`.trim())
          .join(", ")
      : "";
    set("tech.license", lic);
  }

  // estimate
  const e = f.estimate;
  if (e) {
    set("estimate.number", e.number);
    set("estimate.total", money(e.totalCents));
    if (e.expiresAt)
      set("estimate.expires_date", fmtDateShort(e.expiresAt, tz));
    if (needs(v, "estimate.link"))
      set(
        "estimate.link",
        mint
          ? (
              await mintPublicToken(tx, {
                kind: "estimate",
                entity: { type: "estimate", id: e.id },
                customerId: e.customerId,
                jobId: e.jobId,
                expiresAt:
                  e.expiresAt && e.expiresAt > new Date()
                    ? e.expiresAt
                    : undefined,
              })
            ).url
          : PREVIEW_LINK("e"),
      );
  }
  if (f.entity?.type === "change_order" && needs(v, "change_order.link"))
    set(
      "change_order.link",
      mint
        ? (
            await mintPublicToken(tx, {
              kind: "estimate",
              entity: { type: "change_order", id: f.entity.id },
              customerId: c?.id ?? null,
              jobId: j?.id ?? null,
            })
          ).url
        : PREVIEW_LINK("e"),
    );

  // invoice
  const inv = f.invoice;
  if (inv) {
    set("invoice.number", inv.number);
    set("invoice.total", money(inv.totalCents));
    set("invoice.balance", money(inv.balanceCents));
    if (inv.dueAt) set("invoice.due_date", fmtDateShort(inv.dueAt, tz));
    if (needs(v, "invoice.link", "receipt.link")) {
      const url = mint
        ? (
            await mintPublicToken(tx, {
              kind: "invoice",
              entity: { type: "invoice", id: inv.id },
              customerId: inv.customerId,
              jobId: inv.jobId,
            })
          ).url
        : PREVIEW_LINK("i");
      set("invoice.link", url);
      if (f.payment) set("receipt.link", `${url}?receipt=${f.payment.id}`);
    }
    if (needs(v, "invoice.pay_link"))
      set(
        "invoice.pay_link",
        mint
          ? (
              await mintPublicToken(tx, {
                kind: "pay",
                entity: { type: "invoice", id: inv.id },
                customerId: inv.customerId,
                jobId: inv.jobId,
              })
            ).url
          : PREVIEW_LINK("p"),
      );
  }

  // payment
  const p = f.payment;
  if (p) {
    set("payment.amount", money(p.amountCents + p.tipCents));
    set("payment.method", methodLabel(p));
    const at = p.succeededAt ?? p.createdAt;
    set("payment.date", fmtDateShort(at, tz));
    // " to Mike" names the field tech who took cash or a check; money taken at the
    // office counter reads as paid to the company (no name).
    ctx["payment.collected_by_line"] =
      (p.method === "cash" || p.method === "check") &&
      f.collector?.baseRole === "tech"
        ? ` to ${firstWord(f.collector.name)}`
        : "";
    if (!ctx["receipt.link"] && needs(v, "receipt.link") && j)
      set(
        "receipt.link",
        ctx["job.link"] ??
          (mint
            ? (
                await mintPublicToken(tx, {
                  kind: "job",
                  entity: { type: "job", id: j.id },
                  customerId: j.customerId,
                  jobId: j.id,
                })
              ).url
            : PREVIEW_LINK("j")),
      );
  }

  // deposit
  const d = f.deposit;
  if (d) {
    set("deposit.amount", money(d.amountCents));
    const hrs = s.deposits.refundable_until_hours;
    set(
      "deposit.policy_short",
      `Credited to your invoice${hrs > 0 ? `; refundable if you cancel ${hrs} h or more before your window` : ""}.`,
    );
    if (needs(v, "deposit.link"))
      set(
        "deposit.link",
        mint
          ? (
              await mintPublicToken(tx, {
                kind: "pay",
                entity: { type: "deposit_request", id: d.id },
                customerId: c?.id ?? null,
                jobId: d.jobId,
              })
            ).url
          : PREVIEW_LINK("p"),
      );
    const cb = f.payment?.captureBefore;
    if (cb) set("deposit.capture_before", fmtDateShort(cb, tz));
  }

  // refund / dispute
  if (f.refund) {
    set("refund.amount", money(f.refund.amountCents));
    set(
      "refund.date",
      fmtDateShort(f.refund.completedAt ?? f.refund.createdAt, tz),
    );
  }
  if (f.dispute) {
    set("dispute.amount", money(f.dispute.amountCents));
    if (f.dispute.dueBy)
      set("dispute.due_date", fmtDateShort(f.dispute.dueBy, tz));
  }

  // review
  if (needs(v, "review.link") && j && c) {
    set(
      "review.link",
      mint ? await ensureReviewLink(tx, j, f) : PREVIEW_LINK("r"),
    );
  }
  if (f.review?.wantsCallback)
    ctx["review.callback_line"] = " They asked for a call back.";
  else ctx["review.callback_line"] = "";

  // booking
  if (needs(v, "booking.link")) {
    let link: string | null = null;
    try {
      link = await getDefaultBookingLink();
    } catch {
      link = null;
    }
    set("booking.link", link ?? f.company.website ?? appUrl("/"));
  }

  // history
  if (f.lastJob) {
    set("last_job.service", f.lastJob.service);
    if (f.lastJob.completedAt) {
      set("last_job.date_short", fmtDateShort(f.lastJob.completedAt, tz));
      const months = Math.max(
        1,
        Math.round(
          (Date.now() - f.lastJob.completedAt.getTime()) / (30.44 * 86_400_000),
        ),
      );
      set("months_since_last_job", months);
    }
  }

  // staff-only
  if (f.user) {
    set("user.first_name", firstWord(f.user.name));
    set("user.name", f.user.name);
  }
  if (f.subjectUser) set("user.name", f.subjectUser.name);
  if (f.vehicle) set("vehicle.nickname", f.vehicle.nickname);
  if (f.tool) set("tool.name", f.tool.name);
  if (f.task) {
    set("task", f.task.title);
    set("task_body", f.task.body);
  }
  set("entity.url", appUrl(entityUrl(f.entity, f)));

  // event-derived extras
  Object.assign(ctx, eventVars(f, tz));
  // caller extras win
  for (const [k, val] of Object.entries(o.vars ?? {}))
    if (val !== "") ctx[k] = val;
  return ctx;
}

/** Variables computed from the triggering event payload. */
function eventVars(f: Facts, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  const ev = f.event;
  if (!ev) return out;
  const p = ev.payload ?? {};
  const num = (k: string) =>
    typeof p[k] === "number" ? (p[k] as number) : null;
  const str = (k: string) =>
    typeof p[k] === "string" ? (p[k] as string) : null;
  const type = ev.type as EventType | string;
  if (num("eta_minutes") !== null) out.eta_minutes = String(num("eta_minutes"));
  if (num("new_eta_minutes") !== null)
    out.eta_minutes = String(num("new_eta_minutes"));
  if (num("rating") !== null) out.rating = String(num("rating"));
  if (num("days") !== null) out.days = String(num("days"));
  if (num("oldest_days") !== null) out.days = String(num("oldest_days"));
  if (num("held_cents") !== null) out.amount = money(num("held_cents"));
  if (num("amount_cents") !== null && !out.amount)
    out.amount = money(num("amount_cents"));
  if (num("total_cents") !== null && !out.amount)
    out.amount = money(num("total_cents"));
  if (num("declared_cents") !== null) out.amount = money(num("declared_cents"));
  if (num("system_cents") !== null)
    out.system_amount = money(num("system_cents"));
  if (str("last4")) out.last4 = str("last4") as string;
  if (str("error")) out.error = (str("error") as string).slice(0, 80);
  if (str("severity")) out.severity = str("severity") as string;
  if (str("task") && type.startsWith("vehicle."))
    out.task = str("task") as string;
  if (str("task") && type.startsWith("tool.")) out.task = str("task") as string;
  if (str("due_on")) out.due_date = str("due_on") as string;
  if (str("kind") && type === "tool.incident") out.kind = str("kind") as string;
  if (type === "job.start_approved") out.decision = "approved";
  if (type === "job.start_denied") out.decision = "denied";
  if (type === "part_purchase.approved") out.decision = "approved";
  if (type === "part_purchase.rejected") out.decision = "rejected";
  if (type === "message.optout_detected" || type === "message.received")
    out.reply = (str("body") ?? "").slice(0, 60);
  if (type === "vehicle.issue_reported") {
    out.issue = "see details";
  }
  if (str("date") && type === "digest.daily")
    out["digest.date"] = str("date") as string;
  void tz;
  return out;
}

/**
 * Ensure the job's review_requests row and a live `review` token; returns `/r/<token>`.
 * The row's token_id points at the newest token (clicks are logged against it).
 */
async function ensureReviewLink(
  tx: Tx,
  job: Row<typeof jobs>,
  f: Facts,
): Promise<string> {
  const minted = await mintPublicToken(tx, {
    kind: "review",
    entity: { type: "job", id: job.id },
    customerId: job.customerId,
    jobId: job.id,
  });
  await tx
    .insert(reviewRequests)
    .values({
      jobId: job.id,
      customerId: job.customerId,
      techUserId: f.tech?.id ?? null,
      tokenId: minted.tokenId,
    })
    .onConflictDoUpdate({
      target: reviewRequests.jobId,
      set: { tokenId: minted.tokenId },
    });
  return minted.url;
}

// ------------------------------------------------------------------ conditions

/** Structured object for automation conditions (`job.status`, `customer.tags`, `event.*` …). */
export function conditionContext(f: Facts): Record<string, unknown> {
  const j = f.job;
  return {
    event: f.event?.payload ?? {},
    job: j
      ? {
          id: j.id,
          status: j.status,
          payment_status: j.paymentStatus,
          service_type_id: j.serviceTypeId,
          priority: j.priority,
          after_hours: j.afterHours,
          is_callback: j.isCallback,
          visit_count: j.visitCount,
          risk_band: j.riskBand,
          assignees: f.assignees.map((a) => a.userId),
          has_window: !!j.windowStart,
        }
      : null,
    customer: f.customer
      ? {
          id: f.customer.id,
          type: f.customer.type,
          sms_status: f.customer.smsStatus,
          vip: f.customer.vip,
          tags: f.customerTags,
          is_test: f.customer.isTest,
          preferred_channel: f.customer.preferredChannel,
          do_not_text: f.customer.doNotText,
        }
      : null,
    lead: f.lead
      ? {
          status: f.lead.status,
          reached: f.lead.reached,
          source: f.lead.sourceName,
          is_returning: f.lead.isReturning,
          spam_score: f.lead.spamScore,
        }
      : null,
    estimate: f.estimate
      ? { status: f.estimate.status, total_cents: f.estimate.totalCents }
      : null,
    invoice: f.invoice
      ? {
          status: f.invoice.status,
          total_cents: f.invoice.totalCents,
          balance_cents: f.invoice.balanceCents,
        }
      : null,
    payment: f.payment
      ? {
          method: f.payment.method,
          kind: f.payment.kind,
          amount_cents: f.payment.amountCents,
        }
      : null,
    service_type: f.serviceType
      ? {
          id: f.serviceType.id,
          name: f.serviceType.name,
          maintenance_interval_months: f.serviceType.maintenanceIntervalMonths,
        }
      : null,
    property: f.property
      ? { zip: f.property.zip, city: f.property.city, state: f.property.state }
      : null,
  };
}

// ------------------------------------------------------------------ preview / misc

/** Live-preview sample job for the template editor ("Preview with a real job"). */
export async function latestJobIdForPreview(): Promise<string | null> {
  const row = await one(
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        inArray(jobs.status, ["scheduled", "confirmed", "completed", "closed"]),
      )
      .orderBy(desc(jobs.updatedAt))
      .limit(1),
  );
  return row?.id ?? null;
}

/** Today's agenda facts for a tech (daily agenda push). */
export async function techAgenda(userId: string, now: Date, tz: string) {
  const key = dateKey(now, tz);
  const next = addDaysToKey(key, 1);
  const rows = await db
    .select({
      windowStart: jobs.windowStart,
      street: properties.street,
    })
    .from(jobs)
    .innerJoin(jobAssignments, eq(jobAssignments.jobId, jobs.id))
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .where(
      and(
        eq(jobAssignments.userId, userId),
        inArray(jobs.status, ["scheduled", "confirmed"]),
        sql`${jobs.windowStart} >= (${key}::date::timestamp at time zone ${tz})`,
        sql`${jobs.windowStart} < (${next}::date::timestamp at time zone ${tz})`,
      ),
    )
    .orderBy(asc(jobs.windowStart));
  const first = rows[0];
  return {
    count: rows.length,
    firstTime: first?.windowStart ? fmtClock(first.windowStart, tz) : "",
    firstAddress: first?.street ?? "",
  };
}

/** Settlement period label ("Oct 5-11") for settlement templates. */
export async function settlementPeriodLabel(
  settlementId: string,
): Promise<string | null> {
  const row = await one(
    db
      .select({ startsOn: payPeriods.startsOn, endsOn: payPeriods.endsOn })
      .from(settlements)
      .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
      .where(eq(settlements.id, settlementId))
      .limit(1),
  );
  if (!row) return null;
  return `${row.startsOn} to ${row.endsOn}`;
}

/** Purchase total for reimbursement templates. */
export async function partPurchaseAmount(id: string): Promise<number | null> {
  const row = await one(
    db
      .select({ t: partPurchases.totalCents })
      .from(partPurchases)
      .where(eq(partPurchases.id, id))
      .limit(1),
  );
  return row?.t ?? null;
}

/** Tool incident's tool (incident → tool name). */
export async function toolForIncident(id: string): Promise<string | null> {
  const row = await one(
    db
      .select({ name: tools.name })
      .from(toolIncidents)
      .innerJoin(tools, eq(tools.id, toolIncidents.toolId))
      .where(eq(toolIncidents.id, id))
      .limit(1),
  );
  return row?.name ?? null;
}
