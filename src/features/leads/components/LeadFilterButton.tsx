"use client";

import { SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Chip } from "@/ui/components/Chip";
import type { LeadFilterState } from "./LeadFilterSheet";

const load = () => import("./LeadFilterSheet");
const LeadFilterSheet = dynamic(load, { ssr: false });

/** The Filter chip at the head of the status chips: sources, Mine, Overdue. */
export function LeadFilterButton({
  sources,
  current,
  base,
  counts,
}: {
  sources: { id: string; name: string }[];
  current: LeadFilterState;
  base: Record<string, string>;
  counts: { mine: number; overdue: number };
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const active =
    (current.mine ? 1 : 0) +
    (current.overdue ? 1 : 0) +
    (current.source ? 1 : 0);
  return (
    <>
      <span onPointerEnter={() => void load()} className="flex shrink-0">
        <Chip
          selected={active > 0}
          icon={<SlidersHorizontal size={15} aria-hidden />}
          count={active || undefined}
          onClick={() => {
            setArmed(true);
            setOpen(true);
          }}
        >
          Filter
        </Chip>
      </span>
      {armed && (
        <LeadFilterSheet
          open={open}
          onOpenChange={setOpen}
          sources={sources}
          current={current}
          base={base}
          counts={counts}
        />
      )}
    </>
  );
}
