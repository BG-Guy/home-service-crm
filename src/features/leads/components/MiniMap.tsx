import { MapPin } from "lucide-react";
import { cx } from "@/ui/cx";

// The lead card's address map: a few raster tiles around the point with a pin,
// no Leaflet (like features/map/components/StaticMap, but client-safe). Without
// coordinates or a street map, a calm drawn placeholder keeps the box's shape.

const TILE = 256;
const ZOOM = 15;

function px(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n * TILE,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE,
  };
}

export function MiniMap({
  lat,
  lng,
  tileUrl,
  label,
  height = 84,
  className,
}: {
  lat: number | null;
  lng: number | null;
  tileUrl: string;
  label: string;
  height?: number;
  className?: string;
}) {
  const has = lat != null && lng != null && !!tileUrl;
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  if (has) {
    const c = px(lat, lng, ZOOM);
    const tx = Math.floor(c.x / TILE);
    const ty = Math.floor(c.y / TILE);
    const max = 2 ** ZOOM;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const x = (((tx + dx) % max) + max) % max;
        const y = ty + dy;
        if (y < 0 || y >= max) continue;
        tiles.push({
          key: `${dx}:${dy}`,
          src: tileUrl
            .replace("{z}", String(ZOOM))
            .replace("{x}", String(x))
            .replace("{y}", String(y))
            .replace("{s}", "a")
            .replace("{r}", ""),
          left: (tx + dx) * TILE - c.x,
          top: (ty + dy) * TILE - c.y,
        });
      }
  }
  return (
    <div
      role="img"
      aria-label={label}
      className={cx(
        "map-view relative w-full overflow-hidden rounded-control bg-fill-2",
        className,
      )}
      // Isolated: once Leaflet's CSS is on the page (the inbox map), `.leaflet-tile-pane`
      // gets z-index 200; this keeps that inside the box (under sticky bars).
      style={{ height, isolation: "isolate" }}
    >
      {has ? (
        <div className="leaflet-tile-pane absolute inset-0">
          {tiles.map((t) => (
            // biome-ignore lint/performance/noImgElement: raster map tiles
            <img
              key={t.key}
              src={t.src}
              alt=""
              width={TILE}
              height={TILE}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                left: `calc(50% + ${t.left}px)`,
                top: `calc(50% + ${t.top}px)`,
              }}
            />
          ))}
        </div>
      ) : (
        // A drawn street corner: two roads and a block, in the surface tokens.
        // biome-ignore lint/a11y/noSvgWithoutTitle: decorative (aria-hidden)
        <svg
          aria-hidden
          className="absolute inset-0 size-full text-label-3"
          preserveAspectRatio="none"
          viewBox="0 0 200 84"
        >
          <path
            d="M-10 60 L210 22"
            stroke="currentColor"
            strokeOpacity=".22"
            strokeWidth="10"
            fill="none"
          />
          <path
            d="M128 -10 L150 94"
            stroke="currentColor"
            strokeOpacity=".22"
            strokeWidth="8"
            fill="none"
          />
          <path
            d="M20 -4 L40 90"
            stroke="currentColor"
            strokeOpacity=".12"
            strokeWidth="5"
            fill="none"
          />
        </svg>
      )}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center"
        // Above the tile pane, as Leaflet's own markers are.
        style={{ zIndex: 600 }}
      >
        <MapPin
          size={28}
          strokeWidth={2.25}
          className="text-white"
          style={{
            fill: "var(--accent)",
            filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.3))",
          }}
        />
      </span>
    </div>
  );
}
