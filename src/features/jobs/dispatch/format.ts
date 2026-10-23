// Assign hub labels (pure, client-safe): the day and arrival window of a job in
// the "Needs a tech" queue ("Fri 23 · 8–10 AM", the approved sketch; windows in
// the booking flow's words).
import {
  addDaysToKey,
  dateKey,
  formatDateKey,
  parseDateKey,
  zonedParts,
} from "@/lib/time";

const clock = (h24: number, m: number) => {
  const h = h24 % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")}` : String(h);
};
const half = (h24: number) => (h24 < 12 ? "AM" : "PM");

/** "8–10 AM", "10 AM–12 PM", "8:30–10:30 AM"; one time without an end ("8 AM"). */
export function windowRange(
  start: Date | string,
  end: Date | string | null,
  tz: string,
): string {
  const a = zonedParts(start, tz);
  const from = clock(a.hour, a.minute);
  if (!end) return `${from} ${half(a.hour)}`;
  const b = zonedParts(end, tz);
  const to = `${clock(b.hour, b.minute)} ${half(b.hour)}`;
  return half(a.hour) === half(b.hour)
    ? `${from}–${to}`
    : `${from} ${half(a.hour)}–${to}`;
}

/**
 * "Today", "Tomorrow", "Fri 23" within the coming week, else "Fri, Nov 6" (with
 * the year when it isn't this one). Short, so a queue row fits a 300 px column.
 */
export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === addDaysToKey(todayKey, 1)) return "Tomorrow";
  // Intl orders weekday + day as "26 Mon", so build it.
  if (key > todayKey && key < addDaysToKey(todayKey, 7))
    return `${formatDateKey(key, "en-US", { weekday: "short" })} ${parseDateKey(key).day}`;
  return formatDateKey(key, "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: key.slice(0, 4) === todayKey.slice(0, 4) ? undefined : "numeric",
  });
}

/** A queue row's title: "Fri 23 · 8–10 AM" (the day in the company zone). */
export function arrivalLabel(
  start: Date | string,
  end: Date | string | null,
  tz: string,
  todayKey: string,
): string {
  return `${dayLabel(dateKey(start, tz), todayKey)} · ${windowRange(start, end, tz)}`;
}
