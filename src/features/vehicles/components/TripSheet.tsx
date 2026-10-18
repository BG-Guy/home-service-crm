"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { DateField } from "@/ui/components/DatePicker";
import { TextField } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { saveTrip } from "../actions";
import { fe } from "./sheets/shared";

export interface TripDraft {
  id?: string;
  tripDate: string;
  startOdometer: number | null;
  endOdometer: number | null;
  miles: number;
  purpose: string | null;
  classification: "business" | "commute" | "personal";
}

const CLASSES = [
  { value: "business", label: "Business" },
  { value: "commute", label: "Commute" },
  { value: "personal", label: "Personal" },
] as const;

/** IRS-style trip entry (Pub 463): date, start/stop odometer, purpose, classification. */
export function TripButton({
  vehicleId,
  trip,
  label,
  reimbursable,
}: {
  vehicleId: string;
  trip?: TripDraft;
  label?: string;
  /** Tech-owned vehicle: business miles become a mileage reimbursement. */
  reimbursable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<TripDraft>(
    () =>
      trip ?? {
        tripDate: new Date().toISOString().slice(0, 10),
        startOdometer: null,
        endOdometer: null,
        miles: 0,
        purpose: null,
        classification: "business",
      },
  );
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, start] = useTransition();
  const str = (n: number | null) => (n == null ? "" : String(n));
  const int = (s: string) => {
    const d = s.replace(/[^\d]/g, "");
    return d ? Number(d) : null;
  };
  const computed =
    t.startOdometer != null && t.endOdometer != null
      ? t.endOdometer - t.startOdometer
      : null;

  const save = (submit: boolean) =>
    start(async () => {
      const r = await saveTrip({
        id: t.id,
        vehicleId,
        tripDate: t.tripDate,
        startOdometer: t.startOdometer,
        endOdometer: t.endOdometer,
        miles: computed ?? t.miles,
        purpose: t.purpose,
        classification: t.classification,
        submit,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors);
        if (!r.fieldErrors) toast({ title: r.error, tone: "error" });
        return;
      }
      setOpen(false);
      toast({
        title: submit
          ? r.data?.status === "approved"
            ? "Trip approved"
            : "Trip sent for review"
          : "Trip saved",
        tone: "success",
      });
    });

  return (
    <>
      {trip ? (
        <Button
          variant="gray"
          size="sm"
          icon={<Pencil size={15} aria-hidden />}
          onClick={() => setOpen(true)}
        >
          {label ?? "Review"}
        </Button>
      ) : (
        <Button variant="tinted" size="sm" onClick={() => setOpen(true)}>
          {label ?? "Add trip"}
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={trip ? "Trip" : "New trip"}
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <div className="flex gap-2">
            <Button
              variant="gray"
              size="lg"
              className="flex-1"
              loading={pending}
              onClick={() => save(false)}
            >
              Save draft
            </Button>
            <Button
              size="lg"
              className="flex-1"
              loading={pending}
              onClick={() => save(true)}
            >
              Submit
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 pb-4 pt-1">
          <DateField
            label="Date"
            value={t.tripDate}
            onChange={(e) => setT({ ...t, tripDate: e.currentTarget.value })}
            error={fe(errors, "tripDate")}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Start odometer"
              inputMode="numeric"
              value={str(t.startOdometer)}
              onChange={(e) =>
                setT({ ...t, startOdometer: int(e.currentTarget.value) })
              }
              error={fe(errors, "startOdometer")}
            />
            <TextField
              label="End odometer"
              inputMode="numeric"
              value={str(t.endOdometer)}
              onChange={(e) =>
                setT({ ...t, endOdometer: int(e.currentTarget.value) })
              }
              error={fe(errors, "endOdometer")}
            />
          </div>
          <TextField
            label="Miles"
            inputMode="decimal"
            value={computed != null ? String(computed) : String(t.miles || "")}
            disabled={computed != null}
            hint={
              computed != null
                ? "Calculated from the odometer readings."
                : "Use start and end readings when you have them."
            }
            onChange={(e) =>
              setT({
                ...t,
                miles:
                  Number(e.currentTarget.value.replace(/[^\d.]/g, "")) || 0,
              })
            }
            error={fe(errors, "miles")}
          />
          <SegmentedControl
            label="Classification"
            value={t.classification}
            segments={CLASSES}
            onChange={(v) => setT({ ...t, classification: v })}
          />
          <TextField
            label="Business purpose"
            placeholder="Service calls: lockout, rekey"
            value={t.purpose ?? ""}
            onChange={(e) =>
              setT({ ...t, purpose: e.currentTarget.value || null })
            }
            error={fe(errors, "purpose")}
          />
          <p className="text-footnote text-label-2">
            {reimbursable
              ? "Your own vehicle: approved business miles are reimbursed at the IRS rate."
              : "Commute and personal miles are logged but never reimbursed."}
          </p>
        </div>
      </Sheet>
    </>
  );
}
