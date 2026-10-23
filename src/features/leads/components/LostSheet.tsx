"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { Chip } from "@/ui/components/Chip";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { markLeadLost } from "../actions";
import { lostReasonLabel } from "../labels";
import { useLeadChanges } from "./use-lead-changes";

/**
 * "Why was it lost?" with a configurable reason (settings.leads.lost_reasons).
 * Saving shows "Marked lost" with Undo (and the lead keeps Reopen).
 */
export function LostSheet({
  leadId,
  reasons,
  open,
  onOpenChange,
}: {
  leadId: string;
  reasons: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = useLeadChanges();
  const save = async () => {
    if (!reason) return;
    setSaving(true);
    const r = await markLeadLost({ leadId, reason, note });
    setSaving(false);
    if (!r.ok) return void setError(r.error);
    onOpenChange(false);
    changes.announce(leadId, "Marked lost", r.data?.eventId ?? null);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Why was it lost?"
      detents={["content", "large"]}
      onClosed={() => {
        setReason(null);
        setNote("");
        setError(null);
      }}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant="destructive"
            size="lg"
            block
            disabled={!reason}
            loading={saving}
            onClick={save}
          >
            Mark lost
          </Button>
          <Button
            variant="plain"
            size="md"
            block
            className="text-label-2"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-subhead text-label-2">
          Kept for your reports. You can reopen it any time.
        </p>
        {/* biome-ignore lint/a11y/useSemanticElements: chip group, not a form fieldset */}
        <div role="group" aria-label="Reason" className="flex flex-wrap gap-2">
          {reasons.map((r) => (
            <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>
              {lostReasonLabel(r)}
            </Chip>
          ))}
        </div>
        <TextArea
          label="Note"
          placeholder="Optional"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
