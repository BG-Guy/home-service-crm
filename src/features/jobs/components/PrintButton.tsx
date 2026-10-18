"use client";

import { Printer } from "lucide-react";
import { Button } from "@/ui/components/Button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button
      size="sm"
      variant="tinted"
      icon={<Printer size={16} aria-hidden />}
      onClick={() => window.print()}
    >
      {label}
    </Button>
  );
}
