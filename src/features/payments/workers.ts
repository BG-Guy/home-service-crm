// job_queue workers for `payments` (BUILD_PLAN §4, §8.2). Owner: B4.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import type { JobQueueKind, Worker } from "@/lib/queue";
import { fetchStripeFee } from "./background";

export const workers: Partial<Record<JobQueueKind, Worker>> = {
  /** Fetch the processor's actual fee (balance_transaction) after a card payment. */
  stripe_fee: async (payload) => {
    const id = payload.paymentId;
    if (typeof id === "string") await fetchStripeFee(id);
  },
  /**
   * Server PDF rendering (invoice / statement / evidence pack). The default renderer is
   * `none` (browser print), so jobs are acknowledged without work; a future `pdflib`
   * renderer plugs in here (SPEC §9.6).
   */
  pdf: async () => {
    const { pdfEnabled } = await import("@/adapters/pdf");
    if (!pdfEnabled()) return;
  },
};
