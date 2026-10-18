// Demo seed fragment contract (BUILD_PLAN §10.1). Type-only.
import type { DemoPlan } from "./demo-plan";
import type { DemoProfile } from "./profiles/types";

export interface DemoSeedCtx {
  /** Frozen "now" for the whole run (all relative dates derive from it). */
  now: Date;
  /** Company time zone (the profile's; America/Chicago for the default demo). */
  tz: string;
  plan: DemoPlan;
  /** The trade profile the plan was built from (copy for notes, checklists, vendors…). */
  profile: DemoProfile;
  /** Wall-clock time `hhmm` on the day `dayOffset` days from today, in `tz`. */
  at(dayOffset: number, hhmm: string): Date;
  /**
   * For things that already happened (a status change, payment, odometer log):
   * like `at`, but never after `now`. Today's times move back together (by the
   * same shift, so their order holds) when the seed runs before the plan's
   * "past until" clock (DEMO_TODAY_PAST_UNTIL); anything still later is clamped
   * (QA T3-19). Use `at` for appointments that are meant to be in the future.
   */
  atPast(dayOffset: number, hhmm: string): Date;
  /** Clamp a timestamp to at most a minute before `now`. */
  past(d: Date): Date;
  /** Deterministic RNG in [0, 1), forked per fragment. */
  rng(): number;
  log(msg: string): void;
}
