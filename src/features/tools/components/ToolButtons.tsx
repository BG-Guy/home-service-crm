"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Pencil,
  Plus,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { useOpenOnParam } from "@/features/vehicles/components/useOpenOnParam";
import { Button, type ButtonVariant } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import type { PickTool, ToolFormValues } from "../contracts";

// Trigger buttons for the tools sheets. Every sheet lives in one lazy chunk
// (ToolSheets / ToolForm) so list and detail pages ship only these buttons.

const ToolForm = dynamic(() => import("./ToolForm"), { ssr: false });
const S = {
  CheckOut: dynamic(() => import("./ToolSheets").then((m) => m.CheckOutSheet), {
    ssr: false,
  }),
  Handoff: dynamic(() => import("./ToolSheets").then((m) => m.HandoffSheet), {
    ssr: false,
  }),
  Maintenance: dynamic(
    () => import("./ToolSheets").then((m) => m.MaintenanceSheet),
    { ssr: false },
  ),
  Incident: dynamic(() => import("./ToolSheets").then((m) => m.IncidentSheet), {
    ssr: false,
  }),
  Decide: dynamic(
    () => import("./ToolSheets").then((m) => m.DecideIncidentSheet),
    { ssr: false },
  ),
  Kit: dynamic(() => import("./ToolSheets").then((m) => m.KitSheet), {
    ssr: false,
  }),
  Audit: dynamic(
    () => import("./ToolSheets").then((m) => m.ScheduleAuditSheet),
    { ssr: false },
  ),
};

type Opt = { id: string; name: string };

/** Mount-on-first-open state (keeps the exit animation after closing). */
function useLazySheet() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return {
    open,
    mounted,
    setOpen,
    show: () => {
      setMounted(true);
      setOpen(true);
    },
  };
}

