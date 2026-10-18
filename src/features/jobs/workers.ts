// job_queue workers for `jobs` (BUILD_PLAN §4, §8.2). Owner: B2.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import type { JobQueueKind, Worker } from "@/lib/queue";

export const workers: Partial<Record<JobQueueKind, Worker>> = {};
