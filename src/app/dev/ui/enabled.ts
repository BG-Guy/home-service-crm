/** The dev UI gallery 404s in production unless DEV_UI=1. */
export function devUiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEV_UI === "1";
}
