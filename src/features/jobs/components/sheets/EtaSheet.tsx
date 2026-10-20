"use client";

import { Car, Clock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { Sheet } from "@/ui/components/Sheet";
import { cx } from "@/ui/cx";
import { ETA_CHOICES } from "../../machine";

/** ETA chips (15/30/45/60) for On my way and Running late (SPEC M06). */
export default function EtaSheet({
  open,
  onOpenChange,
  mode,
  customerFirstName,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "on_my_way" | "late";
  customerFirstName: string | null;
  pending: boolean;
  onSubmit: (eta: number) => void;
}) {
  const [eta, setEta] = useState<number>(mode === "late" ? 15 : 30);
  const who = customerFirstName || "the customer";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "late" ? "Running late" : "On my way"}
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          loading={pending}
          icon={
            mode === "late" ? (
              <Clock size={20} aria-hidden />
            ) : (
              <Car size={20} aria-hidden />
            )
          }
          onClick={() => onSubmit(eta)}
        >
          {mode === "late"
            ? `Update ETA to ${eta} min`
            : `Head out · ${eta} min`}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-subhead text-label-2">
          {mode === "late"
            ? `We'll let ${who} know you're running behind.`
            : `We'll text ${who} that you're on the way, with a live tracking link.`}
        </p>
        <fieldset className="grid grid-cols-4 gap-2">
          <legend className="sr-only">Arriving in</legend>
          {ETA_CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={eta === m}
              onClick={() => setEta(m)}
              className={cx(
                "pressable flex min-h-[64px] flex-col items-center justify-center rounded-tile text-title3 font-semibold",
                eta === m
                  ? "bg-accent-fill text-on-accent"
                  : "bg-card shadow-[0_0_0_0.5px_var(--sep)]",
              )}
            >
              <span className="num">{m}</span>
              <span
                className={cx(
                  "text-caption font-medium",
                  eta === m ? "opacity-90" : "text-label-2",
                )}
              >
                min
              </span>
            </button>
          ))}
        </fieldset>
      </div>
    </Sheet>
  );
}
