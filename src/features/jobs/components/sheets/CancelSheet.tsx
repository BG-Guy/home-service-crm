"use client";

import { useMemo, useState } from "react";
import { CameraCaptureButton } from "@/features/media/slots.client";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextArea } from "@/ui/components/Field";
import { MoneyText } from "@/ui/components/MoneyText";
import { Sheet } from "@/ui/components/Sheet";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  CANCEL_REASON_LABEL,
  type CancellationPolicy,
  cancellationFee,
} from "../../machine";

/**
 * Cancel with a reason code (SPEC M05). After arrival it also needs a note and a
 * photo, and (for non-admins) goes to admin review. Late-cancel / no-show fees
 * follow the policy snapshot; they can be waived.
 */
export default function CancelSheet({
  open,
  onOpenChange,
  jobId,
  afterArrival,
  reviewNeeded,
  windowStart,
  policy,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: string;
  afterArrival: boolean;
  reviewNeeded: boolean;
  windowStart: string | null;
  policy: CancellationPolicy;
  pending: boolean;
  onSubmit: (v: {
    reason: string;
    note: string;
    photoClientIds: string[];
    waiveFee: boolean;
  }) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [waive, setWaive] = useState(false);
  const fee = useMemo(
    () =>
      reason
        ? cancellationFee({
            reason,
            windowStart: windowStart ? new Date(windowStart) : null,
            at: new Date(),
            policy,
          })
        : null,
    [reason, windowStart, policy],
  );
  const ready =
    !!reason &&
    (!afterArrival || (note.trim().length > 2 && photos.length > 0));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel job"
      detents={["large"]}
      dirty={!!reason || note.trim() !== "" || photos.length > 0}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Back
        </Button>
      }
      footer={
        <Button
          size="lg"
          fullWidth
          variant="destructive"
          loading={pending}
          disabled={!ready}
          onClick={() =>
            onSubmit({
              reason,
              note: note.trim(),
              photoClientIds: photos,
              waiveFee: waive,
            })
          }
        >
          Cancel job
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-6">
        {afterArrival && (
          <Banner tone="warning" title="You're already on site">
            Add a note and a photo.
            {reviewNeeded ? " An admin will review this cancellation." : ""} The
            customer gets a quick “Was your service completed today?” check.
          </Banner>
        )}
        <Select
          label="Reason"
          value={reason}
          placeholder="Pick a reason"
          onChange={(e) => setReason(e.target.value)}
          options={Object.entries(CANCEL_REASON_LABEL).map(
            ([value, label]) => ({ value, label }),
          )}
        />
        <TextArea
          label={afterArrival ? "Note (required)" : "Note (optional)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened?"
          rows={3}
        />
        {afterArrival && (
          <div className="flex items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-card">
            <span className="text-body">
              Photo{" "}
              {photos.length > 0 ? `· ${photos.length} added` : "(required)"}
            </span>
            <CameraCaptureButton
              jobId={jobId}
              defaultTag="problem"
              allowedTags={["problem", "other"]}
              label={photos.length ? "Add another" : "Take photo"}
              onQueued={({ clientId }) => setPhotos((p) => [...p, clientId])}
            />
          </div>
        )}
        {fee && (
          <div className="flex flex-col gap-2">
            <Banner
              tone="info"
              title={
                fee.kind === "no_show" ? "No-show fee" : "Late cancellation fee"
              }
            >
              Per the cancellation policy the customer agreed to,{" "}
              <MoneyText cents={fee.cents} /> is added to their invoice.
            </Banner>
            <ul className="list-card">
              <li>
                <ToggleRow
                  title="Waive the fee"
                  checked={waive}
                  onChange={(e) => setWaive(e.target.checked)}
                />
              </li>
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
