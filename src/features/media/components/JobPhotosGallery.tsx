"use client";

import { Images, Info, Lock, MapPin, Star, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import { JOB_PHOTO_GROUPS, type Photo } from "@/ui/components/photos";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet, useSheetState } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { humanize } from "@/ui/status";
import { deletePhoto, setPhotoStarred, updatePhoto } from "../actions";
import type { MediaTag } from "../contracts";
import { FLAG_HINT, FLAG_LABEL, TAG_LABEL } from "../labels";
import { CameraCaptureButton } from "./capture";

export interface GalleryPhoto {
  id: string;
  thumbUrl: string;
  url: string;
  tag: MediaTag | null;
  caption: string | null;
  takenAt: string;
  lat: number | null;
  lng: number | null;
  flags: string[];
  starred: boolean;
  locked: boolean;
  uploader: string | null;
}

const EDIT_TAGS: MediaTag[] = ["before", "during", "after", "problem", "other"];
const tagLabel = (t: string) => TAG_LABEL[t as MediaTag] ?? humanize(t);

/**
 * S23 body: the job's photos grouped by tag (Before / During / After / Problem /
 * Other), each opening the full-screen viewer (swipe through all of them); its
 * Info button opens the details sheet (star, re-tag, caption, delete).
 */
export function JobPhotosGallery({
  jobId,
  photos,
  canEdit,
  canDelete,
  canCapture,
  beforeAfter,
  required,
}: {
  jobId: string;
  photos: GalleryPhoto[];
  canEdit: boolean;
  canDelete: boolean;
  canCapture: boolean;
  beforeAfter: boolean;
  required: { before: number; after: number };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const details = useSheetState();
  const before = photos.filter((p) => p.tag === "before").length;
  const after = photos.filter((p) => p.tag === "after").length;
  const open = photos.find((p) => p.id === openId) ?? null;
  const grid = useMemo<Photo[]>(
    () =>
      photos.map((p) => ({
        id: p.id,
        url: p.url,
        thumbUrl: p.thumbUrl,
        tag: p.tag,
        caption: p.caption,
        takenAt: p.takenAt,
        by: p.uploader,
        starred: p.starred,
        flagged: p.flags.length > 0,
        alt: p.caption ?? (p.tag ? `${TAG_LABEL[p.tag]} photo` : "Job photo"),
      })),
    [photos],
  );

  const need =
    beforeAfter && (required.before > 0 || required.after > 0)
      ? [
          required.before > 0 &&
            `Before ${Math.min(before, required.before)}/${required.before}`,
          required.after > 0 &&
            `After ${Math.min(after, required.after)}/${required.after}`,
        ].filter(Boolean)
      : [];
  const missing =
    beforeAfter && (before < required.before || after < required.after);

  return (
    <div className="flex flex-col gap-3">
      {canCapture && (
        <div className="rounded-card bg-card p-3">
          <CameraCaptureButton jobId={jobId} />
        </div>
      )}
      {need.length > 0 && (
        <p
          className={cx(
            "px-4 text-footnote",
            missing ? "text-warning" : "text-label-2",
          )}
        >
          Required for this service: {need.join(" · ")}
        </p>
      )}
      {photos.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<Images size={40} strokeWidth={1.6} />}
            title="No photos yet"
            message={
              beforeAfter
                ? "Take before and after photos: they protect you in a dispute and can appear on the invoice."
                : "Photos taken on this job show up here."
            }
          />
        </div>
      ) : (
        <PhotoGrid
          photos={grid}
          groups={JOB_PHOTO_GROUPS}
          tagLabel={tagLabel}
          actions={(p) => (
            <IconButton
              label="Photo details"
              variant="material"
              size={44}
              aria-haspopup="dialog"
              onClick={() => {
                setOpenId(p.id);
                details.show();
              }}
            >
              <Info size={20} aria-hidden />
            </IconButton>
          )}
        />
      )}

      {/* A direct child of the gallery: it opens over the full-screen viewer
          (a <dialog> stacks above the hub) and must not sit inside a wrapper
          the hub marks inert while it is open. */}
      <Sheet
        {...details.props}
        title={open?.tag ? TAG_LABEL[open.tag] : "Photo"}
        detents={["medium", "large"]}
        trailing={
          <Button size="sm" variant="plain" onClick={details.hide}>
            Done
          </Button>
        }
        onClosed={() => setOpenId(null)}
      >
        {open && (
          <PhotoDetail
            key={open.id}
            photo={open}
            canEdit={canEdit}
            canDelete={canDelete}
            beforeAfter={beforeAfter}
            onDeleted={details.hide}
          />
        )}
      </Sheet>
    </div>
  );
}

