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
 * The one primary on the Today hero: On my way / Arrived / Open job. Navigate, call
 * and text are round icon buttons next to it (NextJobHero). `muted` steps it down to
 * a tinted button while "Clock in" is the page's primary.
 */
export function HeroActions({
  jobId,
  status: initial,
  customerFirstName,
  muted,
}: {
  jobId: string;
  status: JobStatus;
  customerFirstName: string | null;
  muted?: boolean;
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

  const variant = muted ? "tinted" : "primary";
  const primary =
    status === "scheduled" || status === "confirmed" ? (
      <Button
        variant={variant}
        block
        icon={<Car size={18} aria-hidden />}
        loading={pending === "en_route"}
        onClick={() => setEta(true)}
      >
        On my way
      </Button>
    ) : status === "en_route" ? (
      <Button
        variant={variant}
        block
        icon={<MapPinCheck size={18} aria-hidden />}
        loading={pending === "arrived"}
        onClick={() => void go("arrived", {}, "Arrived")}
      >
        Arrived
      </Button>
    ) : (
      <Button
        variant={variant}
        block
        href={`/jobs/${jobId}`}
        transition="push"
        icon={<ChevronRight size={18} aria-hidden />}
      >
        Open job
      </Button>
    );

  return (
    <>
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
    </>
  );
}
