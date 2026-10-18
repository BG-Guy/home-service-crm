import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";

/**
 * Inline link in accent text for a name, number or address inside a row, a
 * header or a sentence. Pass the permission-checked href (`personHref()`,
 * `mapsHref()`…): without one the children render as plain text, so the viewer
 * never gets a link they can't open. `className` applies either way (e.g.
 * `truncate` in a flex row). App routes play the push transition; `external`
 * opens a new tab (maps). Server-renderable; never put it inside another link.
 */
export function TextLink({
  href,
  external,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  href?: string | null;
  external?: boolean;
  className?: string;
  children: ReactNode;
  /** Must contain the visible text (WCAG 2.5.3). */
  "aria-label"?: string;
}) {
  if (!href)
    return className ? <span className={className}>{children}</span> : children;
  const cls = cx(
    "text-accent-text underline-offset-2 hover:underline",
    className,
  );
  if (external)
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className={cls}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
