import { getMapConfig } from "@/adapters/maps";

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

export function StaticMap({
  center,
  dest,
  zoom = 14,
  height = 220,
  label,
}: {
  center: { lat: number; lng: number };
  dest?: { lat: number; lng: number } | null;
  zoom?: number;
  height?: number;
  label: string;
}) {
  const { tileUrl } = getMapConfig();
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
      className="map-view relative w-full overflow-hidden rounded-card bg-fill-2"
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
      {showDest && dOff && (
        <span
          aria-hidden
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--sys-red)] shadow"
          style={{
            left: `calc(50% + ${dOff.x}px)`,
            top: `calc(50% + ${dOff.y}px)`,
          }}
        />
      )}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2"
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-40 motion-reduce:animate-none" />
        <span className="relative m-auto size-4 rounded-full border-[3px] border-white bg-accent shadow" />
      </span>
      <span className="absolute bottom-1 right-2 text-[10px] text-label-2">
        © OpenStreetMap
      </span>
    </div>
  );
}
