import { getMapConfig } from "@/adapters/maps";
import { getSettings } from "@/lib/settings";

// Zero-JS static map for the public tracking page (SPEC M19 "small static map"):
// a 5×3 composite of raster tiles centered on the tech, with a pulsing dot and the
// destination pin when it falls inside the frame. No Leaflet on public pages.

const TILE = 256;

function px(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n * TILE,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE,
  };
}

export async function StaticMap({
  center,
  dest,
  zoom = 14,
  height = 220,
  label,
  flush,
}: {
  /** Square corners, for a map that is the top of a card. */
  flush?: boolean;
  center: { lat: number; lng: number };
  dest?: { lat: number; lng: number } | null;
  zoom?: number;
  height?: number;
  label: string;
}) {
  const { tileUrl } = getMapConfig((await getSettings()).map);
  if (!tileUrl) return null;
  const c = px(center.lat, center.lng, zoom);
  const tx = Math.floor(c.x / TILE);
  const ty = Math.floor(c.y / TILE);
  const max = 2 ** zoom;
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const x = (((tx + dx) % max) + max) % max;
      const y = ty + dy;
      if (y < 0 || y >= max) continue;
      tiles.push({
        key: `${dx}:${dy}`,
        src: tileUrl
          .replace("{z}", String(zoom))
          .replace("{x}", String(x))
          .replace("{y}", String(y))
          .replace("{s}", "a")
          .replace("{r}", ""),
        left: (tx + dx) * TILE - c.x,
        top: (ty + dy) * TILE - c.y,
      });
    }
  const d = dest ? px(dest.lat, dest.lng, zoom) : null;
  const dOff = d ? { x: d.x - c.x, y: d.y - c.y } : null;
  const showDest =
    dOff && Math.abs(dOff.x) < 280 && Math.abs(dOff.y) < height / 2 - 12;
  return (
    <div
      role="img"
      aria-label={label}
      className={`map-view relative w-full overflow-hidden bg-fill-2 ${flush ? "" : "rounded-card"}`}
      style={{ height }}
    >
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
            className="absolute max-w-none select-none"
            style={{
              left: `calc(50% + ${t.left}px)`,
              top: `calc(50% + ${t.top}px)`,
            }}
          />
        ))}
      </div>
      {/* Soft fade into the card below, so the map reads as part of the hero */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
      />
      {showDest && dOff && (
        <span
          aria-hidden
          className="absolute flex size-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-br-none bg-label shadow-[var(--shadow-raised)] [rotate:45deg]"
          style={{
            left: `calc(50% + ${dOff.x}px)`,
            top: `calc(50% + ${dOff.y}px)`,
          }}
        >
          <span className="size-2.5 rounded-full bg-bg" />
        </span>
      )}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
      >
        <span
          className="live-dot size-4 border-[3px] border-white shadow-[var(--shadow-raised)]"
          style={{ ["--tone" as string]: "var(--accent)" }}
        />
      </span>
      <span className="absolute right-2 top-1.5 rounded-pill bg-card/80 px-1.5 text-[10px] text-label-2">
        © OpenStreetMap
      </span>
    </div>
  );
}
