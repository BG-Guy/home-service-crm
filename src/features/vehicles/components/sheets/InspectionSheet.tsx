"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { cx } from "@/ui/cx";
import { INSPECTION_ITEMS } from "../../rules";
import type { SheetVehicle } from "./OdometerSheet";
import {
  type Evidence,
  EvidenceCamera,
  newId,
  SheetSave,
  submitOffline,
  toastLogged,
} from "./shared";

type Results = Record<string, { ok: boolean; note?: string | null }>;

/** DVIR-lite walk-around: pass/fail per item, damage photos when something fails. */
export function InspectionSheet({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: SheetVehicle;
}) {
  const [clientId, setClientId] = useState(newId);
  const [results, setResults] = useState<Results>({});
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = INSPECTION_ITEMS.every((i) => results[i.key]);
  const failed = Object.values(results).filter((r) => !r.ok).length;
  const formId = `insp-${clientId}`;

  const set = (key: string, ok: boolean) =>
    setResults((r) => ({ ...r, [key]: { ok, note: r[key]?.note ?? null } }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!done) {
      setError("Check every item first.");
      return;
    }
    if (failed > 0 && !evidence?.clientIds.length) {
      setError("Add a photo of what failed.");
      return;
    }
    setPending(true);
    setError(null);
    const r = await submitOffline<{ id: string; status: string }>(
      "vehicles.submitInspection",
      {
        vehicleId: vehicle.id,
        results,
        mediaIds: evidence?.mediaIds ?? [],
        clientId,
      },
    );
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toastLogged("Inspection", r);
    onOpenChange(false);
    setClientId(newId());
    setResults({});
    setEvidence(null);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Vehicle inspection"
      dirty={Object.keys(results).length > 0}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave form={formId} pending={pending} disabled={!done}>
          {failed > 0
            ? `Submit (${failed} issue${failed === 1 ? "" : "s"})`
            : "All good — submit"}
        </SheetSave>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        className="flex flex-col gap-4 pb-4 pt-1"
      >
        <p className="text-subhead text-label-2">{vehicle.nickname}</p>
        <ul className="list-card">
          {INSPECTION_ITEMS.map((item) => {
            const r = results[item.key];
            return (
              <li
                key={item.key}
                className="list-row flex flex-col gap-2 px-4 py-2.5"
              >
                <div className="flex min-h-11 items-center gap-3">
                  <span className="flex-1 text-body">{item.label}</span>
                  <fieldset
                    className="m-0 flex gap-2 border-0 p-0"
                    aria-label={item.label}
                  >
                    <button
                      type="button"
                      aria-pressed={r?.ok === true}
                      aria-label={`${item.label}: OK`}
                      onClick={() => set(item.key, true)}
                      className={cx(
                        "pressable flex size-11 items-center justify-center rounded-full",
                        r?.ok === true
                          ? "bg-[var(--sys-green)] text-white"
                          : "bg-fill-2 text-label-2",
                      )}
                    >
                      <Check size={20} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-pressed={r?.ok === false}
                      aria-label={`${item.label}: problem`}
                      onClick={() => set(item.key, false)}
                      className={cx(
                        "pressable flex size-11 items-center justify-center rounded-full",
                        r?.ok === false
                          ? "bg-danger-fill text-white"
                          : "bg-fill-2 text-label-2",
                      )}
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </fieldset>
                </div>
                {r?.ok === false && (
                  <TextField
                    label={`What's wrong with ${item.label.toLowerCase()}?`}
                    hideLabel
                    placeholder="What's wrong?"
                    value={r.note ?? ""}
                    onChange={(e) => {
                      const note = e.currentTarget.value;
                      setResults((x) => ({
                        ...x,
                        [item.key]: { ok: false, note },
                      }));
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {failed > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-subhead font-semibold">
              Photos of the problem
            </span>
            <EvidenceCamera
              entityType="inspection"
              entityId={clientId}
              tag="problem"
              label="Take photo"
              multiple
              onChange={setEvidence}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
