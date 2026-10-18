"use client";

import { Camera, Check, ImageOff, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, buttonClass } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { cx } from "@/ui/cx";
import {
  type CaptureConfig,
  getCaptureConfig,
  listPickablePhotos,
  type PickablePhoto,
} from "./actions";
import type {
  CameraCaptureButtonProps,
  MediaTag,
  PhotoPickerProps,
} from "./contracts";
import { TAG_LABEL } from "./labels";

// Client UI slots produced by B4 (BUILD_PLAN §5.1). Client slots take serializable
// props and call only this module's own actions.

const JOB_TAGS: MediaTag[] = ["before", "during", "after", "problem"];

// ---------------------------------------------------------------- capture config
// Fetched once per page load (flags + keep-originals policy). A failed fetch
// (offline reload, QA T1-04) is never cached: the last-known config from
// localStorage (or a permissive default; presign re-checks everything server-side)
// renders at once, and the fetch is retried when the browser comes back online.

const CFG_KEY = "crm:capture-config:v1";
const FALLBACK_CFG: CaptureConfig = {
  photos: true,
  beforeAfter: true,
  keepOriginals: false,
  keepOriginalTags: [],
  canUpload: true,
};

let freshCfg: CaptureConfig | null | undefined;
let inflightCfg: Promise<CaptureConfig | null> | null = null;

function storedConfig(): CaptureConfig | null {
  try {
    const raw = window.localStorage.getItem(CFG_KEY);
    return raw ? (JSON.parse(raw) as CaptureConfig) : null;
  } catch {
    return null;
  }
}

function fetchConfig(): Promise<CaptureConfig | null> {
  if (freshCfg !== undefined) return Promise.resolve(freshCfg);
  inflightCfg ??= getCaptureConfig()
    .then((r) => {
      const c = r.ok ? (r.data ?? null) : null;
      freshCfg = c;
      if (c)
        try {
          window.localStorage.setItem(CFG_KEY, JSON.stringify(c));
        } catch {
          /* storage blocked: fine, the fetch runs again next page load */
        }
      return c;
    })
    .finally(() => {
      inflightCfg = null;
    });
  return inflightCfg;
}

