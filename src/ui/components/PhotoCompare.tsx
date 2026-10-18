"use client";

import { type CSSProperties, useState } from "react";
import { cx } from "../cx";

/**
 * Before/after slider (SPEC §M11). A transparent native range input covers the
 * image: drag anywhere on desktop, drag the handle on touch, arrow keys from
 * the keyboard, announced by screen readers. Load lazily (`LazyPhotoCompare`).
 */
export function PhotoCompare({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After",
  aspect = "4 / 3",
  initial = 50,
  className,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** CSS aspect-ratio of the frame. */
  aspect?: string;
  /** Initial split, 0–100. */
  initial?: number;
  className?: string;
}) {
  const [pos, setPos] = useState(initial);
  const style = { aspectRatio: aspect, "--pos": `${pos}%` } as CSSProperties;
  return (
    <div
      className={cx(
        "relative select-none overflow-hidden rounded-card bg-fill-2 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-accent",
        className,
      )}
      style={style}
    >
      {/* biome-ignore lint/performance/noImgElement: signed URLs */}
      <img
        src={afterUrl}
        alt={afterLabel}
        className="absolute inset-0 size-full object-cover"
        draggable={false}
        decoding="async"
      />
      {/* biome-ignore lint/performance/noImgElement: signed URLs */}
      <img
        src={beforeUrl}
        alt={beforeLabel}
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: "inset(0 calc(100% - var(--pos)) 0 0)" }}
        draggable={false}
        decoding="async"
      />
      <span className="pointer-events-none absolute left-2 top-2 rounded-pill bg-black/55 px-2 py-0.5 text-caption font-semibold text-white">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-pill bg-black/55 px-2 py-0.5 text-caption font-semibold text-white">
        {afterLabel}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgb(0_0_0/0.4)]"
        style={{ left: "var(--pos)" }}
      >
        <span className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[13px] font-bold text-black shadow-[0_2px_8px_rgb(0_0_0/0.3)]">
          ‹ ›
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => setPos(Number(e.currentTarget.value))}
        aria-label={`${beforeLabel} and ${afterLabel} comparison`}
        aria-valuetext={`${Math.round(pos)}% ${beforeLabel.toLowerCase()}`}
        className="compare-range"
      />
    </div>
  );
}

export default PhotoCompare;
