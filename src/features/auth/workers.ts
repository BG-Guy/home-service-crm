// job_queue workers for `auth` (BUILD_PLAN §4, §8.2). Owner: F.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import type { JobQueueKind, Worker } from "@/lib/queue";

export const workers: Partial<Record<JobQueueKind, Worker>> = {};
