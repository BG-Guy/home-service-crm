// job_queue workers for `data` (BUILD_PLAN §4, §8.2). Owner: B1.
// Throw to retry with backoff; set `retryAfterMs` on the error to override the delay.
import type { JobQueueKind, Worker } from "@/lib/queue";
import { runBackup, runExportJob } from "./engine";

export const workers: Partial<Record<JobQueueKind, Worker>> = {
  /** Full export zip for an `exports` row (payload `{ exportId }`). */
  export: async (payload) => {
    await runExportJob(String(payload.exportId ?? ""));
  },
  /** Nightly JSON backup (payload `{ date: 'YYYY-MM-DD' }`). */
  backup: async (payload) => {
    const date = String(payload.date ?? new Date().toISOString().slice(0, 10));
    await runBackup(date);
  },
};
