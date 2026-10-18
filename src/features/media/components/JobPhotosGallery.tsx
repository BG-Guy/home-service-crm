"use client";

import {
  Columns2,
  Images,
  Lock,
  MapPin,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { TextArea, TextField } from "@/ui/components/Field";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { LazyPhotoCompare } from "@/ui/components/lazy";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet, useSheetState } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { deletePhoto, setPhotoStarred, updatePhoto } from "../actions";
import type { MediaTag } from "../contracts";
import { FLAG_HINT, FLAG_LABEL, TAG_LABEL } from "../labels";
import { CameraCaptureButton } from "../slots.client";

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

type Filter = "all" | "before" | "after" | "other";
const EDIT_TAGS: MediaTag[] = ["before", "during", "after", "problem", "other"];

/** S23 body: grid by tag, viewer with details, star, caption/tag edit, delete, compare. */
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
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const viewer = useSheetState();
  const compare = useSheetState();
  const before = photos.filter((p) => p.tag === "before");
  const after = photos.filter((p) => p.tag === "after");
  const shown = photos.filter((p) =>
    filter === "all"
      ? true
      : filter === "other"
        ? p.tag !== "before" && p.tag !== "after"
        : p.tag === filter,
  );
  const open = photos.find((p) => p.id === openId) ?? null;

  const need =
    beforeAfter && (required.before > 0 || required.after > 0)
      ? [
          required.before > 0 &&
            `Before ${Math.min(before.length, required.before)}/${required.before}`,
          required.after > 0 &&
            `After ${Math.min(after.length, required.after)}/${required.after}`,
        ].filter(Boolean)
      : [];
  const missing =
    beforeAfter &&
    (before.length < required.before || after.length < required.after);

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
        <>
          {/* T4-15/T1-22: the 4-segment filter gets its own full-width row so the
              counts never truncate at 390 px; Compare sits on the row below. */}
          <div className="flex flex-col gap-2">
            {beforeAfter ? (
              <SegmentedControl<Filter>
                className="w-full"
                label="Show photos"
                value={filter}
                onChange={setFilter}
                segments={[
                  { value: "all", label: `All ${photos.length}` },
                  { value: "before", label: `Before ${before.length}` },
                  { value: "after", label: `After ${after.length}` },
                  {
                    value: "other",
                    label: `Other ${photos.length - before.length - after.length}`,
                  },
                ]}
              />
            ) : (
              <span className="px-1 text-footnote text-label-2">
                {photos.length} photo{photos.length === 1 ? "" : "s"}
              </span>
            )}
            {beforeAfter && before.length > 0 && after.length > 0 && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="gray"
                  icon={<Columns2 size={16} />}
                  onClick={compare.show}
                >
                  Compare before and after
                </Button>
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-center text-subhead text-label-2">
              No {filter} photos.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-1 md:grid-cols-4 lg:grid-cols-5">
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(p.id);
                      viewer.show();
                    }}
                    className="pressable relative block aspect-square w-full overflow-hidden rounded-[8px] bg-fill-2 outline-offset-2"
                    aria-label={`${p.tag ? TAG_LABEL[p.tag] : "Photo"} taken ${p.takenAt}${p.starred ? ", starred" : ""}${p.flags.length ? ", flagged" : ""}`}
                  >
                    {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
                    <img
                      src={p.thumbUrl}
                      alt={p.caption ?? ""}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                    {p.tag && (
                      <span className="absolute bottom-1 left-1 rounded-pill bg-black/55 px-1.5 py-px text-[11px] font-semibold text-white">
                        {TAG_LABEL[p.tag]}
                      </span>
                    )}
                    <span className="absolute top-1 right-1 flex gap-0.5">
                      {p.flags.length > 0 && (
                        <TriangleAlert
                          aria-hidden
                          size={15}
                          className="drop-shadow"
                          fill="var(--sys-orange)"
                          stroke="#fff"
                        />
                      )}
                      {p.starred && (
                        <Star
                          aria-hidden
                          size={15}
                          className="drop-shadow"
                          fill="var(--sys-yellow)"
                          stroke="#0006"
                        />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Sheet
        {...viewer.props}
        title={open?.tag ? TAG_LABEL[open.tag] : "Photo"}
        detents={["large"]}
        trailing={
          <Button size="sm" variant="plain" onClick={viewer.hide}>
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
            onDeleted={viewer.hide}
          />
        )}
      </Sheet>

      {beforeAfter && before.length > 0 && after.length > 0 && (
        <Sheet
          {...compare.props}
          title="Before & after"
          trailing={
            <Button size="sm" variant="plain" onClick={compare.hide}>
              Done
            </Button>
          }
        >
          {compare.open && <ComparePane before={before} after={after} />}
        </Sheet>
      )}
    </div>
  );
}

function ComparePane({
  before,
  after,
}: {
  before: GalleryPhoto[];
  after: GalleryPhoto[];
}) {
  const [b, setB] = useState(before[0]?.id);
  const [a, setA] = useState(after[after.length - 1]?.id);
  const bp = before.find((p) => p.id === b) ?? before[0];
  const ap = after.find((p) => p.id === a) ?? after[0];
  if (!bp || !ap) return null;
  const strip = (
    list: GalleryPhoto[],
    cur: string | undefined,
    set: (id: string) => void,
    label: string,
  ) =>
    list.length > 1 && (
      <fieldset className="flex flex-col gap-1">
        <legend className="px-1 pb-1 text-footnote text-label-2">
          {label}
        </legend>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === cur}
              aria-label={`${label} photo, ${p.takenAt}`}
              onClick={() => set(p.id)}
              className={cx(
                "pressable size-14 shrink-0 overflow-hidden rounded-[8px] bg-fill-2",
                p.id === cur && "ring-[3px] ring-accent ring-inset",
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
              <img src={p.thumbUrl} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      </fieldset>
    );
  return (
    <div className="flex flex-col gap-4 p-4">
      <LazyPhotoCompare beforeUrl={bp.url} afterUrl={ap.url} />
      <p className="text-center text-footnote text-label-2">
        Drag the handle to compare. Before {bp.takenAt} · After {ap.takenAt}
      </p>
      {strip(before, bp.id, setB, "Before")}
      {strip(after, ap.id, setA, "After")}
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
      <div className="relative bg-black">
        {/* biome-ignore lint/performance/noImgElement: signed URL */}
        <img
          src={photo.url}
          alt={
            photo.caption ??
            (photo.tag ? `${TAG_LABEL[photo.tag]} photo` : "Job photo")
          }
          className="mx-auto max-h-[55dvh] w-auto object-contain"
        />
      </div>
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
