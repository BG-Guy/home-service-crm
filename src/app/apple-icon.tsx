import { renderAppIcon } from "./_components/icon-image";

// iOS Home Screen icon, 180×180 (SPEC §12.3). iOS rounds the corners itself.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180);
}