function useCaptureConfig() {
  const [cfg, setCfg] = useState<CaptureConfig | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const offlineValue = () => storedConfig() ?? FALLBACK_CFG;
    const load = () =>
      fetchConfig().then(
        (c) => {
          if (live) setCfg(c);
        },
        () => {
          if (live) setCfg((cur) => cur ?? offlineValue());
        },
      );
    if (freshCfg !== undefined) setCfg(freshCfg);
    else {
      const last = storedConfig();
      if (last) setCfg(last);
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        setCfg(last ?? FALLBACK_CFG);
      else void load();
    }
    const onOnline = () => {
      if (freshCfg === undefined) void load();
    };
    window.addEventListener("online", onOnline);
    return () => {
      live = false;
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return cfg;
}

/** B2 additions to the frozen S24 props (all optional). */
type CaptureExtras = {
  /**
   * One compact trigger (a "Photos" chip) that opens a sheet holding the tag
   * control, the camera and the library (the tech job dock, QA T4-01).
   */
  compact?: boolean;
  /** Compact only: replaces the trigger's default chip classes. */
  triggerClassName?: string;
  /** Compact only: the sheet title (default: the label, else "Photos"). */
  sheetTitle?: string;
  /** Each photo stored on the server (checklist answers keep the media id). */
  onUploaded?: (m: { clientId: string; mediaId: string }) => void;
};

/**
 * S24 — Camera button with job context and allowed tags. Before/after segments are
 * hidden when the `before_after` flag is off; job photos disappear when `photos` is
 * off (receipt, odometer, document and tool photos always work). Upload goes through
 * the offline outbox (`queueUpload`): presign → PUT → complete, geostamped + hashed.
 * `compact` renders one chip that opens a sheet with the same controls.
 */
export function CameraCaptureButton({
  jobId,
  entity,
  kind = "photo",
  defaultTag,
  allowedTags,
  label,
  multiple = true,
  onQueued,
  onUploaded,
  compact,
  triggerClassName,
  sheetTitle,
}: CameraCaptureButtonProps & CaptureExtras) {
  const router = useRouter();
  const cfg = useCaptureConfig();
  const [open, setOpen] = useState(false);
  const [taken, setTaken] = useState(0);
  const isJobPhoto =
    kind === "photo" &&
    !!jobId &&
    (!defaultTag || JOB_TAGS.includes(defaultTag) || defaultTag === "other");
  const tags = useMemo(() => {
    const base = allowedTags?.length
      ? allowedTags
      : isJobPhoto
        ? JOB_TAGS
        : defaultTag
          ? [defaultTag]
          : [];
    if (cfg?.beforeAfter !== false) return base;
    const rest = base.filter((t) => t !== "before" && t !== "after");
    // A before/after-only control (e.g. a checklist "before photo") still works
    // with the flag off: the photo is filed as "during".
    return rest.length || !base.length ? rest : (["during"] as MediaTag[]);
  }, [allowedTags, cfg?.beforeAfter, defaultTag, isJobPhoto]);
  const initial =
    defaultTag && tags.includes(defaultTag) ? defaultTag : (tags[0] ?? null);
  const [tag, setTag] = useState<MediaTag | null>(initial);
  useEffect(() => {
    if (tag && !tags.includes(tag)) setTag(tags[0] ?? null);
  }, [tags, tag]);

  if (cfg === undefined)
    return compact ? (
      <Skeleton
        className={
          triggerClassName
            ? "h-12 min-w-0 flex-1 basis-0 rounded-[14px]"
            : "h-[34px] w-24 shrink-0 rounded-pill"
        }
      />
    ) : (
      <Skeleton className="h-11 w-full rounded-pill" />
    );
  if (cfg && !cfg.canUpload) return null;
  if (cfg && isJobPhoto && !cfg.photos) return null;
  const keepOriginal =
    !!cfg?.keepOriginals && !!tag && cfg.keepOriginalTags.includes(tag);
  const target = entity ?? (jobId ? { type: "job" as const, id: jobId } : null);

  const segmented = tags.length > 1 && (
    <SegmentedControl<MediaTag>
      label="Photo type"
      value={tag ?? undefined}
      onChange={setTag}
      segments={tags.map((t) => ({ value: t, label: TAG_LABEL[t] }))}
    />
  );
  const camera = (inSheet: boolean) => (
    <CameraButton
      kind={kind}
      tag={tag}
      jobId={jobId ?? null}
      entity={target}
      keepOriginal={keepOriginal}
      multiple={multiple}
      label={
        inSheet
          ? "Camera"
          : (label ??
            (tag && tags.length <= 1
              ? `${TAG_LABEL[tag]} photo`
              : "Take photo"))
      }
      libraryLabel={inSheet ? "Library" : undefined}
      variant={inSheet ? "filled" : "tinted"}
      fullWidth={!inSheet}
      // In the sheet: Camera | Library side by side, equal widths.
      className={inSheet ? "[&>div:first-child>button]:flex-1" : undefined}
      onQueued={(r) => {
        setTaken((n) => n + 1);
        onQueued?.({ clientId: r.clientId });
      }}
      onUploaded={(r) => {
        onUploaded?.({ clientId: r.clientId, mediaId: r.mediaId });
        router.refresh();
      }}
    />
  );

  if (!compact)
    return (
      <div className="flex flex-col gap-2.5">
        {segmented}
        {camera(false)}
      </div>
    );

  const chipLabel = label ?? "Photos";
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={taken ? `${chipLabel}, ${taken} added` : chipLabel}
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          buttonClass({
            variant: "gray",
            size: "sm",
            className: "shrink-0 gap-1.5 px-3",
          })
        }
      >
        <span aria-hidden className="relative flex">
          <Camera size={18} />
          {taken > 0 && (
            <span className="enter-pop absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-on-accent tabular-nums">
              {taken}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">{chipLabel}</span>
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={sheetTitle ?? chipLabel}
        detents={["content"]}
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4 px-4 pb-6">
          {segmented}
          {camera(true)}
          <p className="text-footnote text-label-2">
            Each photo is time- and location-stamped and uploads in the
            background, even with no signal.
          </p>
        </div>
      </Sheet>
    </>
  );
}

/**
 * S25 — Choose and order job photos (invoice photo selection, estimate "photos of the
 * problem"). Tap order = display order. Emits hidden inputs `${name}[]` in order.
 */
export function PhotoPicker({
  jobId,
  name,
  selected,
  max = 8,
  tags,
}: PhotoPickerProps) {
  const [photos, setPhotos] = useState<PickablePhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(selected);
  const tagKey = (tags ?? []).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: tagKey stands in for tags
  useEffect(() => {
    let live = true;
    listPickablePhotos({ jobId, tags }).then((r) => {
      if (!live) return;
      if (r.ok) setPhotos(r.data ?? []);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [jobId, tagKey]);

  const toggle = (id: string) =>
    setOrder((o) =>
      o.includes(id)
        ? o.filter((x) => x !== id)
        : o.length >= max
          ? o
          : [...o, id],
    );

  const hidden = order.map((id) => (
    <input key={id} type="hidden" name={`${name}[]`} value={id} />
  ));

  if (error)
    return (
      <p className="px-4 py-3 text-footnote text-danger" role="alert">
        {error}
      </p>
    );
  if (!photos)
    return (
      <div className="grid grid-cols-4 gap-1">
        {Array.from({ length: 8 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
          <Skeleton key={i} className="aspect-square rounded-[8px]" />
        ))}
        {hidden}
      </div>
    );
  if (photos.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-label-2">
        <ImageOff aria-hidden size={28} />
        <p className="text-subhead">No job photos yet.</p>
        {hidden}
      </div>
    );
  const starred = photos.filter((p) => p.starred).map((p) => p.id);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-footnote text-label-2" aria-live="polite">
          {order.length === 0
            ? "None picked: starred photos (or the latest before/after) are used."
            : `${order.length} of ${max} picked, in this order`}
        </p>
        <div className="flex gap-1">
          {starred.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="plain"
              onClick={() => setOrder(starred.slice(0, max))}
            >
              Use starred
            </Button>
          )}
          {order.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="plain"
              onClick={() => setOrder([])}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-4 gap-1 md:grid-cols-6">
        {photos.map((p) => {
          const idx = order.indexOf(p.id);
          const on = idx >= 0;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${p.tag ? TAG_LABEL[p.tag] : "Photo"}${p.caption ? `: ${p.caption}` : ""}${on ? `, position ${idx + 1}` : ""}`}
                onClick={() => toggle(p.id)}
                className={cx(
                  "pressable relative block aspect-square w-full overflow-hidden rounded-[8px] bg-fill-2 outline-offset-2",
                  on && "ring-[3px] ring-accent ring-inset",
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
                <img
                  src={p.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={cx(
                    "size-full object-cover transition-opacity",
                    !on && order.length >= max && "opacity-40",
                  )}
                />
                {p.tag && (
                  <span className="absolute bottom-1 left-1 rounded-pill bg-black/55 px-1.5 py-px text-[11px] font-semibold text-white">
                    {TAG_LABEL[p.tag]}
                  </span>
                )}
                {p.starred && !on && (
                  <Star
                    aria-hidden
                    size={14}
                    className="absolute top-1 right-1 drop-shadow"
                    fill="var(--sys-yellow)"
                    stroke="#0006"
                  />
                )}
                {on && (
                  <span className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-accent text-footnote font-bold text-on-accent shadow">
                    {order.length > 1 ? (
                      idx + 1
                    ) : (
                      <Check size={14} strokeWidth={3} />
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {hidden}
    </div>
  );
}
