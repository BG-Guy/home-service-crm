import { renderAppIcon } from "./_components/icon-image";

// Browser tab icon (Next file convention → <link rel="icon">). Static at build time.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return renderAppIcon(32, { rounded: true });
}
