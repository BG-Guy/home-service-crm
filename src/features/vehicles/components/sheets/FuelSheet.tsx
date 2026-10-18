"use client";

import { Fuel } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import type { SheetVehicle } from "./OdometerSheet";
import {
  type Evidence,
  EvidenceCamera,
  fe,
  newId,
  SheetSave,
  submitOffline,
  toastLogged,
} from "./shared";

const fmt = new Intl.NumberFormat("en-US");

/** Fuel log: gallons, total, odometer and the receipt (tech-paid → reimbursement). */
export function FuelSheet({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: SheetVehicle;
}) {
  const [clientId, setClientId] = useState(newId);
  const [gallons, setGallons] = useState("");
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [odometer, setOdometer] = useState("");
  const [paidBy, setPaidBy] = useState<"company" | "tech">("company");
  const [vendor, setVendor] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const formId = `fuel-${clientId}`;
  const gal = Number(gallons);
  const overTank = vehicle.tankGal != null && gal > vehicle.tankGal;
  const odo = Number(odometer.replace(/[^\d]/g, ""));
  const ppg = gal > 0 && totalCents ? totalCents / 100 / gal : null;

  const reset = () => {
    setClientId(newId());
    setGallons("");
    setTotalCents(null);
    setOdometer("");
    setVendor("");
    setEvidence(null);
    setErrors(undefined);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await submitOffline<{
      id: string;
      status: string;
      flags: string[];
    }>("vehicles.logFuel", {
      vehicleId: vehicle.id,
      gallons: gal,
      totalCents: totalCents ?? 0,
      odometer: odometer ? odo : null,
      paidBy,
      vendor: vendor || null,
      receiptMediaId: evidence?.mediaIds[0] ?? null,
      clientId,
    });
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    toastLogged("Fuel", r);
    onOpenChange(false);
    reset();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log fuel"
      dirty={gallons !== "" || totalCents != null || !!evidence}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave
          form={formId}
          pending={pending}
          disabled={!gal || !totalCents}
        >
          Save fuel
        </SheetSave>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        className="flex flex-col gap-4 pb-4 pt-1"
      >
        <p className="flex items-center gap-2 text-subhead text-label-2">
          <Fuel aria-hidden size={18} />
          {vehicle.nickname}
          {vehicle.tankGal != null && ` · ${vehicle.tankGal} gal tank`}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Gallons"
            inputMode="decimal"
            placeholder="18.4"
            value={gallons}
            onChange={(e) =>
              setGallons(
                e.currentTarget.value.replace(/[^\d.]/g, "").slice(0, 7),
              )
            }
            error={
              fe(errors, "gallons") ??
              (overTank ? "More than the tank holds" : undefined)
            }
          />
          <MoneyField
            label="Total"
            valueCents={totalCents}
            onChangeCents={setTotalCents}
            error={fe(errors, "totalCents")}
            hint={ppg ? `$${ppg.toFixed(3)}/gal` : undefined}
          />
        </div>
        <TextField
          label="Odometer (miles)"
          inputMode="numeric"
          placeholder={
            vehicle.odometer != null ? fmt.format(vehicle.odometer) : "Optional"
          }
          value={odometer}
          onChange={(e) => {
            const d = e.currentTarget.value.replace(/[^\d]/g, "").slice(0, 7);
            setOdometer(d ? fmt.format(Number(d)) : "");
          }}
          hint="Adds MPG tracking."
          error={fe(errors, "odometer")}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Who paid?</span>
          <SegmentedControl
            label="Who paid"
            value={paidBy}
            onChange={setPaidBy}
            segments={[
              { value: "company", label: "Company card" },
              { value: "tech", label: "I paid" },
            ]}
          />
          {paidBy === "tech" && (
            <p className="text-footnote text-label-2">
              We'll add a reimbursement for approval. Keep the receipt photo
              clear.
            </p>
          )}
        </div>
        <TextField
          label="Station"
          placeholder="Optional"
          value={vendor}
          onChange={(e) => setVendor(e.currentTarget.value)}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Receipt</span>
          <EvidenceCamera
            entityType="fuel"
            entityId={clientId}
            tag="receipt"
            label="Photo of receipt"
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
