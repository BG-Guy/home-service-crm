import { X } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { cx } from "../cx";
import { TONE_VAR, type Tone, toneInk } from "../tone";

const chipBase =
  "pressable relative inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-pill px-4 text-subhead font-medium outline-offset-2 before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']";

/**
 * Filter chip (DESIGN.md §5): a 34 px pill. Unselected = `--card` with a
 * hairline; selected = ink fill (`--label`) with `--bg` text, like Uber/Airbnb.
 * Toggle with `onClick` (renders `aria-pressed`) or navigate with `href`
 * (renders `aria-current` when `selected`).
 *
 * ```tsx
 * <Chip href="?status=open" selected={status === "open"} count={12}>Open</Chip>
 * ```
 */
export function Chip({
  selected,
  href,
  onClick,
  icon,
  count,
  children,
  className,
  replace,
}: {
  selected?: boolean;
  href?: string;
  /** Use `router.replace` semantics for filter links (no history entry). */
  replace?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  icon?: ReactNode;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  const cls = cx(
    chipBase,
    selected
      ? "bg-label font-semibold text-bg"
      : "bg-card text-label shadow-[inset_0_0_0_1px_var(--sep)] hover:bg-fill-2",
    className,
  );
  const inner = (
    <>
      {icon}
      <span>{children}</span>
      {count != null && (
        <span
          className={cx(
            "num text-footnote",
            selected ? "opacity-75" : "text-label-2",
          )}
        >
          {count}
        </span>
      )}
    </>
  );
  if (href != null) {
    return (
      <Link
        href={href}
        replace={replace}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className={cls}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={!!selected}
      onClick={onClick}
      className={cls}
    >
      {inner}
    </button>
  );
}

/**
 * Horizontally scrolling chip row, full-bleed to the page gutters: scroll-snap,
 * edge-fade masks over the gutters, no visible scrollbar. `sticky` pins it under
 * the nav bar (`--sticky-top`, default safe area + 44 px) on the canvas color.
 */
export function ChipRow({
  children,
  label,
  sticky,
  className,
}: {
  children: ReactNode;
  /** Accessible group label, e.g. "Filter jobs". */
  label?: string;
  /** Stick under the nav bar while the list scrolls. */
  sticky?: boolean;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add unwanted chrome
    <div
      role="group"
      aria-label={label}
      data-sticky={sticky ? "" : undefined}
      className={cx(
        "chip-row -mx-[var(--gutter)] px-[var(--gutter)] py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Tag chip (`tags.color`): tinted capsule with the tag color. Pass a hex/rgb
 * `color` from the DB or a `tone`. `onRemove` adds a remove button.
 */
export function TagChip({
  name,
  color,
  tone = "gray",
  onRemove,
  size = "md",
  className,
}: {
  name: string;
  color?: string | null;
  tone?: Tone;
  onRemove?: () => void;
  size?: "sm" | "md";
  className?: string;
}) {
  // A DB color has no ink token: `initial` makes .tint-fg mix it toward --label.
  const style = {
    "--tone": color || TONE_VAR[tone],
    "--tone-ink": color ? "initial" : toneInk(tone),
  } as CSSProperties;
  return (
    <span
      className={cx(
        "tint-bg tint-fg inline-flex shrink-0 items-center gap-1 rounded-pill font-semibold",
        size === "sm" ? "h-5 px-2 text-caption" : "h-6 px-2.5 text-footnote",
        onRemove && "pr-1",
        className,
      )}
      style={style}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="hit-44 ml-0.5 flex size-4 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--tone)_25%,transparent)]"
        >
          <X aria-hidden size={12} strokeWidth={3} />
        </button>
      )}
    </span>
  );
}
