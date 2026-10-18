"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { HOLD_REASON_LABEL } from "../../machine";

/** Put a job on hold (waiting for parts / approval / another day). */
export default function HoldSheet({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onSubmit: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState("waiting_parts");
  const [note, setNote] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Put on hold"
      detents={["content", "large"]}
      dirty={note.trim() !== ""}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          loading={pending}
          onClick={() => onSubmit(reason, note)}
        >
          Put on hold
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-4">
        <ListSection header="Why">
          {Object.entries(HOLD_REASON_LABEL).map(([k, label]) => (
            <ListRow
              key={k}
              title={label}
              onClick={() => setReason(k)}
              accessory={reason === k ? "check" : "none"}
            />
          ))}
        </ListSection>
        <TextArea
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Part #, who we're waiting on, next steps…"
        />
      </div>
    </Sheet>
  );
}
