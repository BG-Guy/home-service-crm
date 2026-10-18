"use client";

import { useState } from "react";
import { getPosition } from "@/client/geo";
import { toast } from "@/ui/components/Toast";
import type { JobStatus } from "../../contracts";
import type { TransitionResult } from "../../types";
import { runOffline } from "../offline-client";

export type StatusRun = TransitionResult | "queued" | null;

/** Runs a status transition through the offline outbox, with geostamp + toasts. */
export function useStatusRunner(
  jobId: string,
  onQueued?: (to: JobStatus) => void,
) {
  const [pending, setPending] = useState<JobStatus | null>(null);
  async function run(
    to: JobStatus,
    extra: Record<string, unknown> = {},
    opts: { geo?: boolean; success?: string } = {},
  ): Promise<StatusRun> {
    setPending(to);
    try {
      const geo = opts.geo
        ? await getPosition({ timeoutMs: 6000, maxAgeMs: 30_000 })
        : null;
      const r = await runOffline<TransitionResult>("jobs.setStatus", {
        jobId,
        to,
        geo: geo
          ? {
              lat: geo.lat,
              lng: geo.lng,
              accuracyM: geo.accuracyM ?? null,
              at: geo.at,
            }
          : null,
        ...extra,
      });
      if (r.queued) {
        onQueued?.(to);
        toast({
          title: "Saved on this phone",
          message: "It will sync as soon as you're back online.",
          id: `job-${jobId}-queued`,
        });
        return "queued";
      }
      if (!r.result?.ok) {
        toast.error(
          r.result && !r.result.ok ? r.result.error : "Something went wrong.",
        );
        return null;
      }
      const data = r.result.data ?? null;
      if (data?.status === "done") {
        if (opts.success) toast.success(opts.success);
        for (const w of data.warnings) toast.warning(w);
      }
      return data;
    } finally {
      setPending(null);
    }
  }
  return { run, pending };
}
