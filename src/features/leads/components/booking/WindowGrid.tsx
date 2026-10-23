"use client";

import { Check } from "lucide-react";
import type {
  DayAvailability,
  WindowSlot,
} from "@/features/jobs/availability/types";
import { cx } from "@/ui/cx";
import {
  arrivalLabel,
  bestWindowStart,
  windowNote,
} from "../../booking-labels";

// The picked day's 2-hour arrival windows ("Arrives 8–10 AM"): open ones are
// big radio cards, full ones are struck through. No tech here: the booking only
// promises the window; the Assign hub picks who goes.

export function WindowGrid({
  day,
  loading,
  selected,
  onSelect,
}: {
  day: DayAvailability | null;
  loading: boolean;
  /** Selected window start ('HH:MM'). */
  selected: string | null;
  onSelect: (w: WindowSlot) => void;
}) {
  if (loading || !day)
    return (
      <div aria-busy className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton block h-[86px] rounded-tile" />
        ))}
      </div>
    );
  const best = bestWindowStart(day.windows);
  return (
    <div
      role="radiogroup"
      aria-label="Arrival window"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {day.windows.map((w) => {
        const full = w.status !== "open";
        const on = w.start === selected;
        const note = windowNote(w, best);
        return (
          // biome-ignore lint/a11y/useSemanticElements: large card radio
          <button
            key={w.start}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={full || undefined}
            aria-label={`Arrives ${arrivalLabel(w.start, w.end)}, ${note}`}
            onClick={() => {
              if (!full) onSelect(w);
            }}
            className={cx(
              "flex min-h-[86px] flex-col items-start justify-center gap-0.5 rounded-tile px-3.5 py-3 text-left transition-[box-shadow,background-color] duration-[var(--dur-quick)]",
              full
                ? "cursor-default bg-fill-2 text-label-3"
                : on
                  ? "pressable ring-2 ring-inset ring-accent"
                  : "pressable bg-card shadow-card hover:shadow-raised",
            )}
            style={
              on && !full
                ? {
                    backgroundColor:
                      "color-mix(in srgb, var(--accent) 6%, var(--card))",
                  }
                : undefined
            }
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span
                className={cx(
                  "text-footnote",
                  full ? "text-label-3" : "text-label-2",
                )}
              >
                Arrives
              </span>
              {on && (
                <span
                  aria-hidden
                  className="flex size-5 items-center justify-center rounded-full bg-accent-fill text-on-accent"
                >
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </span>
            <span
              className={cx(
                "num text-headline",
                full ? "line-through decoration-[1.5px]" : "text-label",
              )}
            >
              {arrivalLabel(w.start, w.end)}
            </span>
            <span
              className={cx(
                "text-footnote",
                full
                  ? "text-label-3"
                  : w.start === best
                    ? "font-semibold text-accent-text"
                    : "text-label-2",
              )}
            >
              {note}
            </span>
          </button>
        );
      })}
    </div>
  );
}
