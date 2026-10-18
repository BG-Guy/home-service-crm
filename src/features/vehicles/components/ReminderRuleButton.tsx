"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { DateField } from "@/ui/components/DatePicker";
import { TextField } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { deleteReminderRule, saveReminderRule } from "../actions";
import type { ReminderRuleDto } from "../contracts";
import { fe } from "./sheets/shared";

type Draft = Pick<
  ReminderRuleDto,
  | "task"
  | "intervalMiles"
  | "intervalDays"
  | "dueSoonMiles"
  | "dueSoonDays"
  | "lastDoneOn"
  | "lastDoneOdometer"
  | "active"
> & { id?: string };

const blank: Draft = {
  task: "",
  intervalMiles: null,
  intervalDays: null,
  dueSoonMiles: null,
  dueSoonDays: null,
  lastDoneOn: null,
  lastDoneOdometer: null,
  active: true,
};

/** Add / edit a reminder rule (Fleetio model: miles or days, whichever first). */
export function ReminderRuleButton({
  vehicleId,
  rule,
  children,
}: {
  vehicleId: string;
  rule?: ReminderRuleDto;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(() => (rule ? { ...rule } : blank));
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const str = (n: number | null) => (n == null ? "" : String(n));
  const int = (s: string) => {
    const x = s.replace(/[^\d]/g, "");
    return x ? Number(x) : null;
  };
  const save = () =>
    start(async () => {
      const r = await saveReminderRule({ ...d, vehicleId });
      if (!r.ok) {
        setErrors(r.fieldErrors);
        if (!r.fieldErrors) toast({ title: r.error, tone: "error" });
        return;
      }
      setOpen(false);
      toast({ title: "Reminder saved", tone: "success" });
    });
  const remove = async () => {
    if (
      !rule?.id ||
      !(await confirm({
        title: `Delete “${rule.label}”?`,
        message: "Its history stays in the service log.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    const id = rule.id;
    start(async () => {
      const r = await deleteReminderRule({ id });
      if (!r.ok) toast({ title: r.error, tone: "error" });
      else {
        setOpen(false);
        toast({ title: "Reminder deleted" });
      }
    });
  };

  return (
    <>
      {children ? (
        <button
          type="button"
          className="w-full text-left"
          onClick={() => setOpen(true)}
        >
          {children}
        </button>
      ) : (
        <Button
          variant="plain"
          size="sm"
          icon={<Plus size={16} aria-hidden />}
          onClick={() => {
            setD(blank);
            setOpen(true);
          }}
        >
          Add reminder
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={rule ? rule.label : "New reminder"}
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button size="lg" fullWidth loading={pending} onClick={save}>
              Save reminder
            </Button>
            {rule?.id && (
              <Button variant="plain" fullWidth onClick={remove}>
                <span className="text-danger">Delete reminder</span>
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4 pb-4 pt-1">
          {!rule && (
            <TextField
              label="Task"
              placeholder="Oil change, Transmission service…"
              value={d.task}
              onChange={(e) => setD({ ...d, task: e.currentTarget.value })}
              error={fe(errors, "task")}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Every (miles)"
              inputMode="numeric"
              value={str(d.intervalMiles)}
              onChange={(e) =>
                setD({ ...d, intervalMiles: int(e.currentTarget.value) })
              }
            />
            <TextField
              label="Every (days)"
              inputMode="numeric"
              value={str(d.intervalDays)}
              onChange={(e) =>
                setD({ ...d, intervalDays: int(e.currentTarget.value) })
              }
            />
            <TextField
              label="Due soon (miles)"
              inputMode="numeric"
              value={str(d.dueSoonMiles)}
              onChange={(e) =>
                setD({ ...d, dueSoonMiles: int(e.currentTarget.value) })
              }
            />
            <TextField
              label="Due soon (days)"
              inputMode="numeric"
              value={str(d.dueSoonDays)}
              onChange={(e) =>
                setD({ ...d, dueSoonDays: int(e.currentTarget.value) })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="Last done"
              value={d.lastDoneOn ?? ""}
              onChange={(e) =>
                setD({ ...d, lastDoneOn: e.currentTarget.value || null })
              }
              error={fe(errors, "lastDoneOn")}
            />
            <TextField
              label="At odometer"
              inputMode="numeric"
              value={str(d.lastDoneOdometer)}
              onChange={(e) =>
                setD({ ...d, lastDoneOdometer: int(e.currentTarget.value) })
              }
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-body">Active</span>
            <Toggle
              label="Active"
              checked={d.active}
              onChange={(e) => setD({ ...d, active: e.currentTarget.checked })}
            />
          </div>
          <p className="text-footnote text-label-2">
            Whichever comes first. The due date is forecast from this vehicle’s
            average daily miles and resets only when an approved service record
            includes this task.
          </p>
        </div>
      </Sheet>
      {confirmEl}
    </>
  );
}
