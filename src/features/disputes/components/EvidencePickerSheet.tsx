"use client";

import { Check } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { setEvidenceFile } from "../actions";
import type { EditorFileSlot, EditorMedia } from "./DisputeEditor";

/** Attach a job photo / signature to an evidence slot (lazy chunk of DisputeEditor). */
export default function EvidencePickerSheet({
  open,
  onOpenChange,
  disputeId,
  files,
  media,
  picking,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  disputeId: string;
  files: EditorFileSlot[];
  media: EditorMedia[];
  picking: string | null;
}) {
  const [, start] = useTransition();
  const hide = () => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={files.find((f) => f.key === picking)?.label ?? "Attach"}
      detents={["medium", "large"]}
      leading={
        <Button size="sm" variant="plain" onClick={hide}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {media.length === 0 ? (
          <p className="py-6 text-center text-subhead text-label-2">
            This job has no photos or signatures to attach.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {media.map((m) => {
              const current = files.find((f) => f.key === picking)?.mediaId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-pressed={current === m.id}
                    onClick={() =>
                      start(async () => {
                        if (!picking) return;
                        const r = await setEvidenceFile({
                          disputeId,
                          field: picking as never,
                          mediaId: m.id,
                        });
                        if (r.ok) {
                          toast.success("Attached");
                          hide();
                        } else toast.error(r.error);
                      })
                    }
                    className={cx(
                      "pressable flex w-full flex-col gap-1 text-left",
                    )}
                  >
                    <span
                      className={cx(
                        "relative block aspect-square w-full overflow-hidden rounded-[8px] bg-fill-2",
                        current === m.id && "ring-[3px] ring-accent ring-inset",
                      )}
                    >
                      {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
                      <img
                        src={m.thumbUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                      {current === m.id && (
                        <span className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-accent-fill text-on-accent">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className="truncate text-caption text-label-2">
                      {m.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {picking && files.find((f) => f.key === picking)?.mediaId && (
          <Button
            variant="plain"
            className="text-danger"
            onClick={() =>
              start(async () => {
                const r = await setEvidenceFile({
                  disputeId,
                  field: picking as never,
                  mediaId: null,
                });
                if (r.ok) {
                  toast.success("Removed");
                  hide();
                } else toast.error(r.error);
              })
            }
          >
            Remove file
          </Button>
        )}
      </div>
    </Sheet>
  );
}
