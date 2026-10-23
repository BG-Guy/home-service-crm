import type {
  DayAvailability,
  DayReason,
  WindowSlot,
} from "@/features/jobs/availability/types";
import { addDaysToKey, formatDateKey } from "@/lib/time";
import type { Tone } from "@/ui/tone";
import type { BookingDone } from "./booking-queries";

// Plain-language labels for the booking flow (Who → What → When → Done). Pure and
// client-safe: the pages, the client components and the tests share them.

// ------------------------------------------------------------------ times and days

const minOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

const clock = (min: number) => {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 || 12;
  return {
    text: m ? `${h}:${String(m).padStart(2, "0")}` : String(h),
    pm: h24 >= 12,
  };
};

/** "8–10 AM", "10 AM–12 PM", "12–2 PM", "4:30–6 PM" (one AM/PM when both ends share it). */
export function arrivalLabel(start: string, end: string): string {
  const a = clock(minOf(start));
  const b = clock(minOf(end));
  const half = (pm: boolean) => (pm ? "PM" : "AM");
  return a.pm === b.pm
    ? `${a.text}–${b.text} ${half(b.pm)}`
    : `${a.text} ${half(a.pm)}–${b.text} ${half(b.pm)}`;
}

/** "Fri, Oct 23". */
export function dayLabel(date: string): string {
  return formatDateKey(date, "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Booked: arrives Fri, Oct 23 · 8–10 AM". */
export function bookedTitle(date: string, start: string, end: string): string {
  return `Booked: arrives ${dayLabel(date)} · ${arrivalLabel(start, end)}`;
}

/** The booking bar line: "Fri · arrives 8–10 AM" ("Today · …", "Tomorrow · …"). */
export function barWhen(
  date: string,
  today: string,
  win?: { start: string; end: string } | null,
): string {
  const day =
    date === today
      ? "Today"
      : date === addDaysToKey(today, 1)
        ? "Tomorrow"
        : formatDateKey(date, "en-US", { weekday: "short" });
  return win ? `${day} · arrives ${arrivalLabel(win.start, win.end)}` : day;
}

/** One day of the week strip: "Today" or the short weekday, the day of the month, and a spoken name. */
export function stripDay(
  date: string,
  today: string,
): { weekday: string; day: number; spoken: string } {
  return {
    weekday:
      date === today
        ? "Today"
        : formatDateKey(date, "en-US", { weekday: "short" }),
    day: Number(date.slice(8, 10)),
    spoken: formatDateKey(date, "en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
  };
}

/** The day (and words) they asked for: "today", "Friday" (within a week), "Fri, Nov 6", "Friday · morning". */
export function requestedDay(
  date: string | null,
  window: string | null,
  today: string,
): string | null {
  let day = "";
  if (date) {
    if (date === today) day = "today";
    else if (date === addDaysToKey(today, 1)) day = "tomorrow";
    else if (date > today && date <= addDaysToKey(today, 6))
      day = formatDateKey(date, "en-US", { weekday: "long" });
    else day = dayLabel(date);
  }
  const words = [day, window?.trim()].filter(Boolean).join(" · ");
  return words || null;
}

/** "asked for Friday · morning" (null when they didn't say). */
export function requestedLabel(
  date: string | null,
  window: string | null,
  today: string,
): string | null {
  const day = requestedDay(date, window, today);
  return day ? `asked for ${day}` : null;
}

// ------------------------------------------------------------------ availability words

/** Why a day has nothing open, when the engine gave a reason (contract 3.5). */
export function dayReason(
  d: DayAvailability | null | undefined,
): DayReason | null {
  return d?.reason ?? null;
}

/** Plain words for a day that can't be booked. */
export function reasonText(
  reason: DayReason,
  ctx: { zip?: string | null; maxMiles?: number | null } = {},
): { title: string; body: string } {
  switch (reason) {
    case "closed":
      return {
        title: "Closed this day",
        body: "Nobody is set to work it. Evenings and weekends open when a tech's working hours include them.",
      };
    case "outside_area":
      return {
        title: "Outside your service area",
        body: ctx.zip
          ? `ZIP ${ctx.zip} isn't one of your service ZIPs, so no window is offered.`
          : "This address isn't in your service ZIPs, so no window is offered.",
      };
    case "far":
      return {
        title: "Too far this day",
        body: `Every tech would drive more than ${ctx.maxMiles ?? 25} extra miles to fit it in.`,
      };
    default:
      return {
        title: "Fully booked",
        body: "No tech has room for another visit that day.",
      };
  }
}

/** The open window with the least extra driving (the "Best" one), else null. */
export function bestWindowStart(windows: readonly WindowSlot[]): string | null {
  let best: WindowSlot | null = null;
  for (const w of windows) {
    if (w.status !== "open") continue;
    const miles = w.suggested?.extraMiles ?? Number.POSITIVE_INFINITY;
    const bestMiles = best?.suggested?.extraMiles ?? Number.POSITIVE_INFINITY;
    if (!best || miles < bestMiles) best = w;
  }
  return best?.start ?? null;
}

const miles = (n: number) => (n < 1 ? "<1" : String(Math.round(n)));

/** The line under a window: "Best · adds 2 mi", "Open", "Full", "Too far"; "· after hours" when that price applies. */
export function windowNote(w: WindowSlot, best: string | null): string {
  if (w.status !== "open")
    return w.reason === "far"
      ? "Too far"
      : w.reason === "closed"
        ? "Closed"
        : "Full";
  const after = w.afterHours ? " · after hours" : "";
  if (w.start !== best) return `Open${after}`;
  const m = w.suggested?.extraMiles;
  return `${m == null ? "Best" : `Best · adds ${miles(m)} mi`}${after}`;
}

/** Day to preselect: the requested day when it's in range, else the best, else the first open one. */
export function pickInitialDay(
  days: readonly DayAvailability[],
  requested: string | null,
): string | null {
  if (requested && days.some((d) => d.date === requested)) return requested;
  return (
    days.find((d) => d.status === "best")?.date ??
    days.find((d) => d.openings > 0)?.date ??
    days[0]?.date ??
    null
  );
}

/** The soonest bookable day after `date` (for "Soonest open: Mon, Oct 26"). */
export function nextOpenDay(
  days: readonly DayAvailability[],
  date: string,
): string | null {
  return days.find((d) => d.date > date && d.openings > 0)?.date ?? null;
}

// ------------------------------------------------------------------ done screen

export interface ConfirmationLabel {
  text: string;
  tone: Tone;
  /** Final for now (stop polling; a tech assigned later changes it). */
  settled: boolean;
}

/**
 * The customer's confirmation, from the real scheduled_messages row. A booking has
 * no tech yet: the confirmation goes out when the Assign hub sets one
 * (job.scheduled), and the Done screen says so plainly.
 */
export function confirmationLabel(
  b: Pick<BookingDone, "techName" | "confirmation" | "ageSec">,
): ConfirmationLabel {
  const c = b.confirmation;
  if (!c) {
    if (!b.techName)
      return {
        text: "Confirmation goes out when a tech is assigned",
        tone: "yellow",
        settled: true,
      };
    return b.ageSec < 15
      ? { text: "Sending confirmation…", tone: "gray", settled: false }
      : { text: "No confirmation sent", tone: "gray", settled: true };
  }
  const what = c.channel === "email" ? "email" : "text";
  const reason = c.reason ?? "";
  switch (c.status) {
    case "scheduled":
      return {
        text: `Confirmation ${what} queued`,
        tone: "blue",
        settled: false,
      };
    case "deferred_quiet":
      return {
        text: `Confirmation ${what} queued for after quiet hours`,
        tone: "blue",
        settled: true,
      };
    case "pending_tap":
      return {
        text: "Confirmation text queued in the outbox",
        tone: "blue",
        settled: true,
      };
    case "sent":
    case "sent_manual":
    case "delivered":
      return {
        text: `Confirmation ${what} sent`,
        tone: "green",
        settled: true,
      };
    case "suppressed_optout":
      return {
        text:
          reason === "do_not_contact"
            ? "Not sent: marked do not contact"
            : "Not sent: they opted out of texts",
        tone: "orange",
        settled: true,
      };
    case "skipped":
      return {
        text: reason.startsWith("no_consent")
          ? "Not sent: no SMS consent"
          : reason === "no_phone" || reason === "no_contact"
            ? "Not sent: no phone number"
            : reason === "test_customer"
              ? "Not sent: test customer"
              : "Not sent",
        tone: "orange",
        settled: true,
      };
    case "failed":
      return {
        text: `Confirmation ${what} failed`,
        tone: "red",
        settled: true,
      };
    default:
      return { text: "Confirmation canceled", tone: "gray", settled: true };
  }
}
