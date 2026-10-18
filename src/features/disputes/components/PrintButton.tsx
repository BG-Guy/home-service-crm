"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui/components/Button";

/** Print → "Save as PDF" (the default PDF path; no server renderer needed). */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button
      size="sm"
      variant="plain"
      icon={<Printer size={17} />}
      onClick={() => window.print()}
    >
      {label}
    </Button>
  );
}
