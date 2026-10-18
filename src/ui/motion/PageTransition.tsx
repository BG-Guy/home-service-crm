import Link from "next/link";
import { type ComponentProps, type ReactNode, ViewTransition } from "react";

/**
 * iOS push/pop page transitions (SPEC §12.2, amendment 4).
 *
 * React 19.3 exports `<ViewTransition>` as stable, and Next's router runs every
 * navigation inside a Transition, so:
 * - Wrap each page's content in `<PageTransition>`.
 * - Use `<PushLink>` (or `transitionTypes={['nav-forward']}`) for drill-down links,
 *   `<BackLink>` (`['nav-back']`) for back buttons.
 * - Browser back / swipe-back pass no type, so they play no animation (`default: 'none'`).
 * - Browsers without View Transitions simply navigate (no animation, nothing breaks).
 * - `loading.tsx` skeletons are wrapped too (`SkeletonPage`), so the push slides the
 *   skeleton in; the later reveal of the real page swaps in place (no type → none).
 * The `.push` / `.pop` animations and the reduced-motion crossfade live in globals.css.
 */
const ENTER_EXIT = {
  "nav-forward": "push",
  "nav-back": "pop",
  default: "none",
} as const;

export function PageTransition({ children }: { children: ReactNode }) {
  // One opaque, screen-tall box per page (`.vt-page`): the push/pop snapshot is a
  // whole screen, not a transparent stack that lets the other page show through.
  return (
    <ViewTransition enter={ENTER_EXIT} exit={ENTER_EXIT} default="none">
      <div className="vt-page">{children}</div>
    </ViewTransition>
  );
}

type LinkProps = ComponentProps<typeof Link>;

/** `<Link>` that plays the push (drill-down) transition. */
export function PushLink(props: LinkProps) {
  return <Link transitionTypes={["nav-forward"]} {...props} />;
}

/** `<Link>` that plays the pop (back) transition. */
export function BackLink(props: LinkProps) {
  return <Link transitionTypes={["nav-back"]} {...props} />;
}

/** Transition types for `router.push(href, { transitionTypes })`. */
export const NAV_FORWARD = ["nav-forward"];
export const NAV_BACK = ["nav-back"];
