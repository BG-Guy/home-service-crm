"use client";

import { UserPlus, UserRoundPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import type { AssignJobButtonProps } from "../contracts";

const AssignSheet = dynamic(() => import("./AssignSheet"), {
  ssr: false,
});

/** S9: "Assign" button → techs with conflict hints, window, split (B2 `scheduleJob`). */
export function AssignJobButton({
  jobId,
  label = "Assign",
  variant = "tinted",
  iconOnly,
  size = "sm",
}: AssignJobButtonProps & {
  /** B2 addition: a round icon button (label as its accessible name), for list rows. */
  iconOnly?: boolean;
  /** B2 addition: `lg` for the bottom bar's primary. */
  size?: "sm" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const show = () => {
    setMounted(true);
    setOpen(true);
  };
  // Warm the chunk on intent.
  const warm = () => void import("./AssignSheet");
  return (
    <>
      {iconOnly ? (
        <IconButton
          label={label}
          variant="plain"
          size={36}
          onClick={show}
          onPointerEnter={warm}
        >
          <UserRoundPlus size={20} aria-hidden />
        </IconButton>
      ) : (
        <Button
          variant={variant}
          size={size}
          icon={<UserPlus size={size === "lg" ? 20 : 16} aria-hidden />}
          onClick={show}
          onPointerEnter={warm}
        >
          {label}
        </Button>
      )}
      {mounted && (
        <AssignSheet jobId={jobId} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
