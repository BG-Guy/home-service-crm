// Photo data for the kit's PhotoGrid / PhotoViewer, plus grouping by tag.
// Plain module (no React, no "use client"): server components, client
// components and tests import it alike.

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
  /** Who took it (display name), shown in the viewer's caption. */
  by?: string | null;
  starred?: boolean;
  /** Needs a second look (no location, possibly from the library…). */
  flagged?: boolean;
  alt?: string;
}

/** One section of a grouped grid: photos whose tag is `key` (or one of `tags`). */
export interface PhotoGroupSpec {
  key: string;
  label: string;
  /** Tags that belong here (default `[key]`). */
  tags?: readonly string[];
}

export interface PhotoGroup<P> {
  key: string;
  label: string;
  photos: P[];
  /** Index of the group's first photo in the flattened (viewer) order. */
  start: number;
}

/** Job photos: Before, During, After, Problem; anything else under Other. */
export const JOB_PHOTO_GROUPS: readonly PhotoGroupSpec[] = [
  { key: "before", label: "Before" },
  { key: "during", label: "During" },
  { key: "after", label: "After" },
  { key: "problem", label: "Problem" },
  { key: "other", label: "Other" },
];

/**
 * Splits `photos` into `specs` order. A photo joins the first group that lists
 * its tag; untagged and unknown tags join the `fallback` group (added as
 * "Other" at the end when `specs` has none). Empty groups are dropped and the
 * photos keep their order inside a group, so concatenating the groups gives
 * the order the viewer swipes through (`start` is each group's offset in it).
 */
export function groupPhotos<P extends { tag?: string | null }>(
  photos: readonly P[],
  specs: readonly PhotoGroupSpec[] = JOB_PHOTO_GROUPS,
  fallback = "other",
): PhotoGroup<P>[] {
  const all = specs.some((s) => s.key === fallback)
    ? specs
    : [...specs, { key: fallback, label: "Other" }];
  const slot = new Map<string, number>();
  all.forEach((s, i) => {
    for (const t of s.tags ?? [s.key]) if (!slot.has(t)) slot.set(t, i);
  });
  const other = all.findIndex((s) => s.key === fallback);
  const buckets: P[][] = all.map(() => []);
  for (const p of photos) {
    const i = (p.tag ? slot.get(p.tag) : undefined) ?? other;
    buckets[i]?.push(p);
  }
  const out: PhotoGroup<P>[] = [];
  let start = 0;
  all.forEach((s, i) => {
    const list = buckets[i] ?? [];
    if (list.length === 0) return;
    out.push({ key: s.key, label: s.label, photos: list, start });
    start += list.length;
  });
  return out;
}

/** The photo's accessible text: its alt, else caption, else "<Tag> photo". */
export function photoAlt(
  p: Pick<Photo, "alt" | "caption" | "tag">,
  tagLabel: (tag: string) => string,
): string {
  return p.alt ?? p.caption ?? (p.tag ? `${tagLabel(p.tag)} photo` : "Photo");
}

/** Size of an image fitted inside a box (object-fit: contain). */
export function containSize(
  natural: { w: number; h: number },
  box: { w: number; h: number },
): { w: number; h: number } {
  if (natural.w <= 0 || natural.h <= 0) return { w: box.w, h: box.h };
  const s = Math.min(box.w / natural.w, box.h / natural.h);
  return { w: natural.w * s, h: natural.h * s };
}
