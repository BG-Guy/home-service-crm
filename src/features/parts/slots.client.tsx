"use client";

import { PackagePlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type { AddPartButtonProps } from "./contracts";

// Client UI slots produced by B6 (BUILD_PLAN §5.1). Client slots take serializable
// props and call only B6's own actions. The sheet is a lazy chunk (loaded on tap).

const AddPartSheet = dynamic(() => import("./components/AddPartSheet"), {
  ssr: false,
});

/** S39 — Add part sheet (stock, price book, tech-paid, company card, special order). */
export function AddPartButton({
  jobId,
  mode = "any",
  label,
  variant = "tinted",
  size = "md",
  fullWidth,
}: AddPartButtonProps & {
  /** Optional (B6 additions). */
  variant?: "filled" | "tinted" | "gray" | "plain";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        icon={<PackagePlus size={18} aria-hidden />}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        {label ?? (mode === "special_order" ? "Order part" : "Add part")}
      </Button>
      {mounted && (
        <AddPartSheet
          jobId={jobId}
          mode={mode}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
