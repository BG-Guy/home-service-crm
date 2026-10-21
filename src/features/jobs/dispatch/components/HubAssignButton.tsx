"use client";

import { UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import { scheduleJob } from "../../actions";
import { hubHref } from "../href";

/**
 * The hub's one primary action: "Assign <Name>". Goes through the existing
 * `scheduleJob` action (permissions, conflicts, job.assigned / job.scheduled
 * events, tech push, audit) — no separate mutation path. An untimed job also
 * gets the suggested arrival on the hub's day (needs jobs.reschedule).
 */
export function HubAssignButton({
  jobId,
  jobNumber,
  techId,
  techName,
  date,
  start,
  minutes,
  replacing,
  block,
}: {
  jobId: string;
  jobNumber: string;
  techId: string;
  techName: string;
  date: string;
  /** "HH:MM" in the company zone when the job has no window yet, else null. */
  start: string | null;
  minutes: number;
  /** Names currently on the job (reassign confirm). */
  replacing: string[];
  block?: boolean;
}) {
  const router = useRouter();
  const [pending, startPending] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const first = techName.split(" ")[0] ?? techName;
  const run = async () => {
    if (
      replacing.length > 0 &&
      !(await confirm({
        title: `Reassign ${jobNumber} to ${first}?`,
        message: `${replacing.join(", ")} will be taken off the job and notified.`,
        confirmLabel: "Reassign",
      }))
    )
      return;
    startPending(async () => {
      const r = await scheduleJob({
        jobId,
        assignees: [{ userId: techId, role: "primary", splitBps: 10_000 }],
        ...(start ? { date, start, minutes } : {}),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      haptic();
      toast.success(`${jobNumber} assigned to ${first}`, {
        action: {
          label: "View job",
          onPress: () => router.push(`/jobs/${jobId}`),
        },
      });
      router.replace(hubHref({ date, job: null }, techId), { scroll: false });
    });
  };
  return (
    <>
      <Button
        size="lg"
        block={block}
        loading={pending}
        icon={<UserCheck size={20} aria-hidden />}
        onClick={run}
      >
        {replacing.length ? `Reassign to ${first}` : `Assign ${first}`}
      </Button>
      {confirmEl}
    </>
  );
}
