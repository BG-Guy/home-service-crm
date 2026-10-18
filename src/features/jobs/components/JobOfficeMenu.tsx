"use client";

import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CircleCheckBig,
  Ellipsis,
  PencilLine,
  PhoneForwarded,
  Printer,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { IconButton } from "@/ui/components/IconButton";
import {
  type PageAction,
  type PageActionGroup,
  usePageActions,
} from "@/ui/components/PageActions";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import { closeJobManual, confirmJobManual } from "../actions";
import type { JobStatus } from "../contracts";
import { type CancellationPolicy, isAfterArrival } from "../machine";
import type { EditableJob } from "./EditJobSheet";
import { useStatusRunner } from "./sheets/use-status";

// Office job actions: edit, assign/reschedule, confirm, return visit, cancel,
// reopen, close, callback, print, evidence. On desktop they fill the action rail
// beside the sidebar; below 1024 px they sit behind the nav-bar "…". Every item
// is perm-gated by the page; actions re-check on the server.

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

  const schedule: PageAction[] = [];
  const edit: PageAction[] = [];
  const work: PageAction[] = [];
  const docs: PageAction[] = [];
  const danger: PageAction[] = [];
  if (can.assign && !done && s !== "on_hold")
    schedule.push({
      label:
        s === "unscheduled" ? "Schedule & assign" : "Reschedule or reassign",
      short: s === "unscheduled" ? "Schedule" : "Reschedule",
      icon: <CalendarClock />,
      onSelect: () => setSheet("assign"),
    });
  if ((can.edit || can.statusAny) && s === "scheduled" && !job.confirmedAt)
    schedule.push({
      label: "Mark confirmed by customer",
      short: "Confirmed",
      icon: <CalendarCheck />,
      onSelect: () =>
        start(async () => {
          const r = await confirmJobManual({ jobId: job.id });
          if (r.ok) toast.success("Marked confirmed");
          else toast.error(r.error);
        }),
    });
  if (s === "on_hold" && (can.statusAny || can.assign))
    schedule.push({
      label: "Schedule return visit",
      short: "Return visit",
      icon: <CalendarPlus />,
      onSelect: () => setSheet("visit"),
    });
  if (can.edit && s !== "closed")
    edit.push({
      label: "Edit details",
      short: "Edit",
      icon: <PencilLine />,
      onSelect: () => setSheet("edit"),
    });
  if (can.create && (s === "completed" || s === "closed"))
    work.push({
      label: "Create callback job",
      short: "Callback",
      icon: <PhoneForwarded />,
      href: `/jobs/new?callbackOf=${job.id}`,
    });
  if (can.reopen && s === "completed")
    work.push({
      label: "Close job",
      short: "Close",
      icon: <CircleCheckBig />,
      onSelect: () =>
        start(async () => {
          const r = await closeJobManual({ jobId: job.id });
          if (r.ok) toast.success("Job closed");
          else toast.error(r.error);
        }),
    });
  if (can.reopen && (s === "completed" || s === "closed"))
    work.push({
      label: "Reopen job",
      short: "Reopen",
      icon: <RotateCcw />,
      onSelect: () => setSheet("reopen"),
    });
  docs.push({
    label: "Print work order",
    short: "Print",
    icon: <Printer />,
    href: `/jobs/${job.id}/print`,
  });
  if (can.evidence && (s === "completed" || s === "closed"))
    docs.push({
      label: "Evidence pack",
      short: "Evidence",
      icon: <ShieldCheck />,
      href: `/jobs/${job.id}/evidence`,
    });
  if (!done && (afterArrival ? can.cancelAfterArrival : can.cancel))
    danger.push({
      label: "Cancel job",
      short: "Cancel job",
      icon: <Ban />,
      destructive: true,
      onSelect: () => setSheet("cancel"),
    });
  const groups: PageActionGroup[] = [
    { title: "Schedule", actions: schedule },
    { title: "Job", actions: [...edit, ...work] },
    { title: "Documents", actions: docs },
    { actions: danger },
  ];
  const inRail = usePageActions({
    title: job.number,
    subtitle: "Job actions",
    groups,
  });
  // The "…" sheet keeps the old order: edit first, cancel last.
  const items: ActionSheetItem[] = [
    ...edit,
    ...schedule,
    ...work,
    ...docs,
    ...danger,
  ].map((a) => ({
    label: a.label,
    href: a.href,
    destructive: a.destructive,
    onSelect: a.onSelect,
  }));

  return (
    <>
      <IconButton
        label="Job actions"
        variant="plain"
        className={inRail ? "lg:hidden" : undefined}
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
