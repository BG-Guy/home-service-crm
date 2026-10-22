// Booking availability contract (client-safe types only). The call-to-booking flow
// (/leads/new/schedule) renders exactly this; the engine behind `getAvailability`
// (./index.ts) can change without touching the UI.
//
// Dates are company-time-zone calendar keys ('YYYY-MM-DD'); times are local
// 'HH:MM' (24 h). A window is an ARRIVAL window: the job's window_start/window_end.

/** How bookable a day is. `best` = one of the top 3 days in the range. */
export type DayStatus = "best" | "open" | "limited" | "full";

/** A tech who can take a window, with why. */
export interface TechSuggestion {
  techId: string;
  name: string;
  /** Hex route color (calendar color or the hub palette). */
  color: string;
  avatarUrl: string | null;
  /** Extra straight-line miles the job adds to their day; null when unknown. */
  extraMiles: number | null;
  /** Short reasons, best first ("Adds 2.1 mi", "Free 10–12", "2 jobs that day"). */
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
}

export interface DayAvailability {
  date: string;
  status: DayStatus;
  /** Open windows that day. */
  openings: number;
  /** Filled when asked for (`withWindows`), else empty. */
  windows: WindowSlot[];
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
  /** Include each day's windows (the calendar asks per day). */
  withWindows?: boolean;
}
