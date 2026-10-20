import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";

/**
 * Count or dot badge (DESIGN.md §5): a 12/700 pill. Use `tone="red"` only for
 * critical counts (overdue SLA, open disputes), `accent` for new items;
 * everything else stays neutral `gray` (default).
 *
 * @param count number to show (hidden when 0 unless `showZero`); > `max` shows "99+".
 * @param dot render an 8 px dot instead of a count.
 * @param label accessible text, e.g. "3 new leads" (defaults to the number).
 * @param pop M11: pop (1 → 1.25 → 1) whenever the value changes. Use it on counts
 *   that persist across navigations (tab bar, sidebar, bell); in lists every
 *   mount would pop.
 */
export function Badge({
  count,
  dot,
  tone = "gray",
  max = 99,
  showZero,
  label,
  pop,
  className,
}: {
  count?: number;
  dot?: boolean;
  tone?: Tone;
  max?: number;
  showZero?: boolean;
  label?: string;
  pop?: boolean;
  className?: string;
}) {
  if (dot) {
    return (
      <span
        aria-hidden={label ? undefined : true}
        className={cx(
          "tone-bg inline-block size-2 shrink-0 rounded-full",
          pop && "badge-pop",
          className,
        )}
        style={toneStyle(tone)}
      >
        {label && <span className="sr-only">{label}</span>}
      </span>
    );
  }
  if (count == null || (count <= 0 && !showZero)) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      // A new key remounts the badge, which replays the pop.
      key={pop ? text : undefined}
      className={cx(
        "num tone-bg inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-pill px-[5px] text-caption font-bold leading-none tracking-normal",
        pop && "badge-pop",
        className,
      )}
      style={toneStyle(tone)}
    >
      <span aria-hidden={label ? true : undefined}>{text}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
