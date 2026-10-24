import { TAG_LABEL } from "@/features/media/labels";
import { cx } from "@/ui/cx";

// The estimate's photos (Quote to Paid E6, the owner's note: "just display the
// photos, no effects"): a plain grid, each photo with its label chip (Problem /
// Goal) and, full size, its caption. Server-rendered, zero JS; a tap opens the
// full photo. The customer page uses the full size, the builder `compact`.

export interface EstimatePhoto {
  id: string;
  url: string;
  thumbUrl: string;
  caption: string | null;
  tag: string | null;
}

export const photoTagLabel = (tag: string | null): string =>
  (tag ? TAG_LABEL[tag as keyof typeof TAG_LABEL] : null) ?? "Photo";

export function EstimatePhotos({
  photos,
  title = "Photos",
  compact,
}: {
  photos: readonly EstimatePhoto[];
  /** The heading (null: none, the caller has its own). */
  title?: string | null;
  compact?: boolean;
}) {
  if (photos.length === 0) return null;
  return (
    <section aria-label={title ?? "Photos"} className="space-y-2">
      {title ? <h2 className="px-1 text-title3">{title}</h2> : null}
      <ul
        className={cx(
          "grid",
          compact ? "grid-cols-4 gap-1.5" : "grid-cols-2 gap-2 sm:grid-cols-3",
        )}
      >
        {photos.map((p) => (
          <li key={p.id}>
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cx(
                "relative block overflow-hidden bg-fill-2",
                compact ? "rounded-[12px]" : "rounded-[14px]",
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: signed storage URL */}
              <img
                src={p.thumbUrl}
                alt={p.caption ?? `${photoTagLabel(p.tag)} photo`}
                loading="lazy"
                className={cx(
                  "w-full object-cover",
                  compact ? "aspect-square" : "aspect-[4/3]",
                )}
              />
              <span
                className={cx(
                  "absolute bottom-1.5 left-1.5 rounded-pill bg-black/60 font-semibold text-white",
                  compact
                    ? "px-1.5 py-px text-caption"
                    : "px-2 py-0.5 text-footnote",
                )}
              >
                {photoTagLabel(p.tag)}
              </span>
            </a>
            {p.caption && !compact ? (
              <p className="mt-1 px-0.5 text-footnote text-label-2">
                {p.caption}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
