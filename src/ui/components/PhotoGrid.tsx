"use client";

import { Star, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { cx } from "../cx";
import { humanize } from "../status";
import { dropStaleFullscreenParam } from "./fullscreen-url";
import { groupPhotos, type Photo, type PhotoGroupSpec } from "./photos";
import { preloadable } from "./preloadable";

export type { Photo, PhotoGroupSpec } from "./photos";

// The full-screen viewer (FullscreenHub + carousel) is its own chunk: it loads
// when a thumbnail is hovered, touched or focused, so a page with photos ships
// only this grid.
const PhotoViewer = preloadable(() =>
  import("./PhotoViewer").then((m) => m.PhotoViewer),
);
const warm = () => void PhotoViewer.preload().catch(() => {});

const GRID: Record<2 | 3 | 4, string> = {
  2: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  3: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  4: "grid-cols-4 md:grid-cols-5 lg:grid-cols-6",
};

/**
 * Photo thumbnails (SPEC §12.6). Tapping one opens `PhotoViewer` full screen
 * at that photo (it grows from the thumbnail); one viewer swipes through every
 * photo of the grid. `groups` splits the grid into sections by tag (Before /
 * After / …, see `JOB_PHOTO_GROUPS`), `layout="strip"` makes one horizontally
 * scrolling row of larger tiles, `actions` adds buttons to the viewer.
 *
 * ```tsx
 * <PhotoGrid photos={photos} columns={3} />
 * <PhotoGrid photos={photos} groups={JOB_PHOTO_GROUPS}
 *   actions={(p) => <IconButton label="Info" onClick={() => show(p.id)}>…</IconButton>} />
 * ```
 */
export function PhotoGrid({
  photos,
  columns = 3,
  layout = "grid",
  tagLabel = humanize,
  showTags,
  groups,
  actions,
  historyKey,
  className,
}: {
  photos: readonly Photo[];
  /** Columns on phones (tablet/desktop add more automatically). */
  columns?: 2 | 3 | 4;
  /** `strip`: one scrolling row of 4:3 tiles with their captions. */
  layout?: "grid" | "strip";
  tagLabel?: (tag: string) => string;
  /** Tag chips on the thumbnails (default: on, off when `groups` names them). */
  showTags?: boolean;
  /** Sections by tag, in this order (empty ones are hidden). */
  groups?: readonly PhotoGroupSpec[];
  /** Buttons for the photo on screen in the viewer (e.g. Info). */
  actions?: (photo: Photo, index: number) => ReactNode;
  /** `?fs=` value while the viewer is open (default "photo"). */
  historyKey?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  // Mounted on the first tap, then kept (its close animation, back/forward).
  const [armed, setArmed] = useState(false);
  const sections = useMemo(
    () =>
      groups
        ? groupPhotos(photos, groups)
        : [{ key: "all", label: "", photos: [...photos], start: 0 }],
    [photos, groups],
  );
  const flat = useMemo(() => sections.flatMap((s) => s.photos), [sections]);
  const n = flat.length;
  const chips = showTags ?? !groups;
  const strip = layout === "strip";

  const tile = (p: Photo, i: number) => (
    <li key={p.id} className={strip ? "w-56 shrink-0 snap-start" : undefined}>
      <button
        type="button"
        data-pi={i}
        aria-haspopup="dialog"
        aria-label={[
          `Open photo ${i + 1} of ${n}`,
          p.tag ? tagLabel(p.tag) : null,
          p.takenAt,
          p.starred ? "starred" : null,
          p.flagged ? "flagged" : null,
        ]
          .filter(Boolean)
          .join(", ")}
        onClick={() => {
          if (index == null) dropStaleFullscreenParam(historyKey ?? "photo");
          setArmed(true);
          setIndex(i);
        }}
        className={cx(
          "pressable relative block w-full overflow-hidden bg-fill-2 outline-offset-2",
          strip ? "aspect-[4/3] rounded-tile" : "aspect-square rounded-xl",
        )}
      >
        {/* biome-ignore lint/performance/noImgElement: pre-sized signed thumbnails */}
        <img
          src={strip ? p.url : p.thumbUrl}
          alt={p.alt ?? p.caption ?? ""}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
        {chips && p.tag ? (
          <span className="absolute bottom-1.5 left-1.5 rounded-pill bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">
            {tagLabel(p.tag)}
          </span>
        ) : null}
        {p.starred || p.flagged ? (
          <span className="absolute right-1 top-1 flex gap-0.5 drop-shadow">
            {p.flagged ? (
              <TriangleAlert
                aria-hidden
                size={16}
                fill="var(--sys-orange)"
                stroke="#fff"
              />
            ) : null}
            {p.starred ? (
              <Star
                aria-hidden
                size={16}
                fill="var(--sys-yellow)"
                stroke="#0006"
              />
            ) : null}
          </span>
        ) : null}
      </button>
      {strip && p.caption ? (
        <p className="mt-1 text-footnote text-label-2">{p.caption}</p>
      ) : null}
    </li>
  );

  const list = (items: readonly Photo[], start: number) => (
    <ul
      className={
        strip
          ? "no-scrollbar -mx-[var(--gutter)] flex snap-x scroll-px-[var(--gutter)] gap-2 overflow-x-auto px-[var(--gutter)]"
          : cx("grid gap-1.5", GRID[columns])
      }
    >
      {items.map((p, k) => tile(p, start + k))}
    </ul>
  );

  return (
    <div
      ref={root}
      className={cx(groups && "flex flex-col gap-4", className)}
      onPointerOver={warm}
      onPointerDown={warm}
      onFocusCapture={warm}
    >
      {groups
        ? sections.map((s) => (
            <section
              key={s.key}
              aria-label={`${s.label} photos`}
              className="flex flex-col gap-2"
            >
              <h3 className="flex items-baseline gap-2 px-1 text-subhead font-semibold">
                {s.label}
                <span className="num text-footnote font-normal text-label-2">
                  {s.photos.length}
                </span>
              </h3>
              {list(s.photos, s.start)}
            </section>
          ))
        : list(flat, 0)}
      {armed ? (
        <PhotoViewer
          photos={flat}
          index={index}
          onIndexChange={setIndex}
          anchor={(i) => root.current?.querySelector(`[data-pi="${i}"]`)}
          tagLabel={tagLabel}
          actions={actions}
          historyKey={historyKey}
        />
      ) : null}
    </div>
  );
}
