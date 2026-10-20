import Link from "next/link";
import { type ComponentProps, type ReactNode, ViewTransition } from "react";

/**
 * Page transitions (docs/DESIGN.md §4 M1, M2; amendment 4).
 *
 * React 19.3 exports `<ViewTransition>` as stable, and Next's router runs every
 * navigation inside a Transition, so:
 * - Wrap each page's content in `<PageTransition>`.
 * - Use `<PushLink>` (or `transitionTypes={['nav-forward']}`) for drill-down links,
 *   `<BackLink>` (`['nav-back']`) for back buttons: M1 push / pop, 400 ms.
 * - The tab bar and sidebar pass `['nav-tab']` (`<TabLink>`): M2, a 160 ms
 *   cross-fade with the new page rising 6 px, no slide.
 * - Browser back / swipe-back pass no type, so they play no animation (`default: 'none'`).
 * - Browsers without View Transitions simply navigate (no animation, nothing breaks).
 * - `loading.tsx` skeletons are wrapped too, so the push slides the skeleton in; the
 *   later reveal of the real page swaps in place (no type → none).
 *
 * The entering and the leaving page get different classes (`push-in` / `push-out`,
 * `pop-in` / `pop-out`, `tab-in` / `tab-out`) so CSS can stack them: on a pop the
 * leaving page slides out above the one underneath. The keyframes, the
 * shared-element (`.morph`) rules and the reduced-motion fades are in the
 * view-transition block of globals.css.
 */
const ENTER = {
  "nav-forward": "push-in",
  "nav-back": "pop-in",
  "nav-tab": "tab-in",
  default: "none",
} as const;
const EXIT = {
  "nav-forward": "push-out",
  "nav-back": "pop-out",
  "nav-tab": "tab-out",
  default: "none",
} as const;

export function PageTransition({ children }: { children: ReactNode }) {
  // One opaque, screen-tall box per page (`.vt-page`): the push/pop snapshot is a
  // whole screen, not a transparent stack that lets the other page show through.
  return (
    <ViewTransition enter={ENTER} exit={EXIT} default="none">
      <div className="vt-page">{children}</div>
    </ViewTransition>
  );
}

type LinkProps = ComponentProps<typeof Link>;

/** `<Link>` that plays the push (drill-down) transition. */
export function PushLink(props: LinkProps) {
  return <Link transitionTypes={NAV_FORWARD} {...props} />;
}

/** `<Link>` that plays the pop (back) transition. */
export function BackLink(props: LinkProps) {
  return <Link transitionTypes={NAV_BACK} {...props} />;
}

/** `<Link>` between root sections (tab bar, sidebar): the M2 cross-fade. */
export function TabLink(props: LinkProps) {
  return <Link transitionTypes={NAV_TAB} {...props} />;
}

/** Transition types for `router.push(href, { transitionTypes })`. */
export const NAV_FORWARD = ["nav-forward"];
export const NAV_BACK = ["nav-back"];
export const NAV_TAB = ["nav-tab"];
