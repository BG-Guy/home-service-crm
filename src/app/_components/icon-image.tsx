import { ImageResponse } from "next/og";
import { HOUSE_PATH, WRENCH_PATH } from "./BrandMark";

/** Default accent (globals.css --sys-blue). Icons are static, so they use the default. */
export const ICON_BG = "#0088ff";

/**
 * The app icon: the house + wrench glyph on the accent color. `maskable` keeps
 * the glyph inside the 80 % safe zone and fills edge to edge (Android adaptive
 * icons); otherwise the square is full-bleed (iOS rounds its own corners).
 */
export function renderAppIcon(
  size: number,
  { maskable = false, rounded = false } = {},
): ImageResponse {
  const glyph = Math.round(size * (maskable ? 0.56 : 0.7));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ICON_BG,
        borderRadius: rounded ? size * 0.2237 : 0,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 64 64" aria-hidden="true">
        <path d={HOUSE_PATH} fill="#ffffff" />
        <g transform="translate(19 25) scale(1.1)">
          <path
            d={WRENCH_PATH}
            fill="none"
            stroke={ICON_BG}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>,
    { width: size, height: size },
  );
}
