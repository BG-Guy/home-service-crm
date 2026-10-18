import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { customers, disputes, payments } from "@/db/schema";
import { setCustomerFlags } from "@/features/customers/api";
import { lockEvidenceMedia } from "@/features/media/api";
import { recomputeJobPaymentStatus } from "@/features/payments/internal";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { enqueueJob } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import type { Actor } from "@/lib/types";
import {
  defaultEvidenceFiles,
  loadEvidencePack,
  narrativeFactsFromPack,
} from "./evidence";
import {
  buildEvidenceText,
  DISPUTE_CATEGORY_LABELS,
  type DisputeCategory,
} from "./narrative";

// Dispute lifecycle writes shared by the Stripe webhook (payments/provider-events.ts)
// and the demo seed. Runs inside the caller's transaction.

const WEBHOOK_ACTOR: Actor = { kind: "webhook", userId: null };

export interface OpenDisputeInput {
  payment: typeof payments.$inferSelect;
  providerRef: string;
  provider: string;
  category: string;
  networkReasonCode: string | null;
  amountCents: number;
  status: string;
  dueBy: Date | null;
  actor?: Actor;
  /** Seeds pass a fixed readiness snapshot; otherwise it's computed now. */
  readinessAtOpen?: number | null;
  /** Seeds never emit events (BUILD_PLAN §10.1). */
  emitEvents?: boolean;
  id?: string;
}

/**
 * charge.dispute.created → disputes row with evidence JSON + template narrative,
 * customer flagged dispute_history (B1), payment + job marked disputed, evidence media
 * locked, `evidence_pack` job queued, dispute.created emitted (B6 holds commission).
 */
export async function openDisputeInTx(
  tx: Tx,
  i: OpenDisputeInput,
): Promise<{ disputeId: string }> {
  const actor = i.actor ?? WEBHOOK_ACTOR;
  const settings = await getSettings();
  const category = i.category as DisputeCategory;
  const pack = i.payment.jobId ? await loadEvidencePack(i.payment.jobId) : null;
  const evidence = pack
    ? buildEvidenceText(category, narrativeFactsFromPack(pack, i.payment.id))
    : {};
  const files = pack ? defaultEvidenceFiles(pack, category) : {};
  const [row] = await tx
    .insert(disputes)
    .values({
      ...(i.id ? { id: i.id } : {}),
      paymentId: i.payment.id,
      provider: i.provider,
      providerRef: i.providerRef,
      category,
      networkReasonCode: i.networkReasonCode,
      amountCents: i.amountCents,
      status: i.status,
      dueBy: i.dueBy,
      evidence: evidence as Record<string, unknown>,
      evidenceFiles: files,
      narrative: evidence.uncategorized_text ?? null,
      readinessAtOpen:
        i.readinessAtOpen !== undefined
          ? i.readinessAtOpen
          : (pack?.readiness?.score ?? null),
      feeCents: settings.disputes.dispute_fee_cents,
    })
    .onConflictDoNothing({ target: disputes.providerRef })
    .returning({ id: disputes.id });
  if (!row) {
    const [cur] = await tx
      .select({ id: disputes.id })
      .from(disputes)
      .where(eq(disputes.providerRef, i.providerRef))
      .limit(1);
    return { disputeId: cur?.id ?? "" };
  }
  await tx
    .update(payments)
    .set({ status: "disputed", updatedAt: new Date() })
    .where(eq(payments.id, i.payment.id));
  const [cust] = await tx
    .select({ flagged: customers.disputeHistory })
    .from(customers)
    .where(eq(customers.id, i.payment.customerId))
    .limit(1);
  if (!cust?.flagged)
    await setCustomerFlags(
      tx,
      i.payment.customerId,
      { disputeHistory: true },
      actor,
      `Card dispute opened (${DISPUTE_CATEGORY_LABELS[category] ?? category})`,
    );
  if (i.payment.jobId) await recomputeJobPaymentStatus(tx, i.payment.jobId);
  if (pack) {
    await lockEvidenceMedia(tx, [
      ...pack.photos.before.map((p) => p.id),
      ...pack.photos.after.map((p) => p.id),
      ...pack.photos.other.map((p) => p.id),
      ...pack.signatures.map((s) => s.mediaId).filter((x): x is string => !!x),
    ]);
  }
  if (i.emitEvents === false) return { disputeId: row.id };
  await enqueueJob(
    tx,
    "evidence_pack",
    { disputeId: row.id },
    { dedupeKey: `evidence_pack:${row.id}` },
  );
  await emit(
    tx,
    "dispute.created",
    { type: "dispute", id: row.id },
    {
      dispute_id: row.id,
      payment_id: i.payment.id,
      category,
      due_by: i.dueBy?.toISOString() ?? null,
      job_id: i.payment.jobId,
      amount_cents: i.amountCents,
      customer_id: i.payment.customerId,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity: i.payment.jobId
      ? { type: "job", id: i.payment.jobId }
      : { type: "customer", id: i.payment.customerId },
    customerId: i.payment.customerId,
    jobId: i.payment.jobId,
    kind: "dispute.created",
    summary: `Card dispute: ${formatMoney(i.amountCents)} (${DISPUTE_CATEGORY_LABELS[category] ?? category})`,
    data: { dispute_id: row.id },
    actorUserId: actor.userId,
  });
  return { disputeId: row.id };
}

/** Rebuild the auto evidence for a dispute (keeps fields the admin edited). */
export async function refreshDisputeEvidence(
  tx: Tx,
  disputeId: string,
  opts: { overwrite?: boolean } = {},
): Promise<void> {
  const [d] = await tx
    .select({ d: disputes, p: payments })
    .from(disputes)
    .innerJoin(payments, eq(payments.id, disputes.paymentId))
    .where(eq(disputes.id, disputeId))
    .limit(1);
  if (!d?.p.jobId) return;
  const pack = await loadEvidencePack(d.p.jobId);
  if (!pack) return;
  const auto = buildEvidenceText(
    d.d.category as DisputeCategory,
    narrativeFactsFromPack(pack, d.p.id),
  ) as Record<string, unknown>;
  const cur = (d.d.evidence ?? {}) as Record<string, unknown>;
  const merged = opts.overwrite ? auto : { ...auto, ...cur };
  const files = {
    ...defaultEvidenceFiles(pack, d.d.category as DisputeCategory),
    ...(opts.overwrite ? {} : d.d.evidenceFiles),
  };
  await tx
    .update(disputes)
    .set({
      evidence: merged,
      evidenceFiles: files,
      narrative:
        opts.overwrite || !d.d.narrative
          ? ((auto.uncategorized_text as string | undefined) ?? d.d.narrative)
          : d.d.narrative,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId));
}
