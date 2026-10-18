"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import type { CallOutcome } from "../contracts";

export const CALL_OUTCOMES: {
  value: CallOutcome;
  label: string;
  hint?: string;
}[] = [
  { value: "connected", label: "Connected", hint: "We talked" },
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "busy", label: "Busy" },
  { value: "wrong_number", label: "Wrong number" },
];

/**
 * "How did the call go?" sheet shown after a tel: tap. The caller decides what
 * saving does (customer call log, or the lead flow that also drafts a follow-up).
 */
export function CallOutcomeSheet({
  open,
  onOpenChange,
  title = "How did the call go?",
  footnote,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  footnote?: string;
  onSave: (v: { outcome: CallOutcome; notes: string }) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const reset = () => {
    setOutcome(null);
    setNotes("");
    setSaving(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={["content", "large"]}
      onClosed={reset}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Skip
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          disabled={!outcome || saving}
          loading={saving}
          onClick={async () => {
            if (!outcome) return;
            setSaving(true);
            const ok = await onSave({ outcome, notes });
            setSaving(false);
            if (ok) onOpenChange(false);
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)] pb-4">
        <ListSection footer={footnote}>
          {CALL_OUTCOMES.map((o) => (
            <ListRow
              key={o.value}
              title={o.label}
              subtitle={o.hint}
              accessory={outcome === o.value ? "check" : "none"}
              onClick={() => setOutcome(o.value)}
            />
          ))}
        </ListSection>
        <TextArea
          label="Notes"
          placeholder="Optional — what did they say?"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          rows={2}
        />
      </div>
    </Sheet>
  );
}
