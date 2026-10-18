"use client";

import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../cx";
import { humanize } from "../status";
import { lockScroll } from "./dialog-utils";

export interface Photo {
  id: string;
  /** 320 px thumbnail URL (signed). */
  thumbUrl: string;
  /** 1600 px URL for the viewer. */
  url: string;
  tag?: string | null;
  caption?: string | null;
  /** Display string, e.g. "Oct 14, 3:45 PM". */
  takenAt?: string | null;
  starred?: boolean;
  alt?: string;
}

/**
 * Photo thumbnails with tag chips and a full-screen viewer (SPEC §12.6).
 * The viewer is a native `<dialog>` with a scroll-snap carousel (native swipe
 * physics), arrow keys, Esc, and a caption bar.
 */
export function PhotoGrid({
  photos,
  columns = 3,
  tagLabel = humanize,
  showTags = true,
  className,
}: {
  photos: readonly Photo[];
  /** Columns on phones (tablet/desktop add more automatically). */
  columns?: 2 | 3 | 4;
  tagLabel?: (tag: string) => string;
  showTags?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ul
        className={cx(
          "grid gap-1",
          columns === 2 && "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
          columns === 3 && "grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
          columns === 4 && "grid-cols-4 md:grid-cols-5 lg:grid-cols-6",
          className,
        )}
      >
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="pressable relative block aspect-square w-full overflow-hidden rounded-[8px] bg-fill-2 outline-offset-2"
              aria-label={`Open photo ${i + 1} of ${photos.length}${p.tag ? `, ${tagLabel(p.tag)}` : ""}`}
            >
              {/* biome-ignore lint/performance/noImgElement: pre-sized signed thumbnails */}
              <img
                src={p.thumbUrl}
                alt={p.alt ?? p.caption ?? ""}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
              {showTags && p.tag && (
                <span className="absolute bottom-1 left-1 rounded-pill bg-black/55 px-1.5 py-px text-[11px] font-semibold text-white backdrop-blur-sm">
                  {tagLabel(p.tag)}
                </span>
              )}
              {p.starred && (
                <Star
                  aria-label="Starred"
                  size={16}
                  className="absolute right-1 top-1 drop-shadow"
                  fill="var(--sys-yellow)"
                  stroke="#0006"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      {open != null && (
        <PhotoViewer
          photos={photos}
          index={open}
          onClose={() => setOpen(null)}
          tagLabel={tagLabel}
        />
      )}
    </>
  );
}

/** Full-screen photo viewer (also usable on its own). */
export function PhotoViewer({
  photos,
  index,
  onClose,
  tagLabel = humanize,
}: {
  photos: readonly Photo[];
  index: number;
  onClose: () => void;
  tagLabel?: (tag: string) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(index);

  // biome-ignore lint/correctness/useExhaustiveDependencies: open once at the initial index
  useEffect(() => {
    const d = dialog.current;
    const t = track.current;
    if (!d || !t) return;
    d.showModal();
    t.scrollLeft = index * t.clientWidth;
    t.focus({ preventScroll: true });
    const unlock = lockScroll();
    return () => {
      unlock();
      if (d.open) d.close();
    };
  }, []);

  const go = (i: number) => {
    const t = track.current;
    if (!t) return;
    const n = Math.max(0, Math.min(photos.length - 1, i));
    t.scrollTo({ left: n * t.clientWidth, behavior: "smooth" });
  };
  const p = photos[current];

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label="Photo viewer"
      onClose={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: focusable carousel track handles arrow keys */}
      <div
        ref={track}
        tabIndex={-1}
        className="lightbox-track outline-none"
        onScroll={(e) => {
          const t = e.currentTarget;
          setCurrent(Math.round(t.scrollLeft / Math.max(1, t.clientWidth)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(current + 1);
          else if (e.key === "ArrowLeft") go(current - 1);
        }}
      >
        {photos.map((ph) => (
          <figure
            key={ph.id}
            className="m-0 flex h-full items-center justify-center"
          >
            {/* biome-ignore lint/performance/noImgElement: signed full-size URL */}
            <img
              src={ph.url}
              alt={ph.alt ?? ph.caption ?? ""}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
            />
          </figure>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-2 pb-6 pt-[calc(env(safe-area-inset-top)+4px)]">
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="Close"
          className="pointer-events-auto flex size-11 items-center justify-center rounded-full text-white active:bg-white/15"
        >
          <X aria-hidden size={24} />
        </button>
        <span
          className="num text-subhead font-medium text-white/90"
          aria-live="polite"
        >
          {current + 1} of {photos.length}
        </span>
        <span className="size-11" />
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            disabled={current === 0}
            onClick={() => go(current - 1)}
            className="absolute left-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white disabled:opacity-0 md:flex"
          >
            <ChevronLeft aria-hidden size={24} />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            disabled={current === photos.length - 1}
            onClick={() => go(current + 1)}
            className="absolute right-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white disabled:opacity-0 md:flex"
          >
            <ChevronRight aria-hidden size={24} />
          </button>
        </>
      )}
      {p && (p.caption || p.tag || p.takenAt) && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-10 text-white">
          <div className="flex items-center gap-2 text-footnote text-white/80">
            {p.tag && (
              <span className="rounded-pill bg-white/20 px-2 py-px font-semibold text-white">
                {tagLabel(p.tag)}
              </span>
            )}
            {p.takenAt && <span>{p.takenAt}</span>}
          </div>
          {p.caption && <p className="mt-1 text-subhead">{p.caption}</p>}
        </div>
      )}
    </dialog>
  );
}
