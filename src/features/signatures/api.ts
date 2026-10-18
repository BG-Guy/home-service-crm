import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { changeOrders, estimates, media, signatures } from "@/db/schema";
import { lockEvidenceMedia } from "@/features/media/api";
import { writeActivity } from "@/lib/activity";
import { ValidationError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { sha256Json } from "@/lib/hash";
import type { Actor, EntityRef } from "@/lib/types";
import type {
  CaptureSignatureInput,
  SignatureBrief,
  SignatureDocType,
} from "./contracts";

// B3 signatures API (BUILD_PLAN §6.3). The signature library every group uses to
// capture evidence-grade e-signatures (ESIGN Act): what was shown (snapshot + sha256),
// the policy versions in force, who signed (typed name + drawn PNG), how (in person,
// remote link, verbal), consent text, IP, user agent, geolocation and device time.
// `signatures` is append-only (DB trigger) — a re-sign inserts a new row.

export type * from "./contracts";

const DOC_LABEL: Record<SignatureDocType, string> = {
  estimate: "estimate",
  change_order: "change order",
  completion: "work completion",
  deposit_terms: "deposit terms",
  ownership: "ownership / authority",
  comp_agreement: "compensation agreement",
  tool_agreement: "tool agreement",
  monitoring_notice: "monitoring notice",
  card_on_file: "card-on-file authorization",
  cooling_off_waiver: "cooling-off waiver",
  statement_ack: "pay statement",
};

/** Job the signed document belongs to (for the job timeline and readiness). */
async function jobFor(
  tx: Tx,
  docType: SignatureDocType,
  docId: string,
): Promise<string | null> {
  if (docType === "completion" || docType === "ownership") return docId;
  if (docType === "estimate" || docType === "cooling_off_waiver") {
    const [e] = await tx
      .select({ jobId: estimates.jobId })
      .from(estimates)
      .where(eq(estimates.id, docId))
      .limit(1);
    return e?.jobId ?? null;
  }
  if (docType === "change_order") {
    const [c] = await tx
      .select({ jobId: changeOrders.jobId })
      .from(changeOrders)
      .where(eq(changeOrders.id, docId))
      .limit(1);
    return c?.jobId ?? null;
  }
  return null;
}

/** The media entity a document's own uploads are bound to (public magic links). */
const DOC_ENTITY: Partial<Record<SignatureDocType, string>> = {
  estimate: "estimate",
  change_order: "change_order",
  completion: "job",
  ownership: "job",
};

export const SIGNATURE_MEDIA_ERROR =
  "That signature image can't be used for this document. Please sign again.";

/**
 * The signature image must be evidence for THIS document (QA T5-12b): a live
 * `signature` media row, not already used by another signature, not bound to a
 * different job, and either uploaded for this document or its job (the public
 * magic-link route binds the link's entity and job), or uploaded by the signed-in
 * actor capturing the signature (S15 on a staff device).
 */
async function assertSignatureMedia(
  tx: Tx,
  mediaId: string,
  doc: { docType: SignatureDocType; docId: string; jobId: string | null },
  actor: Actor,
): Promise<void> {
  const bad = () =>
    new ValidationError(
      { signatureMediaId: [SIGNATURE_MEDIA_ERROR] },
      SIGNATURE_MEDIA_ERROR,
    );
  const [m] = await tx
    .select({
      kind: media.kind,
      jobId: media.jobId,
      entityType: media.entityType,
      entityId: media.entityId,
      uploaderId: media.uploaderId,
      deletedAt: media.deletedAt,
    })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  if (!m || m.deletedAt || m.kind !== "signature") throw bad();
  if (m.jobId && m.jobId !== doc.jobId) throw bad();
  const [used] = await tx
    .select({ id: signatures.id })
    .from(signatures)
    .where(eq(signatures.signatureMediaId, mediaId))
    .limit(1);
  if (used) throw bad();
  const entity = DOC_ENTITY[doc.docType];
  const sameDoc =
    !!entity && m.entityType === entity && m.entityId === doc.docId;
  const jobEntity =
    !!doc.jobId && m.entityType === "job" && m.entityId === doc.jobId;
  // Bound to another document (e.g. a different estimate on the same job).
  if (entity && m.entityType && m.entityId && !sameDoc && !jobEntity)
    throw bad();
  const sameJob = !!doc.jobId && m.jobId === doc.jobId;
  const ownUpload = !!actor.userId && m.uploaderId === actor.userId;
  if (!sameDoc && !sameJob && !ownUpload) throw bad();
}

/**
 * Append a signature. doc_sha256 = sha256(canonical JSON of docSnapshot). Checks the
 * signature image belongs to this document (assertSignatureMedia), locks it as
 * evidence (B4 lockEvidenceMedia), emits signature.captured and writes the
 * timeline row. ESIGN: in-person and remote signatures require consent; verbal
 * approvals carry none (and are flagged as verbal everywhere).
 */
export async function captureSignature(
  tx: Tx,
  input: CaptureSignatureInput,
  actor: Actor,
): Promise<{ signatureId: string; docSha256: string }> {
  const name = input.signerName.trim();
  if (!name)
    throw new ValidationError({ signerName: ["Type your full name."] });
  if (input.channel !== "verbal") {
    // A typed name is a valid e-signature; the drawn PNG is strongly preferred
    // (S15 always sends one) but other groups' flows may capture typed-only acks.
    if (!input.esignConsent)
      throw new ValidationError({
        esignConsent: ["Agree to sign electronically first."],
      });
  }
  const jobId = await jobFor(tx, input.docType, input.docId);
  if (input.signatureMediaId)
    await assertSignatureMedia(
      tx,
      input.signatureMediaId,
      { docType: input.docType, docId: input.docId, jobId },
      actor,
    );
  const docSha256 = sha256Json(input.docSnapshot);
  const [row] = await tx
    .insert(signatures)
    .values({
      docType: input.docType,
      docId: input.docId,
      docSha256,
      docSnapshot: input.docSnapshot as never,
      policyVersionIds: input.policyVersionIds ?? [],
      signerName: name.slice(0, 200),
      signerKind: input.signerKind,
      signerUserId: input.signerUserId ?? null,
      customerId: input.customerId ?? null,
      signatureMediaId: input.signatureMediaId ?? null,
      channel: input.channel,
      esignConsent: input.esignConsent,
      consentText: input.consentText ?? null,
      ip: input.ip ?? actor.ip ?? null,
      userAgent:
        (input.userAgent ?? actor.userAgent ?? null)?.slice(0, 400) ?? null,
      lat: input.geo?.lat ?? null,
      lng: input.geo?.lng ?? null,
      accuracyM: input.geo?.accuracyM ?? null,
      deviceTs: input.deviceTs ?? null,
      tokenId: input.tokenId ?? actor.tokenId ?? null,
    })
    .returning({ id: signatures.id });
  if (!row) throw new Error("signature insert failed");
  if (input.signatureMediaId)
    await lockEvidenceMedia(tx, [input.signatureMediaId]);
  await emit(
    tx,
    "signature.captured",
    { type: "signature", id: row.id },
    {
      signature_id: row.id,
      doc_type: input.docType,
      doc_id: input.docId,
      job_id: jobId,
      customer_id: input.customerId ?? null,
      signer_kind: input.signerKind,
    },
    { actor },
  );
  const entity: EntityRef | null =
    input.docType === "estimate"
      ? { type: "estimate", id: input.docId }
      : jobId
        ? { type: "job", id: jobId }
        : input.customerId
          ? { type: "customer", id: input.customerId }
          : input.signerUserId
            ? { type: "user", id: input.signerUserId }
            : null;
  if (entity)
    await writeActivity(tx, {
      entity,
      customerId: input.customerId ?? null,
      jobId,
      kind: "signature.captured",
      summary: `${input.channel === "verbal" ? "Verbally approved" : "Signed"}: ${DOC_LABEL[input.docType]}`,
      data: {
        signature_id: row.id,
        doc_type: input.docType,
        channel: input.channel,
        sha256: docSha256,
      },
      actorUserId: actor.userId,
    });
  return { signatureId: row.id, docSha256 };
}

export async function hasSignature(
  docType: SignatureDocType,
  docId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: signatures.id })
    .from(signatures)
    .where(and(eq(signatures.docType, docType), eq(signatures.docId, docId)))
    .limit(1);
  return rows.length > 0;
}

export async function getLatestSignature(
  docType: SignatureDocType,
  docId: string,
): Promise<SignatureBrief | null> {
  const [r] = await db
    .select()
    .from(signatures)
    .where(and(eq(signatures.docType, docType), eq(signatures.docId, docId)))
    .orderBy(desc(signatures.signedAt))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    docType: r.docType as SignatureDocType,
    signerName: r.signerName,
    channel: r.channel,
    signedAt: r.signedAt,
    docSha256: r.docSha256,
  };
}
