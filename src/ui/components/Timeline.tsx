import { Circle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatMiles } from "@/lib/geo";
import {
  addDaysToKey,
  DEFAULT_TIMEZONE,
  dateKey,
  formatDateKey,
  formatTime,
} from "@/lib/time";
import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";

export interface TimelineItem {
  id: string;
  at: Date | string | number;
  title: ReactNode;
  body?: ReactNode;
  /** Glyph for the kind (lucide icon at 14–15 px). */
  icon?: ReactNode;
  tone?: Tone;
  /** Who did it, e.g. "Maria" or "System". */
  actor?: ReactNode;
  href?: string;
  /** Trailing content (thumbnail, amount, StatusPill). */
  aside?: ReactNode;
}

/**
 * Activity feed grouped by day ("Today", "Yesterday", "Mon, Oct 12", sentence
 * case) in the company time zone. Presentational: the caller maps activity rows
 * to items (icon/tone per kind) and handles pagination. For a trip-style
 * progress track (done / current / upcoming) use `TripTimeline` below.
 */
export function Timeline({
  items,
  timeZone = DEFAULT_TIMEZONE,
  now = new Date(),
  locale = "en-US",
  className,
}: {
  items: readonly TimelineItem[];
  timeZone?: string;
  /** Reference time for Today/Yesterday labels. */
  now?: Date;
  locale?: string;
  className?: string;
}) {
  const today = dateKey(now, timeZone);
  const yesterday = addDaysToKey(today, -1);
  const groups: { key: string; items: TimelineItem[] }[] = [];
  for (const it of items) {
    const k = dateKey(it.at, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(it);
    else groups.push({ key: k, items: [it] });
  }
  const dayLabel = (k: string) =>
    k === today
      ? "Today"
      : k === yesterday
        ? "Yesterday"
        : formatDateKey(k, locale, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: k.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
          });

  return (
    <div className={cx("flex flex-col gap-6", className)}>
      {groups.map((g) => (
        <section key={g.key} aria-label={dayLabel(g.key)}>
          <h3 className="mb-2.5 px-1 text-subhead font-semibold text-label-2">
            {dayLabel(g.key)}
          </h3>
          <ol className="relative">
            {g.items.map((it, i) => {
              const content = (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 text-subhead">
                      <span className="font-medium">{it.title}</span>
                      {it.actor && (
                        <span className="text-label-2"> · {it.actor}</span>
                      )}
                    </div>
                    <time
                      dateTime={new Date(it.at).toISOString()}
                      className="num shrink-0 text-footnote text-label-2"
                    >
                      {formatTime(it.at, timeZone, locale)}
                    </time>
                  </div>
                  {it.body && (
                    <div className="mt-0.5 whitespace-pre-line break-words text-footnote text-label-2">
                      {it.body}
                    </div>
                  )}
                  {it.aside && <div className="mt-2">{it.aside}</div>}
                </>
              );
              return (
                <li key={it.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < g.items.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute bottom-1 left-[15px] top-9 w-0.5 rounded-full bg-fill"
                    />
                  )}
                  <span
                    aria-hidden
                    className="tint-bg tint-fg relative flex size-8 shrink-0 items-center justify-center rounded-full"
                    style={toneStyle(it.tone ?? "gray")}
                  >
                    {it.icon ?? <Circle size={8} fill="currentColor" />}
                  </span>
                  <div className="min-w-0 flex-1 pt-1.5">
                    {it.href ? (
                      <Link
                        href={it.href}
                        transitionTypes={["nav-forward"]}
                        className="-m-1 block rounded-control p-1 hover:bg-fill-2"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TripTimeline                                                               */
/* -------------------------------------------------------------------------- */

export type TripStepState = "done" | "current" | "upcoming";

export interface TripStep {
  id: string;
  state: TripStepState;
  title: ReactNode;
  /** Second line (address, customer, note). */
  body?: ReactNode;
  /** Left column, pre-formatted ("9:30 AM", "Tue"). Omit on every step to drop the column. */
  time?: ReactNode;
  /** Makes the step's text a push link. */
  href?: string;
  /** Trailing content (StatusPill, amount). */
  aside?: ReactNode;
  /** Straight-line miles from the previous step (a route), shown on the line between them. */
  miles?: number | null;
}

/**
 * Trip-progress timeline in the Uber style (DESIGN.md §5): times on the left, a
 * vertical rail with dots (done = filled ink, current = accent with the M12
 * pulse, upcoming = hollow) and the step text. For a job's status track, a
 * tech's route for the day, or the customer's tracking page. Server-renderable.
 *
 * ```tsx
 * <TripTimeline label="Today's route" steps={[
 *   { id: "1", state: "done", time: "8:00 AM", title: "Rekey 3 locks", body: "12 Oak St" },
 *   { id: "2", state: "current", time: "10:30 AM", title: "Lockout", body: "4 Elm Ave" },
 *   { id: "3", state: "upcoming", time: "1:00 PM", title: "Smart lock install" },
 * ]} />
 * ```
 */
export function TripTimeline({
  steps,
  label,
  live = true,
  className,
}: {
  steps: readonly TripStep[];
  /** Accessible name of the list (e.g. "Today's route"). */
  label?: string;
  /** Pulse the current step's dot (default true; at most two pulses per screen). */
  live?: boolean;
  className?: string;
}) {
  const times = steps.some((s) => s.time != null);
  return (
    <ol aria-label={label} className={cx("flex flex-col", className)}>
      {steps.map((st, i) => {
        const next = steps[i + 1];
        const doneLine = st.state === "done" && next != null;
        const content = (
          <>
            <div
              className={cx(
                "text-body",
                st.state === "current" && "font-semibold",
                st.state === "done" ? "text-label-2" : "text-label",
              )}
            >
              {st.title}
            </div>
            {st.body != null && (
              <div className="text-subhead text-label-2">{st.body}</div>
            )}
          </>
        );
        return (
          <li
            key={st.id}
            aria-current={st.state === "current" ? "step" : undefined}
            className={cx(
              "grid gap-x-3",
              times ? "grid-cols-[4.25rem_20px_1fr]" : "grid-cols-[20px_1fr]",
            )}
          >
            {times && (
              <div
                className={cx(
                  "num relative whitespace-nowrap pt-[3px] text-right text-footnote",
                  st.state === "current"
                    ? "font-semibold text-label"
                    : "text-label-2",
                )}
              >
                {st.time}
                {next?.miles != null && (
                  // The leg's miles, against the line halfway to the next stop.
                  <span
                    className="absolute right-0 text-caption font-medium text-label-3"
                    style={{
                      top: "calc(50% + 11px)",
                      transform: "translateY(-50%)",
                    }}
                  >
                    {formatMiles(next.miles)}
                  </span>
                )}
              </div>
            )}
            <div aria-hidden className="relative flex justify-center">
              {st.state === "current" ? (
                <span
                  className={cx(
                    "relative z-[1] mt-1.5 size-3 rounded-full",
                    live && "live-dot",
                  )}
                  style={{
                    ["--tone" as string]: "var(--accent)",
                    background: "var(--accent)",
                    boxShadow:
                      "0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent)",
                  }}
                />
              ) : (
                <span
                  className={cx(
                    "relative z-[1] mt-[7px] size-2.5 rounded-full",
                    st.state === "done"
                      ? "bg-label"
                      : "shadow-[inset_0_0_0_2px_var(--label-3)]",
                  )}
                />
              )}
              {next != null && (
                <span
                  className={cx(
                    "absolute -bottom-0.5 top-[22px] w-0.5 rounded-full",
                    doneLine ? "bg-label" : "bg-fill",
                  )}
                />
              )}
              {!times && next?.miles != null && (
                // No time column: the leg's miles sit on the line, halfway down.
                <span
                  className="num absolute left-1/2 z-[1] whitespace-nowrap rounded-pill bg-card px-1.5 text-caption font-semibold text-label-2"
                  style={{
                    top: "calc(50% + 11px)",
                    transform: "translate(-50%, -50%)",
                    fontSize: 11,
                    lineHeight: "16px",
                    boxShadow: "0 0 0 1px var(--sep)",
                  }}
                >
                  {formatMiles(next.miles)}
                </span>
              )}
            </div>
            <div
              className={cx(
                "flex min-w-0 items-start justify-between gap-3",
                next != null && "pb-5",
              )}
            >
              <div className="min-w-0">
                {st.href ? (
                  <Link
                    href={st.href}
                    transitionTypes={["nav-forward"]}
                    className="-m-1 block rounded-control p-1 hover:bg-fill-2"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
              {st.aside != null && <div className="shrink-0">{st.aside}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
