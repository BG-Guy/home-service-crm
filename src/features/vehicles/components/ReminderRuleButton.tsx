"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type { ReminderRuleDto } from "../contracts";

const load = () => import("./ReminderRuleSheet");
const ReminderRuleSheet = dynamic(load, { ssr: false });

/** Add / edit a reminder rule. The sheet's code loads on intent and mounts on first open. */
export function ReminderRuleButton({
  vehicleId,
  rule,
  children,
}: {
  vehicleId: string;
  rule?: ReminderRuleDto;
  children?: React.ReactNode;
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
      {children ? (
        <button
          type="button"
          className="w-full text-left"
          onClick={show}
          {...intent}
        >
          {children}
        </button>
      ) : (
        <Button
          variant="plain"
          size="sm"
          icon={<Plus size={16} aria-hidden />}
          onClick={show}
          {...intent}
        >
          Add reminder
        </Button>
      )}
      {n > 0 && (
        <ReminderRuleSheet
          key={n}
          vehicleId={vehicleId}
          rule={rule}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