function Trigger({
  onClick,
  children,
  icon,
  variant = "gray",
}: {
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <Button size="sm" variant={variant} icon={icon} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * "+" (new), "Add tool" (inline) or "Edit". In `new` mode `/tools?new=tool` (the
 * global "+" menu) opens the form; `hideTrigger` keeps only that deep link.
 */
export function ToolFormButton({
  mode,
  initial,
  manage,
  users,
  customDefs,
  aiEnabled,
  categories,
  hideTrigger = false,
}: {
  mode: "new" | "new-inline" | "edit";
  initial?: ToolFormValues | null;
  manage: boolean;
  users: Opt[];
  customDefs: CustomFieldDef[];
  aiEnabled: boolean;
  categories: string[];
  hideTrigger?: boolean;
}) {
  const s = useLazySheet();
  useOpenOnParam("new", "tool", s.show, mode === "new");
  return (
    <>
      {hideTrigger ? null : mode === "new" ? (
        <IconButton label="Add tool" onClick={s.show}>
          <Plus size={22} aria-hidden />
        </IconButton>
      ) : mode === "new-inline" ? (
        <Button icon={<Plus size={18} aria-hidden />} onClick={s.show}>
          {manage ? "Add tool" : "Add my own tool"}
        </Button>
      ) : (
        <Button
          variant="plain"
          size="sm"
          icon={<Pencil size={16} aria-hidden />}
          onClick={s.show}
        >
          Edit
        </Button>
      )}
      {s.mounted && (
        <ToolForm
          open={s.open}
          onOpenChange={s.setOpen}
          initial={initial}
          manage={manage}
          users={users}
          customDefs={customDefs}
          aiEnabled={aiEnabled}
          categories={categories}
        />
      )}
    </>
  );
}

export function CheckOutButton({
  tools,
  preselected = [],
  users,
  vehicles,
  requirePhoto,
  label = "Check out",
  variant = "filled",
}: {
  tools: PickTool[];
  preselected?: string[];
  users: Opt[];
  vehicles: Opt[];
  requirePhoto: boolean;
  label?: string;
  variant?: ButtonVariant;
}) {
  const s = useLazySheet();
  return (
    <>
      <Trigger
        onClick={s.show}
        variant={variant}
        icon={<ArrowUpFromLine size={16} aria-hidden />}
      >
        {label}
      </Trigger>
      {s.mounted && (
        <S.CheckOut
          open={s.open}
          onOpenChange={s.setOpen}
          tools={tools}
          preselected={preselected}
          users={users}
          vehicles={vehicles}
          requirePhoto={requirePhoto}
        />
      )}
    </>
  );
}

export function HandoffButton({
  toolId,
  mode,
  requirePhoto,
  leaveTo,
}: {
  toolId: string;
  mode: "check_in" | "from_repair";
  requirePhoto: boolean;
  /** Where to go after a check-in that ends the viewer's access (QA2 NEW-3). */
  leaveTo?: string;
}) {
  const s = useLazySheet();
  return (
    <>
      <Trigger
        onClick={s.show}
        icon={<ArrowDownToLine size={16} aria-hidden />}
      >
        {mode === "check_in" ? "Check in" : "Back from repair"}
      </Trigger>
      {s.mounted && (
        <S.Handoff
          open={s.open}
          onOpenChange={s.setOpen}
          toolId={toolId}
          mode={mode}
          requirePhoto={requirePhoto}
          leaveTo={leaveTo}
        />
      )}
    </>
  );
}

export function MaintenanceButton({
  toolId,
  defaultTask,
  today,
}: {
  toolId: string;
  defaultTask: string | null;
  today: string;
}) {
  const s = useLazySheet();
  return (
    <>
      <Trigger onClick={s.show} icon={<Wrench size={16} aria-hidden />}>
        Log maintenance
      </Trigger>
      {s.mounted && (
        <S.Maintenance
          open={s.open}
          onOpenChange={s.setOpen}
          toolId={toolId}
          defaultTask={defaultTask}
          today={today}
        />
      )}
    </>
  );
}

export function IncidentButton({ toolId }: { toolId: string }) {
  const s = useLazySheet();
  return (
    <>
      <Trigger onClick={s.show} icon={<ShieldAlert size={16} aria-hidden />}>
        <span className="text-danger">Report problem</span>
      </Trigger>
      {s.mounted && (
        <S.Incident open={s.open} onOpenChange={s.setOpen} toolId={toolId} />
      )}
    </>
  );
}

export function DecideIncidentButton({
  incidentId,
  defaultAmountCents,
  deductionsEnabled,
}: {
  incidentId: string;
  defaultAmountCents: number | null;
  deductionsEnabled: boolean;
}) {
  const s = useLazySheet();
  return (
    <>
      <Trigger onClick={s.show} variant="tinted">
        Decide
      </Trigger>
      {s.mounted && (
        <S.Decide
          open={s.open}
          onOpenChange={s.setOpen}
          incidentId={incidentId}
          defaultAmountCents={defaultAmountCents}
          deductionsEnabled={deductionsEnabled}
        />
      )}
    </>
  );
}

export function KitButton({
  kit,
  tools,
  users,
  vehicles,
  requirePhoto,
  children,
}: {
  kit: {
    id: string;
    name: string;
    vehicleId: string | null;
    userId: string | null;
    toolIds: string[];
  } | null;
  tools: PickTool[];
  users: Opt[];
  vehicles: Opt[];
  requirePhoto: boolean;
  children?: ReactNode;
}) {
  const s = useLazySheet();
  return (
    <>
      {children ? (
        <button
          type="button"
          className="block w-full text-left"
          onClick={s.show}
        >
          {children}
        </button>
      ) : (
        <Button
          variant="plain"
          size="sm"
          icon={<Plus size={16} aria-hidden />}
          onClick={s.show}
        >
          New kit
        </Button>
      )}
      {s.mounted && (
        <S.Kit
          open={s.open}
          onOpenChange={s.setOpen}
          kit={kit}
          tools={tools}
          users={users}
          vehicles={vehicles}
          requirePhoto={requirePhoto}
        />
      )}
    </>
  );
}

export function ScheduleAuditButton({
  users,
  today,
}: {
  users: Opt[];
  today: string;
}) {
  const s = useLazySheet();
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        icon={<ClipboardList size={16} aria-hidden />}
        onClick={s.show}
      >
        Schedule
      </Button>
      {s.mounted && (
        <S.Audit
          open={s.open}
          onOpenChange={s.setOpen}
          users={users}
          today={today}
        />
      )}
    </>
  );
}