function PhotoDetail({
  photo,
  canEdit,
  canDelete,
  beforeAfter,
  onDeleted,
}: {
  photo: GalleryPhoto;
  canEdit: boolean;
  canDelete: boolean;
  beforeAfter: boolean;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [reason, setReason] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const tags = EDIT_TAGS.filter(
    (t) => beforeAfter || (t !== "before" && t !== "after"),
  );

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
  ) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok);
      else toast.error(r.error ?? "Something went wrong");
    });

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-col gap-4 px-4">
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant={photo.starred ? "tinted" : "gray"}
              icon={
                <Star
                  size={18}
                  fill={photo.starred ? "currentColor" : "none"}
                />
              }
              loading={pending}
              fullWidth
              onClick={() =>
                run(
                  () =>
                    setPhotoStarred({
                      mediaId: photo.id,
                      starred: !photo.starred,
                    }),
                  photo.starred
                    ? "Removed from the invoice"
                    : "Starred for the invoice",
                )
              }
            >
              {photo.starred ? "Starred" : "Star for invoice"}
            </Button>
          </div>
        )}
        {photo.flags.length > 0 && (
          <Banner tone="warning" title="Flagged">
            <ul className="flex flex-col gap-1">
              {photo.flags.map((f) => (
                <li key={f}>
                  <strong>{FLAG_LABEL[f] ?? f}.</strong> {FLAG_HINT[f] ?? ""}
                </li>
              ))}
            </ul>
          </Banner>
        )}
        <KeyValueList
          items={[
            { label: "Taken", value: photo.takenAt },
            { label: "By", value: photo.uploader },
            {
              label: "Location",
              value:
                photo.lat != null && photo.lng != null ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden size={14} />
                    {photo.lat.toFixed(5)}, {photo.lng.toFixed(5)}
                  </span>
                ) : null,
              href:
                photo.lat != null && photo.lng != null
                  ? `https://maps.google.com/?q=${photo.lat},${photo.lng}`
                  : undefined,
            },
            {
              label: "Evidence",
              value: photo.locked ? (
                <span className="inline-flex items-center gap-1">
                  <Lock aria-hidden size={14} /> Locked
                </span>
              ) : (
                "Not locked"
              ),
            },
          ]}
        />
        {canEdit && (
          <section className="flex flex-col gap-3">
            {!photo.locked && (
              <SegmentedControl<MediaTag>
                label="Photo tag"
                value={photo.tag ?? "other"}
                onChange={(t) =>
                  run(
                    () => updatePhoto({ mediaId: photo.id, tag: t as never }),
                    `Tagged ${TAG_LABEL[t]}`,
                  )
                }
                segments={tags.map((t) => ({ value: t, label: TAG_LABEL[t] }))}
              />
            )}
            <TextField
              label="Caption"
              value={caption}
              maxLength={300}
              placeholder="Add a caption"
              onChange={(e) => setCaption(e.currentTarget.value)}
            />
            {caption !== (photo.caption ?? "") && (
              <Button
                variant="tinted"
                loading={pending}
                onClick={() =>
                  run(
                    () => updatePhoto({ mediaId: photo.id, caption }),
                    "Caption saved",
                  )
                }
              >
                Save caption
              </Button>
            )}
          </section>
        )}
        {canDelete && !photo.locked && (
          <section className="flex flex-col gap-2">
            {askDelete ? (
              <>
                <TextArea
                  label="Why remove this photo?"
                  hint="Photos are never erased: removal is logged for the audit trail."
                  value={reason}
                  onChange={(e) => setReason(e.currentTarget.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    variant="gray"
                    fullWidth
                    onClick={() => setAskDelete(false)}
                  >
                    Keep
                  </Button>
                  <Button
                    variant="destructive"
                    fullWidth
                    loading={pending}
                    disabled={reason.trim().length < 3}
                    onClick={() =>
                      start(async () => {
                        const r = await deletePhoto({
                          mediaId: photo.id,
                          reason,
                        });
                        if (r.ok) {
                          toast.success("Photo removed");
                          onDeleted();
                        } else toast.error(r.error);
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="plain"
                className="text-danger"
                icon={<Trash2 size={18} />}
                onClick={() => setAskDelete(true)}
              >
                Remove photo
              </Button>
            )}
          </section>
        )}
        {photo.locked && (
          <p className="text-center text-footnote text-label-2">
            Locked evidence can't be removed (issued invoice, signature or
            dispute).
          </p>
        )}
      </div>
    </div>
  );
}
