// Lead map pins (pure, client-safe; tests/leads/leads-map.test.ts). What a pin
// draws, which pins stay full size, where the name tag goes and the coverage
// note. Decluttering is the shared src/lib/declutter.ts rule the schedule map
// and the live map use: a pin shows full size where it covers no other pin's
// dot, else it folds to a dot that opens up again as you zoom in.
import {
  declutter,
  type LabelSide,
  placeLabels,
  type Rect,
} from "@/lib/declutter";
import { TONE_VAR, toneFor } from "@/ui/tone";
import { slaTone } from "../../labels";
import type {
  LeadsMapJob,
  LeadsMapPoint,
  MapCoverage,
  MissingReason,
} from "./types";

/** Pin diameter: a card-colored disc carrying the timer ring and the initials. */
export const PIN = 40;
/** A folded pin (the same pin scaled down, so it animates on transform only). */
export const DOT = 22;
/** Below this zoom every pin is a dot (the whole metro at a glance). */
export const MIN_PIN_ZOOM = 9;
/** The ring fills toward the red line, as on the box avatars (SlaAvatar). */
export const RING_MS = 15 * 60_000;
/** Pins at one spot (several leads at one building) fan out sideways by this much. */
export const FAN = PIN + 4;
/** M12: at most two live pulses on screen. */
export const MAX_PULSES = 2;

/**
 * The declutter settings for lead pins: the "box" is the pin itself, centered on
 * its point (a negative tail of half its height), and the "dot" is the core of a
 * folded pin that must stay visible (a full pin may overlap a dot's rim).
 */
export const PIN_DECLUTTER = {
  boxH: PIN,
  tail: -PIN / 2,
  dot: 10,
  gap: 2,
} as const;

type PinFacts = Pick<LeadsMapPoint, "status" | "slaStart" | "respondedAt">;

/**
 * Lower first: unanswered new leads (the longest wait first), then answered new
 * ones, contacted, qualified. Decides who keeps a full pin and who draws on top.
 */
export function pinPriority(p: PinFacts): number {
  const rank =
    p.status === "new"
      ? p.respondedAt
        ? 1
        : 0
      : p.status === "contacted"
        ? 2
        : 3;
  return rank * 1e13 + (Date.parse(p.slaStart) || 0);
}

export interface PinRing {
  /** 0–1 of the way to the red line. */
  progress: number;
  tone: "green" | "orange" | "red";
}

/**
 * The timer ring, exactly like the box avatar (SlaAvatar): it fills toward
 * 15 minutes, green under 5, amber under 15, red beyond, and freezes at the first
 * response. Empty until the clock is known (server render, hydration).
 */
export function pinRing(p: PinFacts, now: number | null): PinRing {
  const start = Date.parse(p.slaStart);
  const end = p.respondedAt ? Date.parse(p.respondedAt) : null;
  const at = end ?? now;
  if (at == null || Number.isNaN(start)) return { progress: 0, tone: "green" };
  const elapsed = Math.max(0, at - start);
  return {
    progress: Math.min(1, elapsed / RING_MS),
    tone: slaTone(elapsed / 60_000),
  };
}

/** M12: the newest unanswered leads still inside the red line pulse (two at most). */
export function pulseIds(
  points: readonly (PinFacts & { id: string })[],
  now: number | null,
  max = MAX_PULSES,
): Set<string> {
  if (now == null) return new Set();
  return new Set(
    points
      .filter(
        (p) =>
          p.status === "new" &&
          !p.respondedAt &&
          now - Date.parse(p.slaStart) < RING_MS,
      )
      .sort((a, b) => Date.parse(b.slaStart) - Date.parse(a.slaStart))
      .slice(0, max)
      .map((p) => p.id),
  );
}

/**
 * Sideways offsets (px) for pins on the same spot: 0, +44, −44, +88… in input
 * order, so leads at one building sit side by side instead of hiding each other.
 */
export function fanOut(
  points: readonly { id: string; lat: number; lng: number }[],
): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const p of points) {
    const at = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const n = seen.get(at) ?? 0;
    seen.set(at, n + 1);
    out.set(p.id, n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * FAN);
  }
  return out;
}

export interface PinSpot {
  id: string;
  /** Screen position of the pin's center (px, the map container). */
  x: number;
  y: number;
  /** `pinPriority`. */
  priority: number;
}

/**
 * Which pins show full size at this zoom (the rest fold to dots): the shared
 * declutter rule with the pin centered on its point. Greedy by priority; the
 * selected pin always shows full size; below `MIN_PIN_ZOOM` only it does.
 */
