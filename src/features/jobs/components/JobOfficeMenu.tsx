"use client";

import { Ellipsis } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { IconButton } from "@/ui/components/IconButton";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import { closeJobManual, confirmJobManual } from "../actions";
import type { JobStatus } from "../contracts";
import { type CancellationPolicy, isAfterArrival } from "../machine";
import type { EditableJob } from "./EditJobSheet";
import { useStatusRunner } from "./sheets/use-status";

// Office job menu (nav-bar "…"): edit, assign/reschedule, confirm, return visit,
// cancel, reopen, close, callback, print, evidence. Every item is perm-gated by
// the page; actions re-check on the server.

const AssignSheet = dynamic(() => import("./AssignSheet"), { ssr: false });
const EditJobSheet = dynamic(() => import("./EditJobSheet"), { ssr: false });
const CancelSheet = dynamic(() => import("./sheets/CancelSheet"), {
  ssr: false,
});
const ReasonSheet = dynamic(() => import("./sheets/ReasonSheet"), {
  ssr: false,
});
const VisitSheet = dynamic(() => import("./sheets/VisitSheet"), { ssr: false });

type Sheet = null | "menu" | "assign" | "edit" | "cancel" | "reopen" | "visit";

export function JobOfficeMenu({
  job,
  serviceTypes,
  can,
  policy,
  windowLengths,
  defaultWindow,
  todayKey,
  initial,
}: {
  job: EditableJob & {
    number: string;
    status: JobStatus;
    arrivedAt: string | null;
    windowStart: string | null;
    confirmedAt: string | null;
  };
  serviceTypes: { id: string; name: string }[];
  can: {
    edit: boolean;
    assign: boolean;
    cancel: boolean;
    cancelAfterArrival: boolean;
    reviewCancellations: boolean;
    reopen: boolean;
    statusAny: boolean;
    create: boolean;
    evidence: boolean;
  };
  policy: CancellationPolicy;
  windowLengths: number[];
  defaultWindow: number;
  todayKey: string;
  initial?: "assign" | null;
}) {
  const [sheet, setSheet] = useState<Sheet>(initial ?? null);
  const [, start] = useTransition();
  const { run, pending } = useStatusRunner(job.id);
  const close = () => setSheet(null);
  const s = job.status;
  const done = s === "completed" || s === "closed" || s === "cancelled";
  const afterArrival = isAfterArrival({ status: s, arrivedAt: job.arrivedAt });

  const doRun = async (
    to: JobStatus,
    extra: Record<string, unknown>,
    ok: string,
  ) => {
    haptic();
    const r = await run(to, extra, { success: ok });
    if (r && r !== "queued" && r.status === "blocked") {
      toast.warning("Requirements missing", {
        message: r.missing.map((m) => m.label).join(" · "),
      });
      return;
    }
    if (r) close();
  };

  const items: ActionSheetItem[] = [];
  if (can.edit && s !== "closed")
    items.push({ label: "Edit details", onSelect: () => setSheet("edit") });
  if (can.assign && !done && s !== "on_hold")
    items.push({
      label:
        s === "unscheduled" ? "Schedule & assign" : "Reschedule or reassign",
      onSelect: () => setSheet("assign"),
    });
  if ((can.edit || can.statusAny) && s === "scheduled" && !job.confirmedAt)
    items.push({
      label: "Mark confirmed by customer",
      onSelect: () =>
        start(async () => {
          const r = await confirmJobManual({ jobId: job.id });
          if (r.ok) toast.success("Marked confirmed");
          else toast.error(r.error);
        }),
    });
  if (s === "on_hold" && (can.statusAny || can.assign))
    items.push({
      label: "Schedule return visit",
      onSelect: () => setSheet("visit"),
    });
  if (can.create && (s === "completed" || s === "closed"))
    items.push({
      label: "Create callback job",
      href: `/jobs/new?callbackOf=${job.id}`,
    });
  if (can.reopen && s === "completed")
    items.push({
      label: "Close job",
      onSelect: () =>
        start(async () => {
          const r = await closeJobManual({ jobId: job.id });
          if (r.ok) toast.success("Job closed");
          else toast.error(r.error);
        }),
    });
  if (can.reopen && (s === "completed" || s === "closed"))
    items.push({ label: "Reopen job", onSelect: () => setSheet("reopen") });
  items.push({ label: "Print work order", href: `/jobs/${job.id}/print` });
  if (can.evidence && (s === "completed" || s === "closed"))
    items.push({ label: "Evidence pack", href: `/jobs/${job.id}/evidence` });
  if (!done && (afterArrival ? can.cancelAfterArrival : can.cancel))
    items.push({
      label: "Cancel job",
      destructive: true,
      onSelect: () => setSheet("cancel"),
    });

  return (
    <>
      <IconButton
        label="Job actions"
        variant="plain"
        onClick={() => setSheet("menu")}
      >
        <Ellipsis size={22} />
      </IconButton>
      <ActionSheet
        open={sheet === "menu"}
        onOpenChange={(o) => !o && sheet === "menu" && close()}
        title={job.number}
        items={items.map((i) => ({
          ...i,
          onSelect: i.onSelect
            ? () => setTimeout(() => i.onSelect?.(), 0)
            : undefined,
        }))}
      />
      {sheet === "assign" && (
        <AssignSheet jobId={job.id} open onOpenChange={(o) => !o && close()} />
      )}
      {sheet === "edit" && (
        <EditJobSheet
          open
          onOpenChange={(o) => !o && close()}
          job={job}
          serviceTypes={serviceTypes}
        />
      )}
      {sheet === "cancel" && (
        <CancelSheet
          open
          onOpenChange={(o) => !o && close()}
          jobId={job.id}
          afterArrival={afterArrival}
          reviewNeeded={afterArrival && !can.reviewCancellations}
          windowStart={job.windowStart}
          policy={policy}
          pending={pending != null}
          onSubmit={(v) => void doRun("cancelled", v, "Job cancelled")}
        />
      )}
      {sheet === "reopen" && (
        <ReasonSheet
          open
          onOpenChange={(o) => !o && close()}
          title="Reopen job"
          message="The job goes back to In progress. The reason is saved to the audit log."
          submitLabel="Reopen"
          pending={pending != null}
          onSubmit={(reason) =>
            void doRun("in_progress", { reason }, "Job reopened")
          }
        />
      )}
      {sheet === "visit" && (
        <VisitSheet
          open
          onOpenChange={(o) => !o && close()}
          title="Return visit"
          submitLabel="Schedule visit"
          defaultDate={todayKey}
          defaultMinutes={defaultWindow}
          windowLengths={windowLengths}
          pending={pending != null}
          onSubmit={(v) => void doRun("scheduled", v, "Return visit scheduled")}
        />
      )}
    </>
  );
}
