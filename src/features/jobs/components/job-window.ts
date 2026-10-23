import { formatInTz } from "@/lib/time";

// The job card's and the peek's arrival-window line (plain module: client-safe).

/** "9–11 AM", "Tue, Oct 27 · 9–11 AM", or "No date yet". */
export function jobWindowLabel(
  start: string | null,
  end: string | null,
  tz: string,
  withDate = false,
): string {
  if (!start) return "No date yet";
  const t = (iso: string) =>
    formatInTz(iso, tz, { hour: "numeric", minute: "2-digit" }).replace(
      ":00",
      "",
    );
  const a = t(start);
  const b = end ? t(end) : null;
  // "9 AM–11 AM" → "9–11 AM" when both are in the same half of the day.
  const range =
    b && a.slice(-2) === b.slice(-2)
      ? `${a.slice(0, -3)}–${b}`
      : b
        ? `${a}–${b}`
        : a;
  return withDate
    ? `${formatInTz(start, tz, { weekday: "short", month: "short", day: "numeric" })} · ${range}`
    : range;
}
