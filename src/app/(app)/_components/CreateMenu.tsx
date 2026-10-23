"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type MouseEvent, type ReactNode } from "react";
import { buttonClass } from "@/ui/components/Button";
import { cx } from "@/ui/cx";
import {
  type CreateItem,
  contextualize,
  isPrimaryCreate,
} from "./create-items";

/** A create item with its icons already rendered on the server (HeaderActions). */
export type CreateButtonItem = CreateItem & {
  /** 20 px, over the label on phones. */
  iconNode: ReactNode;
  /** 18 px, inside the pill on tablet and desktop. */
  pillIcon: ReactNode;
};

/**
 * A `?new=` link to the page you're on (Upload receipt, New tool) only adds the
 * param: the page's sheet opens on it (useSearchParams) without a server round
 * trip, and the other params stay. Anything else navigates as a normal link.
 */
function sameRouteParam(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
    return;
  const url = new URL(href, location.href);
  if (url.pathname !== location.pathname || !url.search) return;
  e.preventDefault();
  const next = new URLSearchParams(location.search);
  for (const [k, v] of url.searchParams) next.set(k, v);
  history.replaceState(null, "", `${location.pathname}?${next}`);
}

/**
 * Named create buttons in the header (leads flow item 5), ordered for the page:
 * its own action first (New lead on /leads, New customer on customer pages).
 * Phones: small labeled icons (icon over a tiny label, 44 px targets; tighter
 * under 380 px so a page's own fourth button still fits). Tablet and
 * desktop (≥ 768 px): named pills, the page's main one in the accent; back to
 * labeled icons in a narrow list pane on desktop (`[data-pane]`, SplitView's
 * 360 px column), where three pills don't fit. Icons arrive pre-rendered so the
 * `@/ui/icons` map stays out of the client bundle.
 */
export function CreateButtons({
  items,
}: {
  items: readonly CreateButtonItem[];
}) {
  const pathname = usePathname() ?? "/";
  return (
    <div
      className={cx(
        "flex items-center gap-1 md:mr-1 md:gap-2 lg:in-data-[pane]:gap-1",
        // A page's own fourth button: no gaps on a narrow phone, so all fit.
        items.length > 3 && "max-[399px]:gap-0",
      )}
    >
      {contextualize(items, pathname).map((i) => {
        const primary = isPrimaryCreate(i, pathname);
        const onClick = (e: MouseEvent<HTMLAnchorElement>) =>
          sameRouteParam(e, i.href);
        return (
          <Fragment key={i.key}>
            <Link
              href={i.href}
              onClick={onClick}
              className="pressable flex h-11 min-w-11 flex-col items-center justify-center gap-[3px] rounded-control px-0.5 text-accent-text max-[379px]:px-0 md:hidden lg:in-data-[pane]:flex"
            >
              {i.iconNode}
              <span className="whitespace-nowrap text-[10px] font-medium leading-3 tracking-[-0.01em] max-[379px]:text-[9px]">
                {i.label}
              </span>
            </Link>
            <Link
              href={i.href}
              onClick={onClick}
              className={buttonClass({
                variant: primary ? "primary" : "secondary",
                size: "sm",
                className: cx(
                  "hidden md:inline-flex lg:in-data-[pane]:hidden",
                  !primary && "bg-card shadow-card",
                ),
              })}
            >
              <span className="-ml-0.5 flex shrink-0">{i.pillIcon}</span>
              {i.label}
            </Link>
          </Fragment>
        );
      })}
    </div>
  );
}
