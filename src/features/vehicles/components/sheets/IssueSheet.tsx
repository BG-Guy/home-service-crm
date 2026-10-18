"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import type { SheetVehicle } from "./OdometerSheet";
import {
  type Evidence,
  EvidenceCamera,
  fe,
  newId,
  SheetSave,
  submitOffline,
} from "./shared";

type Severity = "low" | "medium" | "high" | "unsafe";

/** "Report vehicle issue" → admin alert with a response timer (SPEC M17). */
export function IssueSheet({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: SheetVehicle;
}) {
  const [clientId, setClientId] = useState(newId);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [canDrive, setCanDrive] = useState(true);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const formId = `issue-${clientId}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await submitOffline<{ id: string }>("vehicles.reportIssue", {
      vehicleId: vehicle.id,
      description,
      severity,
      canDrive,
      mediaIds: evidence?.mediaIds ?? [],
      clientId,
    });
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    toast({
      title: r.queued ? "Issue saved offline" : "Issue reported",
      message: r.queued
        ? "It will send when you're back online."
        : "Your admin has been alerted.",
      tone: r.queued ? "warning" : "success",
    });
    onOpenChange(false);
    setClientId(newId());
    setDescription("");
    setSeverity("medium");
    setCanDrive(true);
    setEvidence(null);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Report vehicle issue"
      dirty={description !== "" || !!evidence}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave
          form={formId}
          pending={pending}
          disabled={description.trim().length < 3}
        >
          Report issue
        </SheetSave>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        className="flex flex-col gap-4 pb-4 pt-1"
      >
        <p className="text-subhead text-label-2">{vehicle.nickname}</p>
        <TextArea
          label="What's wrong?"
          rows={3}
          placeholder="Check engine light came on, grinding when braking…"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          error={fe(errors, "description")}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">How serious?</span>
          <SegmentedControl
            label="Severity"
            value={severity}
            onChange={(v) => {
              setSeverity(v);
              if (v === "unsafe") setCanDrive(false);
            }}
            segments={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "unsafe", label: "Unsafe" },
            ]}
          />
        </div>
        <ul className="list-card">
          <li>
            <ToggleRow
              title="Safe to drive"
              subtitle={
                canDrive
                  ? "I can keep working today"
                  : "I need help or a replacement"
              }
              checked={canDrive}
              onChange={(e) => setCanDrive(e.currentTarget.checked)}
            />
          </li>
        </ul>
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Photos</span>
          <EvidenceCamera
            entityType="vehicle_issue"
            entityId={clientId}
            tag="problem"
            label="Add photo"
            multiple
            onChange={setEvidence}
          />
        </div>
        {error && !errors && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
