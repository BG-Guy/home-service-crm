"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui/components/Button";

/** "Print / Save as PDF" on the customer pages (the browser's print dialog). */
export function PrintButton({
  label = "Print or save PDF",
  variant = "secondary",
  size = "md",
}: {
  label?: string;
  variant?: "secondary" | "plain" | "tinted";
  size?: "sm" | "md";
}) {
  return (
    <Button
      variant={variant}
      size={size}
      icon={<Printer size={18} aria-hidden />}
      onClick={() => window.print()}
      className="print:hidden"
    >
      {label}
    </Button>
  );
}
