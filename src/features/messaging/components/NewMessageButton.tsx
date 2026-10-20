"use client";

import { SquarePen } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";

const load = () => import("./NewMessageSheet");
const NewMessageSheet = dynamic(load, { ssr: false });

/** "New message" trigger; the picker + composer sheet loads on intent. */
export function NewMessageButton({
  variant = "icon",
}: {
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const preload = () => void load();
  const show = () => {
    setArmed(true);
    setOpen(true);
  };
  const intent = {
    onPointerEnter: preload,
    onPointerDown: preload,
    onFocus: preload,
  };
  return (
    <>
      {variant === "icon" ? (
        <IconButton label="New message" onClick={show} {...intent}>
          <SquarePen aria-hidden size={22} />
        </IconButton>
      ) : (
        <Button
          variant="primary"
          icon={<SquarePen aria-hidden size={18} />}
          onClick={show}
          {...intent}
        >
          New message
        </Button>
      )}
      {armed && <NewMessageSheet open={open} onOpenChange={setOpen} />}
    </>
  );
}
