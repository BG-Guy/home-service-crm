"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getPaymentProvider,
  hasCardProcessor,
  type NormalizedEvidence,
} from "@/adapters/payments";
import type { Tx } from "@/db";
import { disputes, media, payments } from "@/db/schema";
import { lockEvidenceMedia } from "@/features/media/api";
import { applyNormalizedEvent } from "@/features/payments/provider-events";
import { action, actionFailure } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import type { ActionResult } from "@/lib/types";
import { EVIDENCE_FILE_FIELDS, EVIDENCE_TEXT_FIELDS } from "./narrative";
import { refreshDisputeEvidence } from "./server";

// Dispute review mutations (SPEC M10): edit the template narrative and evidence fields,
// attach/remove files, regenerate from the job, Submit or Accept. Provider calls run
// OUTSIDE transactions; the result is applied in a short action() transaction.

const uuid = z.string().uuid();
const OPEN = ["inquiry", "needs_response", "under_review"];
const TEXT_KEYS = EVIDENCE_TEXT_FIELDS.map((f) => f.key) as [
  string,
  ...string[],
];
const FILE_KEYS = EVIDENCE_FILE_FIELDS.map((f) => f.key) as [
  string,
  ...string[],
];

async function load(tx: Tx, id: string) {
  const [r] = await tx
    .select({ d: disputes, p: payments })
    .from(disputes)
    .innerJoin(payments, eq(payments.id, disputes.paymentId))
    .where(eq(disputes.id, id))
    .limit(1);
  if (!r) throw new NotFoundError("Dispute");
  return r;
}

const paths = (id: string, jobId: string | null) => [
  "/disputes",
  `/disputes/${id}`,
  ...(jobId ? [`/jobs/${jobId}`, `/jobs/${jobId}/evidence`] : []),
];

/** Save the narrative and evidence text fields (never AI; template + admin edits). */
export const saveDisputeEvidence = action({
  perm: "disputes.manage",
  feature: "chargeback_protection",
  input: z.object({
    disputeId: uuid,
    narrative: z.string().trim().max(20_000),
    // Partial: the editor sends only the fields it shows (zod 4 records over an
    // enum are exhaustive, which made every save fail; T2-07).
    fields: z
      .partialRecord(z.enum(TEXT_KEYS), z.string().max(20_000))
      .default({}),
  }),
  audit: "dispute.evidence_saved",
  async run({ input, tx }) {
    const { d, p } = await load(tx, input.disputeId);
    if (!OPEN.includes(d.status) || d.submittedAt)
      throw new ConflictError(
        "dispute_locked",
        "This dispute was already submitted or closed.",
      );
    const evidence: Record<string, unknown> = { ...(d.evidence ?? {}) };
    for (const [k, v] of Object.entries(input.fields)) {
      if (typeof v !== "string") continue;
      if (v.trim()) evidence[k] = v.trim();
      else delete evidence[k];
    }
    evidence.uncategorized_text = input.narrative;
    await tx
      .update(disputes)
      .set({ evidence, narrative: input.narrative, updatedAt: new Date() })
      .where(eq(disputes.id, d.id));
    return { id: d.id, jobId: p.jobId };
  },
  auditEntity: ({ input }) => ({ type: "dispute", id: input.disputeId }),
  revalidate: ({ data }) => paths(data.id, data.jobId),
});

/** Attach (or remove, mediaId null) a file for one Stripe evidence slot. */
export const setEvidenceFile = action({
  perm: "disputes.manage",
  feature: "chargeback_protection",
  input: z.object({
    disputeId: uuid,
    field: z.enum(FILE_KEYS),
    mediaId: uuid.nullable(),
  }),
  audit: "dispute.evidence_file",
  async run({ input, tx }) {
    const { d, p } = await load(tx, input.disputeId);
    if (!OPEN.includes(d.status) || d.submittedAt)
      throw new ConflictError(
        "dispute_locked",
        "This dispute was already submitted or closed.",
      );
    const files = { ...(d.evidenceFiles ?? {}) };
    if (input.mediaId) {
      const [m] = await tx
        .select({
          id: media.id,
          jobId: media.jobId,
          customerId: media.customerId,
        })
        .from(media)
        .where(eq(media.id, input.mediaId))
        .limit(1);
      if (!m || (m.jobId !== p.jobId && m.customerId !== p.customerId))
        throw new NotFoundError("File");
      files[input.field] = { media_id: m.id };
      await lockEvidenceMedia(tx, [m.id]);
    } else delete files[input.field];
    await tx
      .update(disputes)
      .set({ evidenceFiles: files, updatedAt: new Date() })
      .where(eq(disputes.id, d.id));
    return { id: d.id, jobId: p.jobId };
  },
  auditEntity: ({ input }) => ({ type: "dispute", id: input.disputeId }),
  revalidate: ({ data }) => paths(data.id, data.jobId),
});

