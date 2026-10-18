// Contract types for B7 map (BUILD_PLAN §5.2, §6.7). Types only — client-safe.
import type { TechMapStatus } from "./rules";

export type LocationSharerProps = Record<string, never>;

export interface LiveJobBrief {
  id: string;
  number: string;
  title: string;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  etaAt: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface LiveTech {
  id: string;
  name: string;
  initials: string;
  color: string | null;
  clockedIn: boolean;
  status: TechMapStatus;
  location: {
    lat: number;
    lng: number;
    accuracyM: number | null;
    recordedAt: string;
    source: string;
  } | null;
  currentJob: LiveJobBrief | null;
  nextJob: LiveJobBrief | null;
  /** Rough straight-line ETA to the current (en route) or next job, minutes. */
  etaMinutes: number | null;
}

export interface LiveJob extends LiveJobBrief {
  customerName: string;
  techIds: string[];
  techNames: string[];
}

export interface LiveMapData {
  generatedAt: string;
  techs: LiveTech[];
  jobs: LiveJob[];
  staleMinutes: number;
  hideAfterMinutes: number;
  tileUrl: string;
  attribution: string;
  canAssign: boolean;
  /** Company time zone: window/ETA clock times render in it (not the browser's). */
  timeZone: string;
  /** Viewer may configure integrations (sees setup hints such as map tiles). */
  canSetup: boolean;
}
