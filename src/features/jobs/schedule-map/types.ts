// Schedule map view model (client-safe types only). Built by ./queries.ts for
// /schedule?view=map: one day, every tech's route, every job of the day.
import type { JobStatus } from "../contracts";

export interface SmPoint {
  lat: number;
  lng: number;
}

/** One technician's day. `jobIds` is the route order (window start, then created). */
export interface SmTech {
  id: string;
  name: string;
  /** Same color as the schedule board (`techColor`): a hex or `var(--sys-*)`. */
  color: string;
  avatarUrl: string | null;
  /** Home base; the route starts at the first stop without one. */
  start: SmPoint | null;
  jobIds: string[];
  /** Straight-line route miles: start → every located stop in order (1 decimal). */
  miles: number;
  /** First window start / last window end of the day (minutes from local midnight). */
  firstMin: number | null;
  lastMin: number | null;
}

/** One job of the day (cancelled jobs are left out). */
export interface SmJob {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  serviceName: string | null;
  customerId: string;
  customerName: string;
  /** "Dana W." or a company's first words, for the map box. */
  customerShort: string;
  /** Formatted phone when the viewer may see it, else the masked form (or null). */
  phoneLabel: string | null;
  /** The viewer may call through the app (number revealed, contact window). */
  canCall: boolean;
  /** The viewer may open the text thread (messages.send, no opt-out / do-not-text). */
  canText: boolean;
  /** Street (house number masked outside the contact window), city. */
  address: string;
  /** Directions link; null when masked or unknown. */
  navHref: string | null;
  /** Null when the property isn't geocoded or the address is masked. */
  lat: number | null;
  lng: number | null;
  /** Arrival window in minutes from the day's local midnight. */
  startMin: number;
  endMin: number;
  /** Assignees, primary first. Empty = unassigned. */
  techIds: string[];
  /** Description and customer notes, trimmed. */
  notes: string | null;
  /** ISO created time: the tie-breaker for stops with the same window start. */
  createdAt: string;
}

/** Day labels, formatted on the server (no date code in the client chunk). */
export interface SmDayLabels {
  /** "Today", "Tomorrow", "Yesterday", else the weekday. */
  day: string;
  /** "Oct 22" ("Oct 22, 2027" in another year). */
  date: string;
  /** "Thu, Oct 22" */
  short: string;
  prev: string;
  next: string;
}

export interface ScheduleMapData {
  date: string;
  todayKey: string;
  labels: SmDayLabels;
  /** Minutes from local midnight when the page rendered (company zone). */
  nowMin: number;
  /** Epoch ms of that render, so the client can advance the clock. */
  renderedAt: number;
  /** Timeline span (minutes from local midnight, whole hours). */
  dayStartMin: number;
  dayEndMin: number;
  techs: SmTech[];
  jobs: SmJob[];
  tileUrl: string;
  attribution: string;
  /** Where "Set it up" points when the street map is off (null: no link). */
  setupHref: string | null;
  canAssign: boolean;
  canReschedule: boolean;
}

/** Selection mirrored to `?job=` / `?tech=`. */
export interface SmSelection {
  job: string | null;
  tech: string | null;
}
