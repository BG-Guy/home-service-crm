"use client";

import { Car, ChevronRight, MapPinCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStatusRunner } from "@/features/jobs/components/sheets/use-status";
import type { JobStatus } from "@/features/jobs/contracts";
import { Button } from "@/ui/components/Button";
import { haptic } from "@/ui/motion/haptics";

const EtaSheet = dynamic(
  () => import("@/features/jobs/components/sheets/EtaSheet"),
  { ssr: false },
);

/**
 * Next-job hero button on My Day: On my way / Arrived / Open job. Navigate lives on
 * the address card right below it (one Navigate button, QA T1-23).
 */
export function HeroActions({
  jobId,
  status: initial,
  customerFirstName,
}: {
  jobId: string;
  status: JobStatus;
  customerFirstName: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [eta, setEta] = useState(false);
  const { run, pending } = useStatusRunner(jobId, (to) => setStatus(to));

  const go = async (
    to: JobStatus,
    extra: Record<string, unknown>,
    ok: string,
  ) => {
    haptic();
    const r = await run(to, extra, { geo: true, success: ok });
    if (r && r !== "queued" && r.status === "done") setStatus(r.to);
    setEta(false);
    if (to === "arrived" && r) router.push(`/jobs/${jobId}`);
  };

  const primary =
    status === "scheduled" || status === "confirmed" ? (
      <Button
        className="flex-1"
        icon={<Car size={18} aria-hidden />}
        loading={pending === "en_route"}
        onClick={() => setEta(true)}
      >
        On my way
      </Button>
    ) : status === "en_route" ? (
      <Button
        className="flex-1"
        icon={<MapPinCheck size={18} aria-hidden />}
        loading={pending === "arrived"}
        onClick={() => void go("arrived", {}, "Arrived")}
      >
        Arrived
      </Button>
    ) : (
      <Button
        className="flex-1"
        href={`/jobs/${jobId}`}
        transition="push"
        icon={<ChevronRight size={18} aria-hidden />}
      >
        Open job
      </Button>
    );

  return (
    <div className="flex gap-2">
      {primary}
      {eta && (
        <EtaSheet
          open
          onOpenChange={(o) => !o && setEta(false)}
          mode="on_my_way"
          customerFirstName={customerFirstName}
          pending={pending != null}
          onSubmit={(m) => void go("en_route", { etaMinutes: m }, "On the way")}
        />
      )}
    </div>
  );
}
