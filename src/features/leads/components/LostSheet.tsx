"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { markLeadLost } from "../actions";
import { lostReasonLabel } from "../labels";

/** "Mark lost" with a configurable reason (settings.leads.lost_reasons). */
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
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Why was it lost?"
      detents={["content", "large"]}
      onClosed={() => {
        setReason(null);
        setNote("");
      }}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          disabled={!reason || saving}
          loading={saving}
          onClick={async () => {
            if (!reason) return;
            setSaving(true);
            const r = await markLeadLost({ leadId, reason, note });
            setSaving(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Marked lost");
            onOpenChange(false);
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)] pb-4">
        <ListSection>
          {reasons.map((r) => (
            <ListRow
              key={r}
              title={lostReasonLabel(r)}
              accessory={reason === r ? "check" : "none"}
              onClick={() => setReason(r)}
            />
          ))}
        </ListSection>
        <TextArea
          label="Note"
          placeholder="Optional"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>
    </Sheet>
  );
}
