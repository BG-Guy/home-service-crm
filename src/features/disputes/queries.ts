import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  customers,
  disputes,
  jobAssignments,
  jobs,
  leadSources,
  payments,
  serviceTypes,
  users,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";
import { DISPUTE_CATEGORY_LABELS, type DisputeCategory } from "./narrative";

// Read DAL for the disputes screens (disputes.view). Analytics per SPEC M10:
// dispute rate vs the 0.75 % line, by tech / service / source / entry mode / reason,
// and win rate by readiness band.

export const OPEN = ["inquiry", "needs_response", "under_review"] as const;
const CARD_PAID = ["succeeded", "partially_refunded", "refunded", "disputed"];

export interface DisputeListRow {
  id: string;
  status: string;
  category: string;
  categoryLabel: string;
  amountCents: number;
  dueBy: string | null;
  hoursLeft: number | null;
  customerName: string;
  customerId: string;
  jobId: string | null;
  jobNumber: string | null;
  readinessAtOpen: number | null;
  outcome: string | null;
  createdAt: string;
  submittedAt: string | null;
}

export const listDisputes = cache(
  async (
    filter: "open" | "closed" | "all" = "open",
  ): Promise<DisputeListRow[]> => {
    await requireUser("disputes.view");
    const conds =
      filter === "open"
        ? [inArray(disputes.status, [...OPEN])]
        : filter === "closed"
          ? [
              sql`${disputes.status} not in ('inquiry','needs_response','under_review')`,
            ]
          : [];
    const rows = await db
      .select({
        d: disputes,
        customerName: customers.displayName,
        customerId: customers.id,
        jobId: jobs.id,
        jobNumber: jobs.number,
      })
      .from(disputes)
      .innerJoin(payments, eq(payments.id, disputes.paymentId))
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .leftJoin(jobs, eq(jobs.id, payments.jobId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(
        filter === "open" ? asc(disputes.dueBy) : desc(disputes.createdAt),
      )
      .limit(200);
    const now = Date.now();
    return rows.map(({ d, ...r }) => ({
      id: d.id,
      status: d.status,
      category: d.category,
      categoryLabel:
        DISPUTE_CATEGORY_LABELS[d.category as DisputeCategory] ?? d.category,
      amountCents: d.amountCents,
      dueBy: d.dueBy?.toISOString() ?? null,
      hoursLeft: d.dueBy
        ? Math.round((d.dueBy.getTime() - now) / 3_600_000)
        : null,
      customerName: r.customerName,
      customerId: r.customerId,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      readinessAtOpen: d.readinessAtOpen,
      outcome: d.outcome,
      createdAt: d.createdAt.toISOString(),
      submittedAt: d.submittedAt?.toISOString() ?? null,
    }));
  },
);

export interface RateCell {
  key: string;
  label: string;
  payments: number;
  disputes: number;
  rateBps: number | null;
}

export interface DisputeAnalytics {
  windowDays: number;
  cardPayments: number;
  disputes: number;
  rateBps: number | null;
  thresholdBps: number;
  rate30Bps: number | null;
  byTech: RateCell[];
  byService: RateCell[];
  bySource: RateCell[];
  byEntryMode: RateCell[];
  byReason: { key: string; label: string; count: number }[];
  winByReadiness: {
    band: "red" | "amber" | "green" | "unknown";
    label: string;
    won: number;
    lost: number;
    winRate: number | null;
  }[];
}

const rate = (d: number, p: number) =>
  p > 0 ? Math.round((d / p) * 10_000) : null;

function cells(
  pays: { key: string; label: string; disputed: boolean }[],
): RateCell[] {
  const m = new Map<string, RateCell>();
  for (const p of pays) {
    const c = m.get(p.key) ?? {
      key: p.key,
      label: p.label,
      payments: 0,
      disputes: 0,
      rateBps: null,
    };
    c.payments += 1;
    if (p.disputed) c.disputes += 1;
    m.set(p.key, c);
  }
  return [...m.values()]
    .map((c) => ({ ...c, rateBps: rate(c.disputes, c.payments) }))
    .sort((a, b) => b.disputes - a.disputes || b.payments - a.payments);
}

const ENTRY_LABEL: Record<string, string> = {
  tap: "Tap",
  chip: "Chip",
  swipe: "Swipe",
  keyed: "Typed (keyed)",
  online: "Online link",
  wallet: "Wallet",
};

/** Trailing-window analytics over card payments (default 90 days). */
export const getDisputeAnalytics = cache(
  async (windowDays = 90): Promise<DisputeAnalytics> => {
    await requireUser("disputes.view");
    const s = await getSettings();
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const pays = await db
      .select({
        id: payments.id,
        at: payments.succeededAt,
        entryMode: payments.entryMode,
        jobId: payments.jobId,
        service: serviceTypes.name,
        serviceId: serviceTypes.id,
        source: leadSources.name,
        sourceId: leadSources.id,
      })
      .from(payments)
      .leftJoin(jobs, eq(jobs.id, payments.jobId))
      .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .leftJoin(leadSources, eq(leadSources.id, customers.leadSourceId))
      .where(
        and(
          eq(payments.method, "card"),
          inArray(payments.status, CARD_PAID),
          gte(payments.succeededAt, since),
        ),
      );
    const disp = await db
      .select({
        paymentId: disputes.paymentId,
        category: disputes.category,
        createdAt: disputes.createdAt,
        status: disputes.status,
        readiness: disputes.readinessAtOpen,
      })
      .from(disputes)
      .where(gte(disputes.createdAt, since));
    const disputed = new Set(disp.map((d) => d.paymentId));
    const jobIds = [
      ...new Set(pays.map((p) => p.jobId).filter(Boolean)),
    ] as string[];
    const techs = jobIds.length
      ? await db
          .select({
            jobId: jobAssignments.jobId,
            id: users.id,
            name: users.name,
          })
          .from(jobAssignments)
          .innerJoin(users, eq(users.id, jobAssignments.userId))
          .where(
            and(
              inArray(jobAssignments.jobId, jobIds),
              eq(jobAssignments.role, "primary"),
            ),
          )
      : [];
    const techOf = new Map(techs.map((t) => [t.jobId, t]));
    const enriched = pays.map((p) => {
      const t = p.jobId ? techOf.get(p.jobId) : undefined;
      return { ...p, tech: t, disputed: disputed.has(p.id) };
    });
    const pays30 = enriched.filter((p) => p.at && p.at >= since30);
    const disp30 = disp.filter((d) => d.createdAt >= since30);
    const reasons = new Map<string, number>();
    for (const d of disp)
      reasons.set(d.category, (reasons.get(d.category) ?? 0) + 1);
    const bands = [
      { band: "red" as const, label: "Under 50", test: (r: number) => r < 50 },
      {
        band: "amber" as const,
        label: "50–79",
        test: (r: number) => r >= 50 && r < 80,
      },
      { band: "green" as const, label: "80+", test: (r: number) => r >= 80 },
    ];
    // Win rate uses ALL closed disputes (outcomes are rare; the window would starve it).
    const closed = await db
      .select({ status: disputes.status, readiness: disputes.readinessAtOpen })
      .from(disputes)
      .where(inArray(disputes.status, ["won", "lost"]));
    return {
      windowDays,
      cardPayments: enriched.length,
      disputes: disp.length,
      rateBps: rate(disp.length, enriched.length),
      thresholdBps: s.disputes.rate_threshold_bps,
      rate30Bps: rate(disp30.length, pays30.length),
      byTech: cells(
        enriched.map((p) => ({
          key: p.tech?.id ?? "none",
          label: p.tech?.name ?? "Unassigned / online",
          disputed: p.disputed,
        })),
      ),
      byService: cells(
        enriched.map((p) => ({
          key: p.serviceId ?? "none",
          label: p.service ?? "No service type",
          disputed: p.disputed,
        })),
      ),
      bySource: cells(
        enriched.map((p) => ({
          key: p.sourceId ?? "none",
          label: p.source ?? "Unknown source",
          disputed: p.disputed,
        })),
      ),
      byEntryMode: cells(
        enriched.map((p) => ({
          key: p.entryMode ?? "unknown",
          label: ENTRY_LABEL[p.entryMode ?? ""] ?? "Unknown",
          disputed: p.disputed,
        })),
      ),
      byReason: [...reasons.entries()]
        .map(([key, count]) => ({
          key,
          label: DISPUTE_CATEGORY_LABELS[key as DisputeCategory] ?? key,
          count,
        }))
        .sort((a, b) => b.count - a.count),
      winByReadiness: [
        ...bands.map((b) => {
          const xs = closed.filter(
            (c) => c.readiness != null && b.test(c.readiness),
          );
          const won = xs.filter((x) => x.status === "won").length;
          const lost = xs.length - won;
          return {
            band: b.band,
            label: b.label,
            won,
            lost,
            winRate: xs.length ? won / xs.length : null,
          };
        }),
      ],
    };
  },
);

/** Dispute detail with the disputed payment, customer and job. */
export async function getDisputeDetail(id: string) {
  await requireUser("disputes.view");
  const [r] = await db
    .select({
      d: disputes,
      p: payments,
      customerName: customers.displayName,
      customerEmail: customers.email,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
      jobReadiness: jobs.readinessScore,
    })
    .from(disputes)
    .innerJoin(payments, eq(payments.id, disputes.paymentId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(jobs, eq(jobs.id, payments.jobId))
    .where(eq(disputes.id, id))
    .limit(1);
  return r ?? null;
}

export interface EfwRow {
  paymentId: string;
  amountCents: number;
  at: string;
  fraudType: string | null;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  disputed: boolean;
  refunded: boolean;
  suggestRefund: boolean;
}

/**
 * Early fraud warnings (Visa TC40 / MC SAFE via the processor) on card payments in the
 * last 60 days. A refund is suggested when the charge is no more than the dispute fee ×
 * `settings.disputes.efw_refund_multiplier` (SPEC M10): refunding is cheaper than losing.
 */
export const listEarlyFraudWarnings = cache(async (): Promise<EfwRow[]> => {
  await requireUser("disputes.view");
  const s = await getSettings();
  const rows = await db
    .select({
      p: payments,
      customerName: customers.displayName,
      jobNumber: jobs.number,
    })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(jobs, eq(jobs.id, payments.jobId))
    .where(
      and(
        sql`${payments.raw}->>'efw_at' is not null`,
        sql`(${payments.raw}->>'efw_at')::timestamptz > now() - interval '60 days'`,
      ),
    )
    .orderBy(desc(payments.updatedAt))
    .limit(50);
  const limit = s.disputes.dispute_fee_cents * s.disputes.efw_refund_multiplier;
  return rows.map(({ p, customerName, jobNumber }) => {
    const raw = (p.raw ?? {}) as Record<string, unknown>;
    const refunded = p.status === "refunded";
    const disputed = p.status === "disputed";
    return {
      paymentId: p.id,
      amountCents: p.amountCents + p.tipCents,
      at: String(raw.efw_at),
      fraudType:
        typeof raw.efw_fraud_type === "string" ? raw.efw_fraud_type : null,
      customerName,
      jobId: p.jobId,
      jobNumber,
      disputed,
      refunded,
      suggestRefund:
        !refunded && !disputed && p.amountCents + p.tipCents <= limit,
    };
  });
});
