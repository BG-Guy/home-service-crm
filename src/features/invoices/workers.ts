// job_queue workers for `invoices` (BUILD_PLAN §4, §8.2). Owner: B3.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import type { JobQueueKind, Worker } from "@/lib/queue";

export const workers: Partial<Record<JobQueueKind, Worker>> = {};
