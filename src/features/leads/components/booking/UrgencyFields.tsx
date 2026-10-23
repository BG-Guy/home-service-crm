"use client";

import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Toggle } from "@/ui/components/Toggle";
import type { LeadPriority } from "../../contracts";

const PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "emergency", label: "Emergency" },
] as const;

/**
 * Urgency (normal / urgent / emergency) and the after-hours switch, which carry
 * into the job at booking. Phones stack them (the segments keep their width);
 * wider screens put the switch beside the segments.
 */
export function UrgencyFields({
  priority,
  onPriority,
  afterHours,
  onAfterHours,
}: {
  priority: LeadPriority;
  onPriority: (p: LeadPriority) => void;
  afterHours: boolean;
  onAfterHours: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="px-1 text-footnote font-semibold text-label-2">
          Urgency
        </span>
        <SegmentedControl
          label="Urgency"
          value={priority}
          onChange={onPriority}
          segments={PRIORITIES}
        />
      </div>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant */}
      <label className="list-card flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2 sm:flex-col sm:items-center sm:gap-1.5 sm:bg-transparent sm:p-0 sm:shadow-none">
        <span className="flex flex-col sm:items-center">
          <span className="text-subhead font-semibold text-label sm:text-footnote sm:text-label-2">
            After hours
          </span>
          <span className="text-footnote text-label-2 sm:hidden">
            After-hours pricing and pay rules
          </span>
        </span>
        <Toggle
          checked={afterHours}
          onChange={(e) => onAfterHours(e.currentTarget.checked)}
        />
      </label>
    </div>
  );
}
