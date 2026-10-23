// Technician route colors (pure, client-safe): the Assign hub, the schedule map
// and the availability loader all paint a tech the same way.

const PALETTE = [
  "#0a84ff",
  "#34c759",
  "#ff9500",
  "#af52de",
  "#ff2d55",
  "#00b3c7",
  "#5856d6",
  "#d4a106",
];

/** A tech's route color: their calendar color, else a stable palette pick. */
export function colorFor(id: string, own: string | null): string {
  if (own && /^#[0-9a-f]{6}$/i.test(own)) return own;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length] as string;
}
