"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui/components/Button";

/** Opens the browser print dialog (Save as PDF works everywhere). */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button
      size="sm"
      variant="tinted"
      icon={<Printer size={16} aria-hidden />}
      onClick={() => window.print()}
      className="print:hidden"
    >
      {label}
    </Button>
  );
}
