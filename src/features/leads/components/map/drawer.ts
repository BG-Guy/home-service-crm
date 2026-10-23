// The phone map's drawer of lead boxes (pure; tests/leads/leads-map.test.ts).
// Three detents like the Life360 drawer: peek (the header and a first glimpse of
// the boxes), half and full (the boxes cover the map). Dragging it down past the
// peek line puts it away: the map goes full screen. Positions are the drawer's
// top edge in px from the top of the map region; the drawer moves on transform.

export type Detent = "peek" | "half" | "full";
export const DETENTS: readonly Detent[] = ["peek", "half", "full"];

/** Share of the region the drawer covers at half. */
export const HALF = 0.55;
/** Share of the region the drawer covers at peek… */
export const PEEK = 0.3;
/** …and at least this much above whatever sits at the bottom (the tab bar): the
 * handle, the count line and the chips, and the top of the first boxes. */
export const PEEK_MIN = 150;
/** Where "away" parks the drawer: below the region by this much (its shadow too). */
export const AWAY_GAP = 24;
/** A flick carries the drawer as far as it would travel in this time. */
export const PROJECT_MS = 180;
/** Past the peek line by this share of the peek height, a release puts it away. */
export const AWAY_AT = 0.35;

export type DrawerTops = Record<Detent | "away", number>;

/**
 * The drawer's top edge at each detent for a map region `h` px tall, with
 * `bottomInset` px covered at the bottom (the floating tab bar). Always
 * full ≤ half ≤ peek < away.
 */
export function detentTops(h: number, bottomInset = 0): DrawerTops {
  const H = Math.max(0, h);
  const peekShown = Math.min(H, Math.max(H * PEEK, bottomInset + PEEK_MIN));
  const peek = Math.round(H - peekShown);
  const half = Math.min(Math.round(H * (1 - HALF)), peek);
  return { full: 0, half, peek, away: Math.round(H) + AWAY_GAP };
}

/**
 * Where a released drawer settles: the detent nearest to where the flick would
 * carry it (`top + velocity × 180 ms`, velocity in px/ms, positive downward), or
 * "away" once that lands far enough below the peek line.
 */
export function snapDrawer(
  top: number,
  velocity: number,
  tops: DrawerTops,
): Detent | "away" {
  const to = top + velocity * PROJECT_MS;
  const peekShown = tops.away - AWAY_GAP - tops.peek;
  if (to > tops.peek + Math.max(24, peekShown * AWAY_AT)) return "away";
  let best: Detent = "peek";
  for (const d of DETENTS)
    if (Math.abs(tops[d] - to) < Math.abs(tops[best] - to)) best = d;
  return best;
}

/** One step up (`1`, bigger) or down (`-1`); down from peek is "away". */
export function stepDetent(d: Detent, dir: 1 | -1): Detent | "away" {
  const i = DETENTS.indexOf(d) + dir;
  if (i < 0) return "away";
  return DETENTS[Math.min(i, DETENTS.length - 1)] as Detent;
}

/** Tapping the grab handle: peek → half → full → peek. */
export function cycleDetent(d: Detent): Detent {
  return d === "peek" ? "half" : d === "half" ? "full" : "peek";
}

/**
 * The drawer's position while a finger drags it: free between full and away,
 * with a rubber band above full (a third of the pull).
 */
export function dragTop(raw: number, tops: DrawerTops): number {
  if (raw < tops.full) return tops.full - (tops.full - raw) / 3;
  return Math.min(raw, tops.away);
}

/** The drawer handle's accessible name. */
export const DETENT_LABEL: Record<Detent, string> = {
  peek: "Leads list, small. Activate to resize, or drag.",
  half: "Leads list, half height. Activate to resize, or drag.",
  full: "Leads list, full height. Activate to resize, or drag.",
};

/** Release velocity (px/ms, + = down) from the last ~100 ms of samples. */
export function releaseVelocity(
  samples: readonly { t: number; y: number }[],
): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i] as { t: number; y: number };
    if (last.t - s.t > 100) break;
    first = s;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
