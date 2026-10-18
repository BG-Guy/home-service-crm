import { Circle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
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
 * Activity feed grouped by day ("Today", "Yesterday", "Mon, Oct 12") in the
 * company time zone (SPEC §12.6). Presentational: the caller maps activity rows
 * to items (icon/tone per kind) and handles pagination.
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
          <h3 className="mb-2 px-1 text-footnote font-semibold uppercase text-label-2">
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
                      className="absolute bottom-0 left-[13.5px] top-8 w-px bg-sep"
                    />
                  )}
                  <span
                    aria-hidden
                    className="tint-bg tint-fg relative flex size-7 shrink-0 items-center justify-center rounded-full"
                    style={toneStyle(it.tone ?? "gray")}
                  >
                    {it.icon ?? <Circle size={8} fill="currentColor" />}
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
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
