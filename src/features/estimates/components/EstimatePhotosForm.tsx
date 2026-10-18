"use client";

import { useState, useTransition } from "react";
import {
  CameraCaptureButton,
  PhotoPicker,
} from "@/features/media/slots.client";
import { Button } from "@/ui/components/Button";
import { ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { setEstimatePhotos } from "../actions";

// Job photos on the estimate (M07), like the invoice's: whether the estimate shows
// photos at all, plus an ordered selection through B4's PhotoPicker (S25). An empty
// selection shows the job's "problem" photos.

export function EstimatePhotosForm({
  estimateId,
  jobId,
  showPhotos,
  selected,
}: {
  estimateId: string;
  jobId: string;
  showPhotos: boolean;
  selected: string[];
}) {
  const [on, setOn] = useState(showPhotos);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await setEstimatePhotos(fd);
          if (r.ok) toast({ title: "Photos updated", tone: "success" });
          else toast({ title: r.error, tone: "error" });
        });
      }}
    >
      <input type="hidden" name="estimateId" value={estimateId} />
      <ListSection
        header="Photos on estimate"
        footer={
          on
            ? "Pick the job photos the customer sees, in order. Leave the selection empty to show the problem photos."
            : "The estimate the customer sees has no photos."
        }
      >
        <ToggleRow
          title="Attach job photos"
          name="showPhotos"
          checked={on}
          onChange={(e) => setOn(e.currentTarget.checked)}
        />
        {on ? (
          <>
            <div className="px-4 py-3">
              <PhotoPicker
                jobId={jobId}
                name="photoMediaIds"
                selected={selected}
                max={8}
                tags={["problem", "before", "during", "after"]}
              />
            </div>
            <div className="px-4 pb-3">
              <CameraCaptureButton
                jobId={jobId}
                defaultTag="problem"
                allowedTags={["problem"]}
                label="Add problem photo"
                multiple
              />
            </div>
          </>
        ) : null}
      </ListSection>
      <div className="mt-2 flex justify-end px-1">
        <Button type="submit" size="sm" variant="tinted" loading={pending}>
          Save photos
        </Button>
      </div>
    </form>
  );
}
