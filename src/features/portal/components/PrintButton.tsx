"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui/components/Button";

/** "Print / Save as PDF" on the customer pages (the browser's print dialog). */
export function PrintButton({
  label = "Print or save PDF",
}: {
  label?: string;
}) {
  return (
    <Button
      variant="gray"
      size="md"
      icon={<Printer size={18} aria-hidden />}
      onClick={() => window.print()}
      className="print:hidden"
    >
      {label}
    </Button>
  );
}
