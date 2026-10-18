// Quiet hours (docs/SPEC.md M12): customer messages may be sent only inside the
// allowed window (default 08:00–20:00) in the RECIPIENT's time zone. Out-of-window
// sends are deferred to the next window start + jitter (0–30 min).
// Pure and isomorphic.
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedParts,
  zonedTimeToUtc,
} from "./time";

/** Allowed sending window as local wall-clock "HH:MM" (start inclusive, end exclusive). */
export interface SendWindow {
  start: string;
  end: string;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { start: "08:00", end: "20:00" };
export const DEFAULT_JITTER_MINUTES = 30;

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new RangeError(`invalid time "${hhmm}" (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) {
    throw new RangeError(`invalid time "${hhmm}"`);
  }
  return h * 60 + min;
}

/** Minute-of-day (0–1439) of `at` in `timeZone`. */
function localMinuteOfDay(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

/** True when `at` falls inside the allowed window (handles windows that wrap midnight). */
export function isInsideSendWindow(
  at: Date,
  timeZone: string,
  window: SendWindow = DEFAULT_SEND_WINDOW,
): boolean {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  if (start === end) return true; // degenerate window = always allowed
  const m = localMinuteOfDay(at, timeZone);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** True when `at` is within quiet hours (i.e. outside the allowed window). */
export function isQuietHours(
  at: Date,
  timeZone: string,
  window: SendWindow = DEFAULT_SEND_WINDOW,
): boolean {
  return !isInsideSendWindow(at, timeZone, window);
}

export interface NextSendOptions {
  window?: SendWindow;
  /** Max random delay added after the window opens (default 30). 0 disables jitter. */
  jitterMinutes?: number;
  /** Injectable RNG in [0, 1) for deterministic tests. */
  random?: () => number;
}

/**
 * Earliest time ≥ `at` when a message may be sent. Returns `at` unchanged when the
 * window is open; otherwise the next local window start plus jitter. DST-safe.
 */
export function nextAllowedSendTime(
  at: Date,
  timeZone: string,
  {
    window = DEFAULT_SEND_WINDOW,
    jitterMinutes = DEFAULT_JITTER_MINUTES,
    random = Math.random,
  }: NextSendOptions = {},
): Date {
  if (isInsideSendWindow(at, timeZone, window)) return at;
  const start = toMinutes(window.start);
  const startH = Math.floor(start / 60);
  const startM = start % 60;
  const today = dateKey(at, timeZone);
  const minuteNow = localMinuteOfDay(at, timeZone);
  // Before today's start → today; otherwise → tomorrow.
  const key = minuteNow < start ? today : addDaysToKey(today, 1);
  const opens = zonedTimeToUtc(
    { ...parseDateKey(key), hour: startH, minute: startM },
    timeZone,
  );
  const jitterMs =
    jitterMinutes > 0 ? Math.floor(random() * jitterMinutes * 60) * 1000 : 0;
  return new Date(opens.getTime() + jitterMs);
}
