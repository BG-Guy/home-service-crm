"use client";

import { Images } from "lucide-react";
import { useState, useTransition } from "react";
import type { MediaTag } from "@/features/media/contracts";
import {
  CameraCaptureButton,
  PhotoPicker,
} from "@/features/media/slots.client";
import { Button, buttonClass } from "@/ui/components/Button";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { setEstimatePhotos } from "../actions";

// Estimate photos on the builder (Quote to Paid E6, the owner's note: "the user
// takes a photo from the app / uploads it from the phone, then chooses whether to
// attach it to the estimate"). "Photos" takes or uploads one with a Problem / Goal
// label (default Problem) and attaches it; "Choose from job photos" picks up to 8
// of the job's photos in order. Lazy islands: the camera and picker load on use.

const ESTIMATE_TAGS: MediaTag[] = ["problem", "goal"];
const PICKABLE: MediaTag[] = [
  "problem",
  "goal",
  "before",
  "during",
  "after",
  "other",
];

/** Next to "Add items": take or upload a Problem / Goal photo and attach it. */
export function EstimatePhotoButton({
  estimateId,
  jobId,
}: {
  estimateId: string;
  jobId: string;
}) {
  return (
    <CameraCaptureButton
      jobId={jobId}
      compact
      label="Photos"
      sheetTitle="Add a photo"
      defaultTag="problem"
      allowedTags={ESTIMATE_TAGS}
      triggerClassName={buttonClass({
        variant: "secondary",
        size: "md",
        className: "gap-1.5",
      })}
      onUploaded={async ({ mediaId }) => {
        const r = await setEstimatePhotos({
          estimateId,
          photoMediaIds: [mediaId],
          append: true,
        });
        toast(
          r.ok
            ? { title: "Photo added to the estimate", tone: "success" }
            : { title: r.error, tone: "error" },
        );
      }}
    />
  );
}

/** "Choose from job photos": the estimate's photos, in tap order (max 8). */
export function ChooseEstimatePhotos({
  estimateId,
  jobId,
  selected,
}: {
  estimateId: string;
  jobId: string;
  selected: string[];
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const formId = `estimate-photos-${estimateId}`;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Images size={16} aria-hidden />}
        onClick={() => {
          setArmed(true);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        Choose from job photos
      </Button>
      {armed ? (
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="Estimate photos"
          detents={["large"]}
          footer={
            <div className="px-[var(--gutter)] pb-2 pt-2">
              <Button
                type="submit"
                form={formId}
                size="lg"
                fullWidth
                loading={pending}
              >
                Use these photos
              </Button>
            </div>
          }
        >
          <form
            id={formId}
            className="flex flex-col gap-3 px-[var(--gutter)] pb-6"
            onSubmit={(ev) => {
              ev.preventDefault();
              const fd = new FormData(ev.currentTarget);
              fd.set("estimateId", estimateId);
              start(async () => {
                const r = await setEstimatePhotos(fd);
                if (r.ok) {
                  toast({ title: "Photos updated", tone: "success" });
                  setOpen(false);
                } else toast({ title: r.error, tone: "error" });
              });
            }}
          >
            <p className="text-subhead text-label-2">
              Tap photos in the order the customer should see them. Each keeps
              its label (Problem, Goal). Tap a photo again to take it off.
            </p>
            <PhotoPicker
              jobId={jobId}
              name="photoMediaIds"
              selected={selected}
              max={8}
              tags={PICKABLE}
            />
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
