"use client";

import { Gauge } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { type ApprovalHint, odometerHintCopy } from "../../rules";
import {
  type Evidence,
  EvidenceCamera,
  fe,
  newId,
  SheetSave,
  submitOffline,
  toastLogged,
} from "./shared";

export interface SheetVehicle {
  id: string;
  nickname: string;
  odometer: number | null;
  tankGal: number | null;
}

const fmt = new Intl.NumberFormat("en-US");

/** Odometer log: typed value + photo evidence (AI cross-checks it when enabled). */
export function OdometerSheet({
  open,
  onOpenChange,
  vehicle,
  source = "manual",
  title = "Log odometer",
  onDone,
  approvalHint,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: SheetVehicle;
  source?: "manual" | "clock";
  title?: string;
  onDone?: (readingId: string) => void;
  /** What happens on save for this viewer (from `approvalHint`); copy only. */
  approvalHint?: ApprovalHint;
}) {
  const [clientId, setClientId] = useState(newId);
  const [value, setValue] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setClientId(newId());
    setValue("");
    setEvidence(null);
    setErrors(undefined);
    setError(null);
  };

  const n = Number(value.replace(/[^\d]/g, ""));
  const below =
    vehicle.odometer != null && value !== "" && n < vehicle.odometer;
  const formId = `odo-${clientId}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) {
      setErrors({ value: ["Enter the odometer."] });
      return;
    }
    setPending(true);
    setError(null);
    const r = await submitOffline<{
      id: string;
      status: string;
      flags: string[];
    }>("vehicles.logOdometer", {
      vehicleId: vehicle.id,
      value: n,
      source,
      photoMediaId: evidence?.mediaIds[0] ?? null,
      clientId,
    });
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    toastLogged("Odometer", r);
    onDone?.(r.data?.id ?? clientId);
    onOpenChange(false);
    reset();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={["large"]}
      dirty={value !== "" || !!evidence}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave form={formId} pending={pending || !!evidence?.busy}>
          Save reading
        </SheetSave>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        className="flex flex-col gap-4 pb-4 pt-1"
      >
        <p className="flex items-center gap-2 text-subhead text-label-2">
          <Gauge aria-hidden size={18} />
          {vehicle.nickname}
          {vehicle.odometer != null &&
            ` · last ${fmt.format(vehicle.odometer)} mi`}
        </p>
        <TextField
          label="Odometer (miles)"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={
            vehicle.odometer != null ? fmt.format(vehicle.odometer) : "48,210"
          }
          value={value}
          onChange={(e) => {
            const digits = e.currentTarget.value
              .replace(/[^\d]/g, "")
              .slice(0, 7);
            setValue(digits ? fmt.format(Number(digits)) : "");
          }}
          error={fe(errors, "value")}
          hint={
            below
              ? "That's lower than the last reading — double-check the photo."
              : "Type the total miles, not the trip meter."
          }
          className="text-title2"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">
            Photo of the dashboard
          </span>
          <EvidenceCamera
            entityType="odometer"
            entityId={clientId}
            tag="odometer"
            label="Take photo"
            onChange={setEvidence}
          />
          <p className="text-footnote text-label-2">
            {odometerHintCopy(approvalHint)}
          </p>
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
