"use client";

import { Camera, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { CameraButton } from "@/ui/components/CameraButton";
import { IconButton } from "@/ui/components/IconButton";
import { toast } from "@/ui/components/Toast";
import { addReceiptPhoto, removePartLine } from "../actions";

/** Remove a part line from the draft invoice (confirm first). */
export function RemovePartButton({
  jobId,
  lineItemId,
  name,
}: {
  jobId: string;
  lineItemId: string;
  name: string;
}) {
  const [confirm, confirmEl] = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      {confirmEl}
      <IconButton
        label={`Remove ${name}`}
        disabled={pending}
        onClick={async () => {
          if (
            !(await confirm({
              title: `Remove ${name}?`,
              message: "It comes off the invoice. Truck stock is put back.",
              confirmLabel: "Remove",
              destructive: true,
            }))
          )
            return;
          start(async () => {
            const r = await removePartLine({ jobId, lineItemId });
            if (!r.ok)
              toast({
                title: "Couldn't remove",
                message: r.error,
                tone: "error",
              });
            else toast({ title: "Part removed", tone: "success" });
          });
        }}
      >
        <Trash2 size={18} aria-hidden />
      </IconButton>
    </>
  );
}

/** Snap the missing receipt for a purchase; re-runs the auto-approve rules. */
export function AddReceiptButton({
  partPurchaseId,
  jobId,
  label = "Add receipt",
}: {
  partPurchaseId: string;
  jobId?: string | null;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  if (done)
    return <span className="text-footnote text-success">Receipt added</span>;
  return (
    <CameraButton
      kind="receipt"
      tag="receipt"
      jobId={jobId ?? null}
      label={label}
      multiple={false}
      showLibrary
      variant="tinted"
      icon={<Camera size={17} aria-hidden />}
      onUploaded={async (u) => {
        const r = await addReceiptPhoto({ partPurchaseId, mediaId: u.mediaId });
        if (!r.ok) {
          toast({
            title: "Couldn't attach the receipt",
            message: r.error,
            tone: "error",
          });
          return;
        }
        setDone(true);
        toast({
          title:
            r.data?.status === "approved"
              ? "Receipt approved"
              : "Receipt sent for approval",
          tone: "success",
        });
      }}
      onError={(e) =>
        toast({ title: "Photo failed", message: e.message, tone: "error" })
      }
    />
  );
}
