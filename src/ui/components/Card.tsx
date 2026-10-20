import Link from "next/link";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { cx } from "../cx";

const PAD = {
  none: "",
  sm: "p-3",
  /** 16 on phones, 20 from 768 px (--card-pad). */
  md: "p-[var(--card-pad)]",
  lg: "p-5 md:p-6",
} as const;

export type CardPadding = keyof typeof PAD;

/**
 * Surface primitive (DESIGN.md §5): `--card`, radius 20, `--shadow-card` (a
 * hairline in dark mode). With `href` it is a push link; with `onClick` (client
 * parents) a button. Tappable cards get the M9 press and the M16 hover lift.
 * Server-renderable.
 *
 * ```tsx
 * <Card>…</Card>
 * <Card href={`/jobs/${id}`} padding="lg">…hero…</Card>
 * <Card as="section" aria-labelledby="money-h" nested>…</Card>
 * ```
 */
export function Card({
  as: Tag = "div",
  href,
  transition = "push",
  prefetch,
  onClick,
  padding = "md",
  pressable,
  nested,
  className,
  style,
  children,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  /** Element for a static card (default `div`). */
  as?: "div" | "section" | "article" | "aside" | "li";
  /** Makes the card a Next `<Link>`. */
  href?: string;
  /** View transition for `href`: `push` (default), `back`, or `none`. */
  transition?: "push" | "back" | "none";
  prefetch?: boolean;
  /** Makes the card a `<button>` (client components only). */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** `md` (default) 16 / 20 px, `sm` 12, `lg` 20 / 24, `none`. */
  padding?: CardPadding;
  /** Press feedback on a static card that has its own tap handling inside. */
  pressable?: boolean;
  /** A surface inside another card: `--card-2`, no shadow. */
  nested?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const tappable = href != null || onClick != null || pressable;
  const cls = cx(
    nested ? "rounded-card bg-card-2" : "card",
    PAD[padding],
    tappable && "pressable hover-lift",
    (href != null || onClick != null) &&
      "block w-full text-left outline-offset-2",
    className,
  );
  if (href != null) {
    return (
      <Link
        href={href}
        prefetch={prefetch}
        transitionTypes={
          transition === "none"
            ? undefined
            : transition === "back"
              ? ["nav-back"]
              : ["nav-forward"]
        }
        className={cls}
        style={style}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </Link>
    );
  }
  if (onClick != null) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cls}
        style={style}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </button>
    );
  }
  return (
    <Tag
      className={cls}
      style={style}
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </Tag>
  );
}
