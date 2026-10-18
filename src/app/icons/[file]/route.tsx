import { renderAppIcon } from "../../_components/icon-image";

// PWA manifest icons (SPEC §12.3): 192, 512 and a 512 maskable. Prerendered at
// build (generateStaticParams + dynamicParams=false), served from /icons/*.png.
const ICONS = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
} as const;

type IconFile = keyof typeof ICONS;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const spec = ICONS[file as IconFile];
  if (!spec) return new Response("Not found", { status: 404 });
  const res = renderAppIcon(spec.size, { maskable: spec.maskable });
  res.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return res;
}
