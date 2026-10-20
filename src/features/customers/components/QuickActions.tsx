import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/ui/cx";

// Round quick actions with a label under the circle (DESIGN.md §7 brief 6): the
// Uber/Airbnb profile row of Call, Text, Email, New job. Server-safe (no hooks),
// so client islands (CallButton, EmailLink) and server pages share one look.

/** The column: 52 px tinted circle + 13 px label; a 64 px wide tap column. */
export const quickActionCls =
  "pressable group flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-control text-footnote font-medium text-label outline-offset-4 disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

/** The circle inside a quick action (`btn` gives the hover wash). */
export function QuickActionIcon({
  children,
  primary,
}: {
  children: ReactNode;
  /** The one filled accent circle of the row (the next step). */
  primary?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "btn size-[52px] [&>svg]:size-[22px]",
        primary ? "btn-primary" : "btn-tinted",
      )}
    >
      {children}
    </span>
  );
}

/** A quick action that navigates. */
export function QuickActionLink({
  href,
  icon,
  label,
  primary,
  external,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  primary?: boolean;
  /** `tel:` / `sms:` / `mailto:` links: a plain anchor. */
  external?: boolean;
}) {
  const body = (
    <>
      <QuickActionIcon primary={primary}>{icon}</QuickActionIcon>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  if (external)
    return (
      <a href={href} className={quickActionCls}>
        {body}
      </a>
    );
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className={quickActionCls}
    >
      {body}
    </Link>
  );
}

/** The row: centered, wraps to two lines only on very narrow screens. */
export function QuickActionRow({
  children,
  label = "Quick actions",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar-like group, not a form fieldset
    <div
      role="group"
      aria-label={label}
      className={cx(
        "flex flex-wrap items-start justify-center gap-x-3 gap-y-3 empty:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
