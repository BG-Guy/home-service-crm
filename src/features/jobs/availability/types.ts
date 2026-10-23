// Booking availability contract (client-safe types only). The booking flow
// (/leads/new/schedule) renders exactly this; the engine behind `getAvailability`
// (./index.ts → ./engine.ts) can change without touching the UI. Changes here are
// additive only.
//
// Dates are company-time-zone calendar keys ('YYYY-MM-DD'); times are local
// 'HH:MM' (24 h). A window is an ARRIVAL window: the job's window_start/window_end.
import type { JobKind } from "../kinds";

/**
 * How bookable a day is: `open` = 2+ open windows, `limited` = 1, `full` = none;
 * `best` = one of the top 3 open days (closest to the requested day, else the
 * soonest, then the least extra driving).
 */
export type DayStatus = "best" | "open" | "limited" | "full";

/**
 * Why a day (or a window) has nothing open: nobody works then (`closed`, also
 * today's windows that already started), the job's ZIP is outside the service
 * ZIPs (`outside_area`, days only), the job adds more than the far-job limit of
 * driving for every tech who could take it (`far`), or everyone who works then is
 * booked, capped or not listed for the job (`full`).
 */
export type DayReason = "closed" | "outside_area" | "far" | "full";
export type WindowReason = Exclude<DayReason, "outside_area">;

/** A tech who can take a window, with why. */
export interface TechSuggestion {
  techId: string;
  name: string;
  /** Hex route color (calendar color or the hub palette). */
  color: string;
  avatarUrl: string | null;
  /** Extra straight-line miles the job adds to their day; null when unknown. */
  extraMiles: number | null;
  /** Short reasons, best first ("Adds 2.1 mi", "Free at 10:20 AM", "2 jobs that day"). */
  reasons: string[];
}

export interface WindowSlot {
  /** Local 'HH:MM'. */
  start: string;
  end: string;
  status: "open" | "full";
  /** The best tech for this window (absent when full or nobody fits). */
  suggested?: TechSuggestion;
  /** Everyone else who could take it, best first (excludes `suggested`). */
  alternatives: TechSuggestion[];
  /** Why the window is full (set only when full). */
  reason?: WindowReason;
  /**
   * Outside business hours (or on a weekend when weekends count as after-hours,
   * Settings → Company): the after-hours price applies. Such windows exist only
   * when a tech is set to work then, or with after-hours booking on.
   */
  afterHours?: boolean;
}

export interface DayAvailability {
  date: string;
  status: DayStatus;
  /** Open windows that day. */
  openings: number;
  /** Filled when asked for (`withWindows`), else empty. */
  windows: WindowSlot[];
  /** Why nothing is open (set only when `openings` is 0). */
  reason?: DayReason;
}

export interface AvailabilityAddress {
  street: string;
  city?: string | null;
  state?: string | null;
  zip: string;
}

export interface AvailabilityInput {
  /** First and last day, inclusive ('YYYY-MM-DD'). Days before today are skipped. */
  from: string;
  to: string;
  /** Where the job is: a saved property, else a typed address. */
  propertyId?: string | null;
  address?: AvailabilityAddress | null;
  serviceTypeId?: string | null;
  /** The job type (Free estimate / Service call / Project) when no trade job is picked. */
  kind?: JobKind | null;
  /** Time on site; default: the service type's length, else the job type's. */
  durationMin?: number | null;
  /** The day the customer asked for ('YYYY-MM-DD'): Best days cluster around it. */
  requestedDate?: string | null;
  /** Include each day's windows (the calendar asks per day). */
  withWindows?: boolean;
}
