"use client";

import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/ui/components/Sheet";
import type { TraceStep } from "../contracts";
import { Trace } from "./Trace";

/** Tappable amount → sheet with the "Why this amount?" breakdown. */
export function WhyAmount({
  title,
  steps,
  children,
  footnote,
}: {
  title: string;
  steps: TraceStep[];
  children: React.ReactNode;
  footnote?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-control text-left text-accent-text print:min-h-0 print:text-label"
        aria-label={`Why this amount: ${title}`}
      >
        {children}
        <HelpCircle
          size={16}
          aria-hidden
          className="shrink-0 opacity-70 print:hidden"
        />
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        detents={["content"]}
      >
        <div className="flex flex-col gap-3 pb-6 pt-1">
          <Trace steps={steps} />
          {footnote && <p className="text-footnote text-label-2">{footnote}</p>}
        </div>
      </Sheet>
    </>
  );
}
