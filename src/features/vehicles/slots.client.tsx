"use client";

import { Gauge } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type { OdometerCaptureButtonProps } from "./contracts";

// Client UI slots produced by B7 (BUILD_PLAN §5.1). They call only this module's
// actions; the sheet is a lazy chunk so hosts ship just the button.

const OdometerSheet = dynamic(
  () =>
    import("./components/sheets/OdometerSheet").then((m) => m.OdometerSheet),
  { ssr: false },
);

/**
 * S48 — Photo + typed odometer value. Creates `odometer_readings` (source `clock`
 * at clock in/out). `onRecorded(odometerReadingId)` fires with the new row id —
 * also when the reading was queued offline (the id is the clientId, which the
 * server uses as the row id on replay).
 */
export function OdometerCaptureButton({
  vehicleId,
  source,
  label = "Log odometer",
  onRecorded,
  variant = "tinted",
  fullWidth,
  vehicleName,
  lastOdometer,
  approvalHint,
}: OdometerCaptureButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        fullWidth={fullWidth}
        icon={<Gauge size={16} aria-hidden />}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {mounted && (
        <OdometerSheet
          open={open}
          onOpenChange={setOpen}
          vehicle={{
            id: vehicleId,
            nickname: vehicleName ?? "Vehicle",
            odometer: lastOdometer ?? null,
            tankGal: null,
          }}
          source={source}
          title={source === "clock" ? "Odometer for the clock" : "Log odometer"}
          onDone={onRecorded}
          approvalHint={approvalHint}
        />
      )}
    </>
  );
}
