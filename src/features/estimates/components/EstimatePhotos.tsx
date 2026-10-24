import { TAG_LABEL } from "@/features/media/labels";

// The estimate's photos as the customer sees them (Quote to Paid E6, the owner's
// note: "just display the photos, no effects"): a plain grid, each photo with its
// label chip (Problem / Goal) and its caption. Server-rendered, zero JS; a tap
// opens the full photo.

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
}: {
  photos: readonly EstimatePhoto[];
  title?: string;
}) {
  if (photos.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="px-1 text-title3">{title}</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((p) => (
          <li key={p.id}>
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="relative block overflow-hidden rounded-[14px] bg-fill-2"
            >
              {/* biome-ignore lint/performance/noImgElement: signed storage URL */}
              <img
                src={p.thumbUrl}
                alt={p.caption ?? `${photoTagLabel(p.tag)} photo`}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
              <span className="absolute bottom-1.5 left-1.5 rounded-pill bg-black/60 px-2 py-0.5 text-footnote font-semibold text-white">
                {photoTagLabel(p.tag)}
              </span>
            </a>
            {p.caption ? (
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
