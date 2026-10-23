// Assign hub view model (client-safe types only). Built by ./queries.ts.
import type { JobStatus } from "../contracts";
import type { Recommendation } from "./recommend";

export interface HubPoint {
  lat: number;
  lng: number;
}

/** One job on a tech's day, in route order. */
export interface HubStop {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  start: string | null;
  end: string | null;
  address: string;
  customerName: string;
  lat: number | null;
  lng: number | null;
  /** 1-based position in the day (pins are numbered with it). */
  seq: number;
}

export type HubTechState = "on_job" | "on_clock" | "off";

export interface HubTech {
  id: string;
  name: string;
  /** Hex route color (the member's calendar color, else a stable palette pick). */
  color: string;
  avatarUrl: string | null;
  clockedIn: boolean;
  state: HubTechState;
  jobs: HubStop[];
  /** Booked hours that day (window lengths). */
  hours: number;
  /** 0–1 share of an 8 h day. */
  load: number;
  /** Route start: home base, else the company address. */
  start: HubPoint | null;
  startLabel: string | null;
  phone: string | null;
  vehicle: string | null;
  skills: string[];
  experienceYears: number | null;
  hireDate: string | null;
  tenure: string | null;
  /**
   * ⚖️ Only filled for viewers with users.manage, or on the viewer's own record.
   * Display only: never passed to the recommendation engine.
   */
  age: number | null;
}

/** A job that needs a tech (or the one being assigned). */
export interface HubJob {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  start: string | null;
  end: string | null;
  minutes: number;
  dayKey: string | null;
  address: string;
  /** Street line only (masked like `address` when the viewer may not see it). */
  street: string;
  customerName: string;
  lat: number | null;
  lng: number | null;
  serviceName: string | null;
  assigneeIds: string[];
}

export interface HubData {
  date: string;
  todayKey: string;
  tz: string;
  isToday: boolean;
  techs: HubTech[];
  /**
   * Needs a tech (build SPEC 3.6): booked jobs with nobody on them, every day from
   * today, soonest first. Capped; `needsTechCount` is the full count (the badge).
   */
  needsTech: HubJob[];
  needsTechCount: number;
  /** Jobs with no date and no tech yet (not booked, so not in the count). */
  undated: HubJob[];
  /** The `?job=` being assigned (null when none or not found). */
  job: HubJob | null;
  /** The job is fixed to another day than the one asked for. */
  movedToJobDay: boolean;
  /** Every available tech, best first (empty without a job). */
  recs: Recommendation[];
  tileUrl: string;
  attribution: string;
  canSetup: boolean;
  canReschedule: boolean;
}
