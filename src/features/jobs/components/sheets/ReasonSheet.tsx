"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";

/** Generic "say why" sheet (reopen a job, etc.). */
export default function ReasonSheet({
  open,
  onOpenChange,
  title,
  message,
  submitLabel,
  destructive,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  message?: string;
  submitLabel: string;
  destructive?: boolean;
  pending: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={["content"]}
      dirty={reason.trim() !== ""}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          variant={destructive ? "destructive" : "filled"}
          loading={pending}
          disabled={reason.trim().length < 3}
          onClick={() => onSubmit(reason.trim())}
        >
          {submitLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        {message && <p className="text-subhead text-label-2">{message}</p>}
        <TextArea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          data-autofocus
        />
      </div>
    </Sheet>
  );
}
