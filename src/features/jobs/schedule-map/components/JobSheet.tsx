"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/ui/components/Sheet";

// A stop's details in the kit Sheet: the bottom sheet on phones (M4), a right
// drawer on wider screens in full screen (M4d). Lazy chunk, loaded on the first
// job opened there, so the Sheet code stays out of the route JS.
export default function JobSheet({
  open,
  title,
  onClose,
  drawer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Wider screens: a right drawer, so the map stays visible beside it. */
  drawer?: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      detents={["medium", "large"]}
      presentation={drawer ? "drawer" : "modal"}
    >
      {children}
    </Sheet>
  );
}
