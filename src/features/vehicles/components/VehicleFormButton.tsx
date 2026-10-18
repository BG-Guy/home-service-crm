"use client";

import { Pencil, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { useOpenOnParam } from "./useOpenOnParam";
import type { VehicleFormProps } from "./VehicleForm";

const VehicleForm = dynamic(() => import("./VehicleForm"), { ssr: false });

/**
 * "+" (new) or "Edit" trigger; the form sheet is a lazy chunk. In `new` mode
 * `/vehicles?new=vehicle` (the global "+" menu) opens the form; `hideTrigger`
 * keeps only that deep link when the "+" menu already offers "New Vehicle".
 */
export function VehicleFormButton({
  mode,
  hideTrigger = false,
  ...props
}: Omit<VehicleFormProps, "open" | "onOpenChange"> & {
  mode: "new" | "edit" | "new-inline";
  hideTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const show = () => {
    setMounted(true);
    setOpen(true);
  };
  useOpenOnParam("new", "vehicle", show, mode === "new");
  return (
    <>
      {hideTrigger ? null : mode === "new" ? (
        <IconButton label="Add vehicle" onClick={show}>
          <Plus size={22} aria-hidden />
        </IconButton>
      ) : mode === "new-inline" ? (
        <Button icon={<Plus size={18} aria-hidden />} onClick={show}>
          Add vehicle
        </Button>
      ) : (
        <Button
          variant="plain"
          size="sm"
          icon={<Pencil size={16} aria-hidden />}
          onClick={show}
        >
          Edit
        </Button>
      )}
      {mounted && <VehicleForm {...props} open={open} onOpenChange={setOpen} />}
    </>
  );
}
