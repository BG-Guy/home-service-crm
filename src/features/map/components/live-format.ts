// Display helpers shared by the live map's side list and its wall-mode legend
// (pure, client-safe).
import { formatTime } from "@/lib/time";
import type { TechMapStatus } from "../rules";

/** Pill / avatar-ring tone of a tech's live status. */
export const STATUS_TONE: Record<
  TechMapStatus,
  "green" | "teal" | "orange" | "gray"
> = {
  on_job: "green",
  en_route: "teal",
  idle: "orange",
  off: "gray",
};

/** List order: on the way first, then working, idle, off. */
export const STATUS_ORDER: Record<TechMapStatus, number> = {
  en_route: 0,
  on_job: 1,
  idle: 2,
  off: 3,
};

/** "just now", "3 min ago", "2 h ago", "1 d ago". */
export function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** A clock time in the company zone, or null. */
export const time = (iso: string | null, tz: string) =>
  iso ? formatTime(iso, tz) : null;
