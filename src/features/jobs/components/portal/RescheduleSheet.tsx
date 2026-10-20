"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";

/** The portal's "Request a new time" sheet (lazy chunk, first tap only). */
export default function RescheduleSheet({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Request a new time"
      detents={["content"]}
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
          onClick={() => onSubmit(note)}
        >
          Send request
        </Button>
      }
    >
      <div className="px-4 pb-4">
        <TextArea
          label="Anything we should know? (optional)"
          placeholder="e.g. Mornings work best next week"
          value={note}
          maxLength={1000}
          rows={4}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Sheet>
  );
}
