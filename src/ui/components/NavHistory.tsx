"use client";

import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type Crumb,
  crumbsBefore,
  getServerTrail,
  getTrail,
  nameVisit,
  subscribeTrail,
  titleOf,
} from "@/client/nav-history";
import { NAV_BACK } from "../motion/PageTransition";
import { AnchoredPopover } from "./AnchoredPopover";
import { ContextMenu } from "./ContextMenu";
import { backForPath, type NavTitle, titleForPath } from "./nav-titles";
import { useNavTitles } from "./nav-titles-context";

/*
 * History breadcrumbs (QA: "show the pages I visited, not the app's folders").
 * - `HistoryTracker` (its own module, once in AppShell) records every page this tab visits.
 * - `CrumbTitle` (inside NavBar / LargeTitleHeader) names the page in the trail.
 * - `HistoryBack` is the nav bar's leading item: on phones the iOS back button,
 *   pointing at the page you actually came from (long-press for the whole trail);
 *   on desktop a back chevron plus the trail of earlier pages. Without a trail
 *   (a fresh tab, a shared link) it falls back to the page's static parent.
 */

export interface BackTarget {
  href: string;
  /** Previous screen's title (iOS shows it next to the chevron). Default "Back". */
  label?: string;
}

/**
 * iOS back button: chevron + previous title, `nav-back` pop transition.
 * Always render one on pushed screens — standalone iOS PWAs may lack swipe-back.
 */
export function BackButton({ href, label = "Back" }: BackTarget) {
  return (
    <Link
      href={href}
      transitionTypes={NAV_BACK}
      className="pressable -ml-2 flex min-h-11 max-w-[40vw] items-center gap-0.5 rounded-control pr-2 text-body text-accent-text outline-offset-0"
    >
      <ChevronLeft
        aria-hidden
        size={28}
        strokeWidth={2.4}
        className="-mr-0.5 shrink-0"
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Names the current page in the trail (rendered by the nav bars). */
export function CrumbTitle({ title }: { title: string }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) nameVisit(pathname, title);
  }, [pathname, title]);
  return null;
}

/** "Jobs" → "Job" for a detail page whose own title we don't know yet. */
function singular(label: string): string {
  if (/ies$/.test(label)) return label.replace(/ies$/, "y");
  if (/[^s]s$/.test(label)) return label.slice(0, -1);
  return label;
}

function labelFor(c: Crumb, titles: readonly NavTitle[]): string {
  if (c.title) return c.title;
  const known = titleOf(c.path) ?? titleForPath(titles, c.path);
  if (known) return known;
  const parent = backForPath(titles, c.path);
  if (parent) return singular(parent.label);
  const seg = c.path.split("/").filter(Boolean).pop() ?? "";
  return seg ? seg[0]?.toUpperCase() + seg.slice(1).replace(/-/g, " ") : "Home";
}

const MAX_SHOWN = 3;

/**
 * The nav bar's leading item. `fallback` = the page's static parent (pushed
 * screens); `root` = a top-level screen (no back button on phones).
 */
export function HistoryBack({
  fallback,
  root,
}: {
  fallback?: BackTarget;
  root?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const navTitles = useNavTitles();
  const trail = useSyncExternalStore(subscribeTrail, getTrail, getServerTrail);
  const crumbs = crumbsBefore(trail, pathname).map((c) => ({
    href: c.href,
    label: labelFor(c, navTitles),
  }));
  const prev =
    crumbs[crumbs.length - 1] ??
    (fallback
      ? { href: fallback.href, label: fallback.label ?? "Back" }
      : null);
  const older = crumbs.slice(0, -1).reverse();

  return (
    <>
      {/* Phones and tablets: the iOS back button; long-press lists the trail. */}
      {!root && prev && (
        <span className="flex min-w-0 lg:hidden">
          {older.length > 0 ? (
            <ContextMenu
              label="Go back to"
              actions={older.map((c) => ({
                label: c.label,
                onSelect: () =>
                  router.push(c.href, { transitionTypes: NAV_BACK }),
              }))}
            >
              <BackButton href={prev.href} label={prev.label} />
            </ContextMenu>
          ) : (
            <BackButton href={prev.href} label={prev.label} />
          )}
        </span>
      )}
      {/* Desktop: back chevron + the pages visited before this one. */}
      {crumbs.length > 0 ? (
        <Breadcrumbs crumbs={crumbs} />
      ) : !root && prev ? (
        <span className="hidden min-w-0 lg:flex">
          <BackButton href={prev.href} label={prev.label} />
        </span>
      ) : null}
    </>
  );
}

function Breadcrumbs({
  crumbs,
}: {
  crumbs: readonly { href: string; label: string }[];
}) {
  const prev = crumbs[crumbs.length - 1] as { href: string; label: string };
  const shown = crumbs.slice(-MAX_SHOWN);
  const hidden = crumbs.slice(0, -MAX_SHOWN).reverse();
  return (
    <nav
      aria-label="Breadcrumb"
      className="-ml-2 hidden min-w-0 items-center lg:flex"
    >
      <Link
        href={prev.href}
        transitionTypes={NAV_BACK}
        aria-label={`Back to ${prev.label}`}
        title={`Back to ${prev.label}`}
        className="pressable flex size-9 shrink-0 items-center justify-center rounded-full text-accent-text outline-offset-0 hover:bg-fill-2"
      >
        <ChevronLeft aria-hidden size={24} strokeWidth={2.4} />
      </Link>
      <ol className="flex min-w-0 items-center text-subhead">
        {hidden.length > 0 && (
          <li className="flex shrink-0 items-center">
            <OlderCrumbs crumbs={hidden} />
            <ChevronRight
              aria-hidden
              size={14}
              className="mx-0.5 shrink-0 text-label-3"
            />
          </li>
        )}
        {shown.map((c, i) => (
          <li key={c.href} className="flex min-w-0 items-center">
            {i > 0 && (
              <ChevronRight
                aria-hidden
                size={14}
                className="mx-0.5 shrink-0 text-label-3"
              />
            )}
            <Link
              href={c.href}
              transitionTypes={NAV_BACK}
              className="min-w-0 max-w-[11rem] truncate rounded-[6px] px-1.5 py-1 text-accent-text outline-offset-0 hover:bg-fill-2"
            >
              {c.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** "…" for the crumbs that don't fit: a menu of the earlier pages, newest first. */
function OlderCrumbs({
  crumbs,
}: {
  crumbs: readonly { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`${crumbs.length} earlier pages`}
        title="Earlier pages"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center rounded-[6px] px-1.5 text-label-2 outline-offset-0 hover:bg-fill-2"
      >
        <Ellipsis aria-hidden size={18} />
      </button>
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        label="Earlier pages"
        className="w-64 p-1.5"
      >
        <ul className="flex flex-col">
          {crumbs.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                transitionTypes={NAV_BACK}
                onClick={() => setOpen(false)}
                className="flex min-h-10 items-center truncate rounded-control px-3 text-body text-label outline-offset-[-2px] hover:bg-fill-2"
              >
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </>
  );
}
