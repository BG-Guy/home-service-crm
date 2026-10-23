import Link from "next/link";
import type { ReactNode } from "react";
import { Spinner } from "@/ui/components/Spinner";
import { cx } from "@/ui/cx";

/**
 * A round action with its label underneath (the 1-column lead box and the lead
 * card's action groups). `primary` is the accent fill (the next step), `on` the
 * ink fill of a step that's already taken (its button is now the way back, like
 * a selected chip), `danger` red ink on the neutral fill.
 */
export type RoundTone = "primary" | "secondary" | "tinted" | "on" | "danger";

const TONE: Record<RoundTone, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  tinted: "btn-tinted",
  on: "bg-label text-bg",
  danger: "btn-secondary btn-destructive",
};

export function RoundAction({
  icon,
  label,
  tone = "secondary",
  size = 48,
  onClick,
  onPointerEnter,
  href,
  external,
  newTab,
  disabled,
  busy,
  ariaLabel,
  className,
}: {
  icon: ReactNode;
  label: string;
  tone?: RoundTone;
  size?: 40 | 44 | 48 | 52;
  onClick?: () => void;
  onPointerEnter?: () => void;
  href?: string | null;
  /** tel:, sms:, mailto: and map links: a plain anchor. */
  external?: boolean;
  newTab?: boolean;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const cls = cx(
    "pressable group flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-control text-footnote font-medium text-label outline-offset-4",
    (disabled || busy) && "pointer-events-none",
    disabled && "opacity-40",
    className,
  );
  const body = (
    <>
      <span
        aria-hidden
        className={cx(
          "btn relative [&>svg]:size-[21px]",
          TONE[tone],
          size === 52 && "[&>svg]:size-[22px]",
        )}
        style={{ width: size, height: size }}
      >
        {busy ? <Spinner size={18} /> : icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  if (href && !disabled) {
    if (external)
      return (
        <a
          href={href}
          target={newTab ? "_blank" : undefined}
          rel={newTab ? "noopener noreferrer" : undefined}
          aria-label={ariaLabel}
          className={cls}
          onPointerEnter={onPointerEnter}
        >
          {body}
        </a>
      );
    return (
      <Link
        href={href}
        transitionTypes={["nav-forward"]}
        aria-label={ariaLabel}
        className={cls}
        onPointerEnter={onPointerEnter}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      className={cls}
    >
      {body}
    </button>
  );
}
