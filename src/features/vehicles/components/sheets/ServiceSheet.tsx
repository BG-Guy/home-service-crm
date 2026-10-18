"use client";

import { Wrench } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/ui/components/Button";
import { Chip } from "@/ui/components/Chip";
import { DateField, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { logService } from "../../actions";
import { taskFromInput } from "../../rules";
import type { SheetVehicle } from "./OdometerSheet";
import { type Evidence, EvidenceCamera, fe, newId, SheetSave } from "./shared";

const TASKS = [
  { key: "oil_change", label: "Oil change" },
  { key: "tire_rotation", label: "Tire rotation" },
  { key: "brakes", label: "Brakes" },
  { key: "brake_inspection", label: "Brake inspection" },
  { key: "inspection", label: "State inspection" },
  { key: "battery", label: "Battery" },
  { key: "wipers", label: "Wipers" },
  { key: "alignment", label: "Alignment" },
];

const fmt = new Intl.NumberFormat("en-US");

/** Service record: tasks, date, odometer, vendor, cost and the shop invoice. */
export function ServiceSheet({
  open,
  onOpenChange,
  vehicle,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: SheetVehicle;
  today: string;
}) {
  const [clientId, setClientId] = useState(newId);
  const [tasks, setTasks] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [performedOn, setPerformedOn] = useState(today);
  const [odometer, setOdometer] = useState("");
  const [vendor, setVendor] = useState("");
  const [costCents, setCostCents] = useState<number | null>(null);
  const [paidBy, setPaidBy] = useState<"company" | "tech">("company");
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const formId = `svc-${clientId}`;

  const [state, run, pending] = useActionState(
    async (_prev: unknown, _fd: FormData) => {
      const all = [...tasks, ...(custom.trim() ? [taskFromInput(custom)] : [])];
      const r = await logService({
        vehicleId: vehicle.id,
        tasks: all,
        performedOn,
        odometer: odometer ? Number(odometer.replace(/[^\d]/g, "")) : null,
        vendor: vendor || null,
        costCents,
        paidBy,
        receiptMediaId: evidence?.mediaIds[0] ?? null,
        notes: notes || null,
        clientId,
      });
      if (r.ok) {
        toast({
          title:
            r.data?.status === "approved"
              ? "Service logged"
              : "Service sent for review",
          message:
            r.data?.status === "approved"
              ? "Reminders were reset."
              : "Reminders reset once an admin approves it.",
          tone: r.data?.status === "approved" ? "success" : "default",
        });
        onOpenChange(false);
        setClientId(newId());
        setTasks([]);
        setCustom("");
        setOdometer("");
        setVendor("");
        setCostCents(null);
        setNotes("");
        setEvidence(null);
      }
      return r;
    },
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const toggle = (k: string) =>
    setTasks((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log service"
      dirty={tasks.length > 0 || !!evidence || costCents != null}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave
          form={formId}
          pending={pending}
          disabled={tasks.length === 0 && !custom.trim()}
        >
          Save service
        </SheetSave>
      }
    >
      <form id={formId} action={run} className="flex flex-col gap-4 pb-4 pt-1">
        <p className="flex items-center gap-2 text-subhead text-label-2">
          <Wrench aria-hidden size={18} /> {vehicle.nickname}
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-subhead font-semibold">
            What was done?
          </legend>
          <div className="flex flex-wrap gap-2">
            {TASKS.map((t) => (
              <Chip
                key={t.key}
                selected={tasks.includes(t.key)}
                onClick={() => toggle(t.key)}
              >
                {t.label}
              </Chip>
            ))}
          </div>
          <TextField
            label="Other"
            hideLabel
            placeholder="Other service (optional)"
            value={custom}
            onChange={(e) => setCustom(e.currentTarget.value)}
          />
          {fe(errors, "tasks") && (
            <p role="alert" className="text-footnote text-danger">
              {fe(errors, "tasks")}
            </p>
          )}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <DateField
            label="Date"
            value={performedOn}
            max={today}
            onChange={(e) => setPerformedOn(e.currentTarget.value)}
            error={fe(errors, "performedOn")}
          />
          <TextField
            label="Odometer"
            inputMode="numeric"
            placeholder={
              vehicle.odometer != null ? fmt.format(vehicle.odometer) : "Miles"
            }
            value={odometer}
            onChange={(e) => {
              const d = e.currentTarget.value.replace(/[^\d]/g, "").slice(0, 7);
              setOdometer(d ? fmt.format(Number(d)) : "");
            }}
            error={fe(errors, "odometer")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Shop"
            placeholder="Jiffy Lube"
            value={vendor}
            onChange={(e) => setVendor(e.currentTarget.value)}
          />
          <MoneyField
            label="Cost"
            valueCents={costCents}
            onChangeCents={setCostCents}
            error={fe(errors, "costCents")}
          />
        </div>
        <SegmentedControl
          label="Who paid"
          value={paidBy}
          onChange={setPaidBy}
          segments={[
            { value: "company", label: "Company paid" },
            { value: "tech", label: "I paid" },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Shop invoice</span>
          <EvidenceCamera
            entityType="service"
            entityId={clientId}
            tag="receipt"
            kind="receipt"
            label="Photo of invoice"
            onChange={setEvidence}
          />
        </div>
        <TextArea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
        {state && !state.ok && !errors && (
          <p role="alert" className="text-footnote text-danger">
            {state.error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
