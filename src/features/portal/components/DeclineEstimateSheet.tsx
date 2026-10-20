"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { declinePublic } from "../actions";

/**
 * "Not right now?" on /e/[token]: an optional reason, then decline. Its own
 * module so `EstimateApproval` loads it (and the Sheet) only on first tap.
 */
export default function DeclineEstimateSheet({
  open,
  onClose,
  token,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Not right now?"
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Back
        </Button>
      }
      footer={
        <Button
          variant="secondary"
          destructive
          size="lg"
          block
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await declinePublic({ token, reason: reason || null });
              if (r.ok) {
                toast({ title: "Thanks for letting us know", tone: "success" });
                onClose();
                onDone();
              } else toast({ title: r.error, tone: "error" });
            })
          }
        >
          Decline estimate
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-4">
        <p className="px-1 text-subhead text-label-2">
          Tell us why (optional). We read every answer and won't keep following
          up.
        </p>
        <TextArea
          label="Reason"
          hideLabel
          value={reason}
          rows={3}
          onChange={(e) => setReason(e.currentTarget.value)}
          placeholder="Price, timing, getting other quotes…"
        />
      </div>
    </Sheet>
  );
}
