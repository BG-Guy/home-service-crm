"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { ToggleRow } from "@/ui/components/Toggle";

export interface LeadFilterState {
  mine: boolean;
  overdue: boolean;
  source: string | null;
}

/**
 * The inbox filter sheet (leads-flow item 1): sources moved here from the chip
 * row, with Mine and Overdue. A lazy chunk of the Filter chip.
 */
export default function LeadFilterSheet({
  open,
  onOpenChange,
  sources,
  current,
  base,
  counts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: { id: string; name: string }[];
  current: LeadFilterState;
  /** The query to keep (view, search). */
  base: Record<string, string>;
  counts: { mine: number; overdue: number };
}) {
  const router = useRouter();
  const [f, setF] = useState<LeadFilterState>(current);
  const apply = (next: LeadFilterState) => {
    const sp = new URLSearchParams(base);
    if (next.mine) sp.set("mine", "1");
    if (next.overdue) sp.set("overdue", "1");
    if (next.source) sp.set("source", next.source);
    const qs = sp.toString();
    onOpenChange(false);
    router.replace(qs ? `/leads?${qs}` : "/leads", { scroll: false });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filter leads"
      detents={["content", "large"]}
      onClosed={() => setF(current)}
      leading={
        <Button
          variant="plain"
          size="sm"
          onClick={() => apply({ mine: false, overdue: false, source: null })}
        >
          Clear
        </Button>
      }
      footer={
        <Button size="lg" block onClick={() => apply(f)}>
          Show leads
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)] pb-2">
        <ListSection header="Whose">
          <div className="px-4 py-3">
            <SegmentedControl
              label="Whose leads"
              value={f.mine ? "mine" : "all"}
              onChange={(v) => setF({ ...f, mine: v === "mine" })}
              segments={[
                { value: "all", label: "Everyone's" },
                { value: "mine", label: `Mine · ${counts.mine}` },
              ]}
            />
          </div>
        </ListSection>
        <ListSection
          header="Waiting"
          footer="New leads nobody has answered within your reply target."
        >
          <ToggleRow
            title="Overdue only"
            subtitle={`${counts.overdue} right now`}
            checked={f.overdue}
            onChange={(e) => setF({ ...f, overdue: e.currentTarget.checked })}
          />
        </ListSection>
        <ListSection header="Source">
          <ListRow
            title="Every source"
            accessory={f.source ? "none" : "check"}
            onClick={() => setF({ ...f, source: null })}
          />
          {sources.map((s) => (
            <ListRow
              key={s.id}
              title={s.name}
              accessory={f.source === s.id ? "check" : "none"}
              onClick={() => setF({ ...f, source: s.id })}
            />
          ))}
        </ListSection>
      </div>
    </Sheet>
  );
}
