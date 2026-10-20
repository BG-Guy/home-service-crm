"use client";

import { Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type { TripDraft } from "./TripSheet";

const load = () => import("./TripSheet");
const TripSheet = dynamic(load, { ssr: false });

/** Trip trigger; the trip sheet's code loads on intent (hover/press) and mounts on first open. */
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
  const [n, setN] = useState(0);
  const show = () => {
    setN((x) => x + 1);
    setOpen(true);
  };
  const preload = () => void load();
  const intent = {
    onPointerEnter: preload,
    onPointerDown: preload,
    onFocus: preload,
  };
  return (
    <>
      {trip ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<Pencil size={15} aria-hidden />}
          onClick={show}
          {...intent}
        >
          {label ?? "Review"}
        </Button>
      ) : (
        <Button variant="tinted" size="sm" onClick={show} {...intent}>
          {label ?? "Add trip"}
        </Button>
      )}
      {n > 0 && (
        <TripSheet
          key={n}
          vehicleId={vehicleId}
          trip={trip}
          reimbursable={reimbursable}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