export function layoutPins(
  spots: readonly PinSpot[],
  o: { zoom: number; selected?: string | null },
): Set<string> {
  return declutter(
    spots.map((s) => ({ ...s, w: PIN, h: PIN })),
    {
      ...PIN_DECLUTTER,
      dotsOnly: o.zoom < MIN_PIN_ZOOM,
      force: o.selected ? new Set([o.selected]) : undefined,
    },
  );
}

/**
 * Where a pin's name tag goes (the selected or hovered pin): below, right, left
 * or above, the first side clear of the other pins and inside the map; null when
 * none is (`placeLabels`, as the live map places tech names).
 */
export function tagSide(
  pin: { id: string; x: number; y: number; full: boolean },
  tag: { w: number; h: number },
  others: readonly Rect[],
  bounds: { w: number; h: number },
): LabelSide | null {
  return (
    placeLabels(
      [
        {
          id: pin.id,
          x: pin.x,
          y: pin.y,
          r: (pin.full ? PIN : DOT) / 2,
          w: tag.w,
          h: tag.h,
        },
      ],
      { gap: 6, avoid: others, bounds },
    ).get(pin.id) ?? null
  );
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The avatar color of a pin (the same seed and palette as the box avatar). */
export const pinColor = (p: Pick<LeadsMapPoint, "id" | "seed">): string =>
  TONE_VAR[toneFor(p.seed || p.id)];

/** The ring color of a tone. */
export const ringColor = (tone: PinRing["tone"]): string => TONE_VAR[tone];

/**
 * A pin's HTML (a Leaflet divIcon). Ring progress, ring tone, selection, the
 * pulse and the folded state are CSS variables and data attributes set later, so
 * the clock and a tap never rebuild it.
 */
export function pinHtml(p: LeadsMapPoint, dx: number): string {
  return `<div class="lm-m" data-ring="0" style="--c:${esc(pinColor(p))};left:${dx}px"><div class="lm-p"><svg class="lm-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="lm-trk" cx="20" cy="20" r="18.25"/><circle class="lm-arc" cx="20" cy="20" r="18.25" pathLength="100"/></svg><span class="lm-av" aria-hidden="true">${esc(p.initials)}</span></div><span class="lm-tag" aria-hidden="true">${esc(p.name)}</span></div>`;
}

const BRIEFCASE =
  '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm2 0h2V5h-2zM5 12.5V18h14v-5.5h-5V14h-4v-1.5z" style="fill:currentColor"/></svg>';

/** A job marker's HTML: a small dark square with a briefcase. */
export function jobHtml(j: Pick<LeadsMapJob, "state">): string {
  return `<div class="lm-j" data-st="${j.state ?? "planned"}">${BRIEFCASE}</div>`;
}

/** The pin's accessible name: "Jacob W., lockout, new, waiting 4 min". */
export function pinLabel(p: LeadsMapPoint, now: number | null): string {
  const parts = [p.name];
  if (p.service?.trim()) parts.push(p.service.trim().toLowerCase());
  parts.push(p.status);
  if (p.status === "new" && !p.respondedAt && now != null) {
    const m = Math.max(0, Math.floor((now - Date.parse(p.slaStart)) / 60_000));
    parts.push(
      m < 60
        ? `waiting ${m} min`
        : `waiting ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`,
    );
  }
  return `${parts.join(", ")}. Open the lead card.`;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const WHY: Record<MissingReason, (n: number) => string> = {
  no_address: (n) => `${plural(n, "has", "have")} no address yet`,
  no_property: (n) =>
    `${plural(n, "address isn't", "addresses aren't")} saved to a customer yet`,
  pending: (n) => `${plural(n, "is", "are")} still being placed on the map`,
  failed: (n) =>
    `${plural(n, "address wasn't", "addresses weren't")} found on the map`,
};

/**
 * The map's coverage note: "4 of 6 leads on the map" with one line per reason,
 * or null when every open lead has a pin.
 */
export function coverageNote(
  c: MapCoverage | null | undefined,
): { title: string; lines: string[] } | null {
  if (!c || c.total === 0 || c.placed >= c.total) return null;
  const order: MissingReason[] = [
    "no_address",
    "no_property",
    "pending",
    "failed",
  ];
  return {
    title: `${c.placed} of ${plural(c.total, "lead", "leads")} on the map`,
    lines: order
      .filter((k) => c.missing[k] > 0)
      .map((k) => WHY[k](c.missing[k])),
  };
}
