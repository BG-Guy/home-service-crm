"use client";

import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";

/** "Resolve issue" sheet, loaded on first open by IssueActions. */
export default function ResolveIssueSheet({
  open,
  onOpenChange,
  pending,
  error,
  resolution,
  onResolution,
  onResolve,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error?: string;
  resolution: string;
  onResolution: (v: string) => void;
  onResolve: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Resolve issue"
      detents={["medium"]}
      dirty={resolution !== ""}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button size="lg" fullWidth loading={pending} onClick={onResolve}>
          Mark resolved
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-4 pt-1">
        <TextArea
          label="How was it fixed?"
          placeholder="Replaced O2 sensor at Valley Auto; light cleared."
          value={resolution}
          onChange={(e) => onResolution(e.currentTarget.value)}
          error={error}
          rows={4}
        />
      </div>
    </Sheet>
  );
}
