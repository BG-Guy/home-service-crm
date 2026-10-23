// Working hours and time off in the Assign hub's ranking (pure, client-safe).
// The booking calendar only offers a window when a tech works then, around their
// time off (availability engine). The hub ranks with `recommendTechs`, which
// knows routes and load but not hours, so here a tech who is off during a booked
// job's arrival window, or on time off then, drops below everyone who can take
// it. They stay listed, not fitting, with why first, so the office can still
// pick them (no auto-assign). Only hours, time off and route timing go in: never
// profile fields (⚖️ no age, see recommend.ts).
import {
  type ArrivalContext,
  type ArrivalJob,
  type ArrivalStop,
  arrivalFit,
  type Recommendation,
  type TimeSpan,
} from "./recommend";

/** A tech's day: working spans and time off (getTechWorkDays, epoch ms). */
export interface WorkDay {
  shifts: readonly TimeSpan[];
  blocks: readonly TimeSpan[];
}

export type OffReason = "Off that day" | "Off then" | "Time off";

/** Why a tech can't take a booked window for hours or time off, else null. */
export function offReason(
  job: ArrivalJob,
  day: WorkDay | undefined,
  stops: readonly ArrivalStop[],
  ctx: ArrivalContext,
): OffReason | null {
  if (!day) return null;
  if (day.shifts.length === 0) return "Off that day";
  const fit = arrivalFit(
    job,
    { shifts: day.shifts, blocks: day.blocks, stops },
    ctx,
  );
  return fit.miss === "off"
    ? "Off then"
    : fit.miss === "time_off"
      ? "Time off"
      : null;
}

/**
 * The ranking with hours and time off: techs in `off` move after the rest (each
 * group keeps its order), are marked not fitting with the reason first, and the
 * ranks are renumbered.
 */
export function rankByWorkHours(
  recs: readonly Recommendation[],
  off: ReadonlyMap<string, OffReason>,
): Recommendation[] {
  if (off.size === 0) return [...recs];
  return recs
    .map((r) => {
      const why = off.get(r.techId);
      return why ? { ...r, fits: false, reasons: [why, ...r.reasons] } : r;
    })
    .sort(
      (a, b) =>
        Number(off.has(a.techId)) - Number(off.has(b.techId)) ||
        a.rank - b.rank,
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