/** Rebuild the auto evidence + narrative from the job timeline (overwrites edits). */
export const regenerateEvidence = action({
  perm: "disputes.manage",
  feature: "chargeback_protection",
  input: z.object({ disputeId: uuid }),
  audit: "dispute.evidence_regenerated",
  async run({ input, tx }) {
    const { d, p } = await load(tx, input.disputeId);
    if (d.submittedAt)
      throw new ConflictError("dispute_locked", "Already submitted.");
    await refreshDisputeEvidence(tx, d.id, { overwrite: true });
    return { id: d.id, jobId: p.jobId };
  },
  auditEntity: ({ input }) => ({ type: "dispute", id: input.disputeId }),
  revalidate: ({ data }) => paths(data.id, data.jobId),
});

const markSubmitted = action({
  name: "disputes.markSubmitted",
  perm: "disputes.manage",
  input: z.object({ disputeId: uuid, via: z.enum(["api", "dashboard"]) }),
  audit: "dispute.evidence_submitted",
  async run({ input, tx, emit, activity }) {
    const { d, p } = await load(tx, input.disputeId);
    if (d.submittedAt) return { id: d.id, jobId: p.jobId };
    const now = new Date();
    await tx
      .update(disputes)
      .set({
        submittedAt: now,
        stagedAt: d.stagedAt ?? now,
        status: d.status === "needs_response" ? "under_review" : d.status,
        updatedAt: now,
      })
      .where(eq(disputes.id, d.id));
    await emit(
      "dispute.evidence_submitted",
      { type: "dispute", id: d.id },
      { dispute_id: d.id },
    );
    await activity({
      entity: p.jobId
        ? { type: "job", id: p.jobId }
        : { type: "customer", id: p.customerId },
      jobId: p.jobId,
      customerId: p.customerId,
      kind: "dispute.evidence_submitted",
      summary:
        input.via === "api"
          ? "Dispute evidence submitted to the processor"
          : "Dispute evidence submitted in the processor dashboard",
      data: { dispute_id: d.id },
    });
    return { id: d.id, jobId: p.jobId };
  },
  auditEntity: ({ input }) => ({ type: "dispute", id: input.disputeId }),
  revalidate: ({ data }) => paths(data.id, data.jobId),
});

