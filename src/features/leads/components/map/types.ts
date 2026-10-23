// Lead map types (leads-flow redesign item 10, contract 3.4). Types only, so the
// server read (`../../map-queries.ts`) and the client map share them.
import type { ReactNode } from "react";
import type { LeadBoxData, LeadMapPoint } from "../../contracts";

/**
 * A lead pin: contract 3.4's `LeadMapPoint` (the color comes from its `seed`, as
 * the box avatar's) plus the service for the pin's accessible name. A plain
 * `LeadMapPoint` (`toMapPoint(box)`) works too.
 */
export interface LeadsMapPoint extends LeadMapPoint {
  /** "Lockout": the trade job or what they asked for (the pin's accessible name). */
  service?: string | null;
}

/** One of today's jobs, a small marker next to the leads (contract 3.4 `jobs`). */
export interface LeadsMapJob {
  id: string;
  lat: number;
  lng: number;
  /** "J-1042 · Lockout · 8–10 AM": tooltip and accessible name. */
  label: string;
  /** Done jobs are muted; live ones (on the way, on site) get a green dot. */
  state?: "planned" | "live" | "done";
}

/** Why an open lead has no pin. */
export type MissingReason =
  /** No street address on the lead (nothing to place). */
  | "no_address"
  /** An address, but no customer property yet (a "Check" lead, an old row). */
  | "no_property"
  /** The property waits for the geocoder (queued, or no geocoder set up). */
  | "pending"
  /** The geocoder couldn't find the address. */
  | "failed";

/** How many open leads can show on the map, and why the rest can't. */
export interface MapCoverage {
  /** Open leads in the inbox: new, contacted and qualified, "Check" left out. */
  total: number;
  /** Of those, the ones with a map position. */
  placed: number;
  missing: Record<MissingReason, number>;
}

/** What `getLeadsMapData()` returns: spread it into `<LazyLeadsMap {...data} />`. */
export interface LeadsMapData {
  points: LeadsMapPoint[];
  jobs: LeadsMapJob[];
  coverage: MapCoverage;
  /** Raster tile template ("" = street map off: pins on a plain surface). */
  tileUrl: string;
  attribution: string;
  /** Settings → Map, for "Street map is off. Set it up" (settings.manage only). */
  setupHref: string | null;
}

/** `LeadsMap` props: contract 3.4 plus the tiles, the drawer and the hand-offs. */
export interface LeadsMapProps {
  points: readonly LeadsMapPoint[];
  jobs: readonly LeadsMapJob[];
  /**
   * The highlighted lead. Leave it out to follow the open lead card (and the
   * last pin tapped once the card closes).
   */
  selectedId?: string | null;
  /**
   * A pin was tapped. The map has already called `useLeadCard().open(id)` when
   * a `LeadCardProvider` is above it, so don't open the card again here.
   */
  onSelect?: (id: string) => void;
  /** `phone`: full-height map with the drawer. `panel`: the desktop column. */
  layout: "panel" | "phone";
  tileUrl: string;
  attribution?: string;
  setupHref?: string | null;
  /** "3 leads aren't on the map" (from `getLeadsMapData`). */
  coverage?: MapCoverage;
  /** Phone drawer: the lead boxes of the current view (rendered as `LeadBox`). */
  boxes?: readonly LeadBoxData[];
  /** Phone drawer body instead of `boxes`: the inbox's own grid. */
  children?: ReactNode;
  /** Phone drawer columns (the inbox's 1 / 2 switch). Default 2. */
  cols?: 1 | 2;
  /** "Show N leads" and the drawer title. Default: `boxes.length` (else the pins). */
  count?: number;
  /** Phone drawer: replaces the "N open leads" title row (status chips, 1 / 2 switch). */
  drawerHeader?: ReactNode;
  /** Phone drawer: under the boxes (load more). */
  drawerFooter?: ReactNode;
  /** Phone: the Grid / Map switch rides on the drawer; Grid calls this. */
  onShowGrid?: () => void;
  className?: string;
}
