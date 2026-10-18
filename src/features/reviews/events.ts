// Event handlers for `reviews` (BUILD_PLAN §4, §7). Owner: B5.
// Each handler runs in its own transaction and MUST be idempotent.
import { eq } from "drizzle-orm";
import { invoices } from "@/db/schema";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { ensureCallbackTask, scheduleReviewAfterPayment } from "./service";

type P = Record<string, unknown>;
const str = (p: P, k: string) =>
  typeof p[k] === "string" ? (p[k] as string) : null;

export const handlers: HandlerReg[] = [
  {
    // The completion-time ask waited for payment: ask 60 min after it's paid.
    event: "invoice.paid",
    name: "reviews.after_payment",
    async run(e, { tx }) {
      const invoiceId = str(e.payload as P, "invoice_id");
      if (!invoiceId) return;
      const [inv] = await tx
        .select({ jobId: invoices.jobId })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);
      if (inv?.jobId) await scheduleReviewAfterPayment(tx, inv.jobId);
    },
  },
  {
    event: "job.closed",
    name: "reviews.after_close",
    async run(e, { tx }) {
      const jobId = str(e.payload as P, "job_id");
      if (jobId) await scheduleReviewAfterPayment(tx, jobId);
    },
  },
  {
    // ≤ 3 stars with "please call me" → office callback task (never changes who is asked).
    event: "review.rated",
    name: "reviews.callback_task",
    async run(e, { tx }) {
      const id = str(e.payload as P, "review_request_id");
      if (id) await ensureCallbackTask(tx, id);
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
