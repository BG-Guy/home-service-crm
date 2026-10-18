"use client";

import { Printer } from "lucide-react";
import { IconButton } from "@/ui/components/IconButton";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <IconButton label={label} onClick={() => window.print()}>
      <Printer size={20} aria-hidden />
    </IconButton>
  );
}
