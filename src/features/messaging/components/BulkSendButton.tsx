"use client";

import { Megaphone } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";

const load = () => import("./BulkSendSheet");
const BulkSendSheet = dynamic(load, { ssr: false });

/** "Bulk text" trigger; the sheet's code loads on intent and mounts on first open. */
export function BulkSendButton() {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const preload = () => void load();
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Megaphone aria-hidden size={16} />}
        onPointerEnter={preload}
        onPointerDown={preload}
        onFocus={preload}
        onClick={() => {
          setArmed(true);
          setOpen(true);
        }}
      >
        Bulk text
      </Button>
      {armed && <BulkSendSheet open={open} onOpenChange={setOpen} />}
    </>
  );
}
