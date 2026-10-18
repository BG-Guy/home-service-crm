"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { haptic } from "@/ui/motion/haptics";
import { updateJobDetails } from "../actions";

export interface EditableJob {
  id: string;
  title: string;
  description: string | null;
  customerNotes: string | null;
  priority: "normal" | "urgent" | "emergency";
  afterHours: boolean;
  serviceTypeId: string | null;
  recurrence: { every: "weeks" | "months"; n: number; until?: string } | null;
}

/** Edit job details (jobs.edit). Window/assignees live in the assign sheet. */
export default function EditJobSheet({
  open,
  onOpenChange,
  job,
  serviceTypes,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: EditableJob;
  serviceTypes: { id: string; name: string }[];
}) {
  const [v, setV] = useState(job);
  const [repeat, setRepeat] = useState(job.recurrence ? "on" : "off");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const dirty =
    JSON.stringify(v) !== JSON.stringify(job) ||
    (repeat === "on") !== !!job.recurrence;
  const set = <K extends keyof EditableJob>(k: K, val: EditableJob[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  const save = () =>
    start(async () => {
      const r = await updateJobDetails({
        jobId: job.id,
        title: v.title,
        description: v.description,
        customerNotes: v.customerNotes,
        priority: v.priority,
        afterHours: v.afterHours,
        serviceTypeId: v.serviceTypeId,
        recurrence:
          repeat === "on" ? (v.recurrence ?? { every: "months", n: 12 }) : null,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      haptic();
      toast.success("Job updated");
      onOpenChange(false);
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit job"
      dirty={dirty}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          loading={pending}
          disabled={!v.title.trim()}
          onClick={save}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-8">
        <TextField
          label="Title"
          value={v.title}
          maxLength={200}
          required
          error={errors.title?.[0]}
          onChange={(e) => set("title", e.target.value)}
        />
        <Select
          label="Service type"
          value={v.serviceTypeId ?? ""}
          placeholder="None"
          options={serviceTypes.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(e) => set("serviceTypeId", e.target.value || null)}
          hint="Changing it rebuilds the checklist if nothing is answered yet."
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-footnote font-semibold text-label-2">
            Priority
          </span>
          <SegmentedControl
            label="Priority"
            value={v.priority}
            onChange={(p) => set("priority", p)}
            segments={[
              { value: "normal", label: "Normal" },
              { value: "urgent", label: "Urgent" },
              { value: "emergency", label: "Emergency" },
            ]}
          />
        </div>
        <div className="list-card">
          <ToggleRow
            title="After hours"
            subtitle="Applies after-hours pricing and pay rules"
            checked={v.afterHours}
            onChange={(e) => set("afterHours", e.target.checked)}
          />
          <ToggleRow
            title="Repeats"
            subtitle="Creates the next visit when this one is completed"
            checked={repeat === "on"}
            onChange={(e) => setRepeat(e.target.checked ? "on" : "off")}
          />
        </div>
        {repeat === "on" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Every"
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              value={String(v.recurrence?.n ?? 12)}
              onChange={(e) =>
                set("recurrence", {
                  every: v.recurrence?.every ?? "months",
                  n: Math.max(1, Math.min(24, Number(e.target.value) || 1)),
                  until: v.recurrence?.until,
                })
              }
            />
            <Select
              label="Unit"
              value={v.recurrence?.every ?? "months"}
              options={[
                { value: "weeks", label: "Weeks" },
                { value: "months", label: "Months" },
              ]}
              onChange={(e) =>
                set("recurrence", {
                  every: e.target.value as "weeks" | "months",
                  n: v.recurrence?.n ?? 12,
                  until: v.recurrence?.until,
                })
              }
            />
          </div>
        )}
        <TextArea
          label="Description (internal)"
          value={v.description ?? ""}
          rows={3}
          maxLength={5000}
          onChange={(e) => set("description", e.target.value || null)}
        />
        <TextArea
          label="Customer notes"
          hint="What the customer told us (shown to the tech)."
          value={v.customerNotes ?? ""}
          rows={3}
          maxLength={5000}
          onChange={(e) => set("customerNotes", e.target.value || null)}
        />
      </div>
    </Sheet>
  );
}
