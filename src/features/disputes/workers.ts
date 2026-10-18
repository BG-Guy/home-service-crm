// job_queue workers for `disputes` (BUILD_PLAN §4, §8.2). Owner: B4.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { disputes } from "@/db/schema";
import type { JobQueueKind, Worker } from "@/lib/queue";

export const workers: Partial<Record<JobQueueKind, Worker>> = {
  /**
   * Assemble a dispute's evidence (queued by dispute.created): refresh the evidence
   * JSON from the job (keeps admin edits). With a server PdfRenderer and a provider
   * disputes API the pack would be rendered and staged (submit=false) here; with the
   * default `none` renderer the admin prints /jobs/[id]/evidence and uses the copy panel.
   */
  evidence_pack: async (payload) => {
    const id = payload.disputeId ?? payload.dispute_id;
    if (typeof id !== "string") return;
    const [d] = await db
      .select({ id: disputes.id, status: disputes.status })
      .from(disputes)
      .where(eq(disputes.id, id))
      .limit(1);
    if (!d) return;
    const { refreshDisputeEvidence } = await import("./server");
    await db.transaction((tx) => refreshDisputeEvidence(tx, id));
  },
};
