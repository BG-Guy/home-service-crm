"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/ui/components/Sheet";

/** Phone / tablet: the day's windows in a sheet (its own chunk, loaded on first tap). */
export default function WindowSheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={["content"]}
      footer={footer}
      bodyClassName="pb-4 pt-1"
    >
      {children}
    </Sheet>
  );
}