function textEvidence(e: Record<string, unknown>): NormalizedEvidence {
  const out: Record<string, string> = {};
  for (const k of TEXT_KEYS) {
    const v = e[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out as NormalizedEvidence;
}

/**
 * Submit the evidence. With a card processor that supports the disputes API the text
 * evidence is staged (submit=false) then submitted; otherwise `manual` records that the
 * admin pasted it into the processor dashboard from the copy panel.
 */
export async function submitDispute(input: {
  disputeId: string;
  manual?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser("disputes.manage");
    const id = uuid.parse(input.disputeId);
    const { db } = await import("@/db");
    const { d } = await load(db, id);
    if (!OPEN.includes(d.status))
      throw new ConflictError("dispute_closed", "This dispute is closed.");
    if (d.submittedAt)
      throw new ConflictError("dispute_locked", "Already submitted.");
    let via: "api" | "dashboard" = "dashboard";
    if (!input.manual) {
      const provider =
        d.provider === "stripe" && hasCardProcessor()
          ? getPaymentProvider("stripe")
          : null;
      if (!provider?.disputes)
        throw new ConflictError(
          "no_disputes_api",
          "No processor connection: paste the evidence in your processor dashboard, then tap “I submitted it”.",
        );
      await provider.disputes.stage(d.providerRef, textEvidence(d.evidence));
      await provider.disputes.submit(d.providerRef);
      via = "api";
    }
    const r = await markSubmitted({ disputeId: id, via });
    if (!r.ok) return r;
    return { ok: true, data: { id } };
  } catch (e) {
    return actionFailure(e);
  }
}

const markAccepted = action({
  name: "disputes.markAccepted",
  perm: "disputes.manage",
  input: z.object({ disputeId: uuid }),
  audit: "dispute.accepted",
  async run({ input, tx, activity }) {
    const { d, p } = await load(tx, input.disputeId);
    if (!OPEN.includes(d.status)) return { id: d.id, jobId: p.jobId };
    if (p.providerRef) {
      // Same accounting as a processor "lost/accepted" webhook: refund row, payment
      // refunded, invoice balance re-opened, dispute.closed emitted.
      await applyNormalizedEvent(tx, {
        type: "dispute.closed",
        dispute: {
          ref: d.providerRef,
          paymentRef: p.providerRef,
          category: d.category,
          amountCents: d.amountCents,
          status: "charge_refunded",
          outcome: "accepted",
        },
      });
    } else {
      await tx
        .update(disputes)
        .set({
          status: "accepted",
          outcome: "accepted",
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(disputes.id, d.id));
    }
    await activity({
      entity: p.jobId
        ? { type: "job", id: p.jobId }
        : { type: "customer", id: p.customerId },
      jobId: p.jobId,
      customerId: p.customerId,
      kind: "dispute.accepted",
      summary: `Dispute accepted (${formatMoney(d.amountCents)} returned to the customer)`,
      data: { dispute_id: d.id },
    });
    return { id: d.id, jobId: p.jobId };
  },
  auditEntity: ({ input }) => ({ type: "dispute", id: input.disputeId }),
  revalidate: ({ data }) => paths(data.id, data.jobId),
});

/** Accept the dispute (don't fight it). Suggested when small and readiness is low. */
export async function acceptDispute(input: {
  disputeId: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser("disputes.manage");
    const id = uuid.parse(input.disputeId);
    const { db } = await import("@/db");
    const { d } = await load(db, id);
    if (!OPEN.includes(d.status))
      throw new ConflictError("dispute_closed", "This dispute is closed.");
    if (d.provider === "stripe" && hasCardProcessor()) {
      const provider = getPaymentProvider("stripe");
      await provider.disputes?.accept(d.providerRef);
    }
    const r = await markAccepted({ disputeId: id });
    if (!r.ok) return r;
    return { ok: true, data: { id } };
  } catch (e) {
    return actionFailure(e);
  }
}

const ChargebackSettingsSchema = z.object({
  risk: z.object({
    weights: z.record(z.string(), z.coerce.number().int().min(-100).max(100)),
    bands: z
      .object({
        medium: z.coerce.number().int().min(1).max(99),
        high: z.coerce.number().int().min(2).max(99),
        critical: z.coerce.number().int().min(3).max(100),
      })
      .refine((b) => b.medium < b.high && b.high < b.critical, {
        message: "Bands must go up: Medium < High < Critical.",
      }),
    no_estimate_min_ticket_cents: z.coerce.number().int().min(0),
    critical_control: z.enum(["approval", "prepay", "cash_only"]),
    enforce_controls: z.boolean(),
  }),
  disputes: z.object({
    efw_refund_multiplier: z.coerce.number().min(0).max(20),
    dispute_fee_cents: z.coerce.number().int().min(0).max(10_000),
    suggest_accept_under_cents: z.coerce.number().int().min(0),
    suggest_accept_readiness_below: z.coerce.number().int().min(0).max(100),
    readiness_weights: z.record(z.string(), z.coerce.number().min(0).max(100)),
    rate_threshold_bps: z.coerce.number().int().min(1).max(500),
  }),
  media: z.object({
    keep_originals: z.boolean(),
    keep_originals_tags: z.array(z.string().max(20)).max(12),
    max_upload_mb: z.coerce.number().int().min(1).max(15),
    far_from_site_m: z.coerce.number().int().min(50).max(50_000),
  }),
});

/** Settings → Chargeback protection: risk weights/bands/controls, readiness, EFW, media. */
export const saveChargebackSettings = action({
  perm: "settings.manage",
  input: ChargebackSettingsSchema,
  async run({ input, tx, actor }) {
    const { updateSettings } = await import("@/lib/settings");
    await updateSettings(tx, input, actor);
    return { ok: true };
  },
  revalidate: () => ["/settings/chargebacks", "/disputes"],
});
