"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, use } from "react";
import {
  BACK_LINK,
  BAR_LEADING,
  BAR_ROW,
  BAR_TITLE,
  BAR_TRAILING,
  BackChevron,
  LARGE_HEADER,
  LARGE_TITLE,
} from "./bar-parts";
import type { BackTarget } from "./NavBar";
import { backForPath, type NavTitle, titleForPath } from "./nav-titles";

// The screen titles the `loading.tsx` skeletons show (QA T4-25), and the skeleton
// header itself. Both ship in the app shell on purpose: every app route has a
// loading state, so its header must render on navigation without fetching a
// chunk, and one shell copy beats a copy in every route's chunks.

export const NavTitlesContext = createContext<readonly NavTitle[]>([]);

/** Mounted once by AppShell: the screen titles the skeletons can show. */
export function NavTitlesProvider({
  titles,
  children,
}: {
  titles: readonly NavTitle[];
  children: ReactNode;
}) {
  return <NavTitlesContext value={titles}>{children}</NavTitlesContext>;
}

const NAV_BACK = ["nav-back"];

// The `.skeleton` block (Skeleton.tsx imports this file, so no import back).
function Block({
  className,
  h,
  w,
}: {
  className?: string;
  h: number;
  w: number | string;
}) {
  return (
    <span
      aria-hidden
      className={`skeleton block ${className ?? ""}`}
      style={{ height: h, width: w }}
    />
  );
}

function Back({ href, label = "Back" }: BackTarget) {
  return (
    <Link href={href} transitionTypes={NAV_BACK} className={BACK_LINK}>
      <BackChevron />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * The header of a `loading.tsx` skeleton, with the real geometry: a large title
 * (list screens) or an inline bar with a working back button (pushed screens).
 * Without an explicit `title`, the title (or the back target) comes from the
 * nav manifests for the current path. It mirrors NavBar / LargeTitleHeader
 * through the shared `bar-parts` classes instead of rendering them, so loading
 * chunks don't carry the NavBar module.
 */
export function SkeletonHeader({
  bar,
  title,
  back,
  search,
  segments,
}: {
  bar?: boolean;
  title?: string;
  back?: BackTarget;
  search?: boolean;
  segments?: boolean;
}) {
  const titles = use(NavTitlesContext);
  const pathname = usePathname() ?? "/";
  if (bar) {
    const parent = back ?? backForPath(titles, pathname);
    return (
      <header data-chrome className="nav-bar pt-[env(safe-area-inset-top)]">
        <div className={BAR_ROW}>
          <div className={BAR_LEADING}>{parent && <Back {...parent} />}</div>
          <div className={BAR_TITLE}>
            {title ? (
              <h1 className="truncate text-headline">{title}</h1>
            ) : (
              <Block h={17} w={120} className="mx-auto" />
            )}
          </div>
          <div className={BAR_TRAILING} />
        </div>
      </header>
    );
  }
  const resolved = title ?? titleForPath(titles, pathname);
  return (
    <div data-lt>
      <div data-chrome className="lt-bar pt-[env(safe-area-inset-top)]">
        <div className={BAR_ROW}>
          <div className={BAR_LEADING}>{back && <Back {...back} />}</div>
          <div aria-hidden className={`${BAR_TITLE} lt-inline`}>
            {resolved}
          </div>
          <div className={BAR_TRAILING} />
        </div>
      </div>
      <header className={LARGE_HEADER}>
        <h1 className={LARGE_TITLE}>
          {resolved ?? <Block h={34} w="45%" className="my-[3px]" />}
        </h1>
        {search && (
          <div className="mt-2">
            <Block h={44} w="100%" className="rounded-full" />
          </div>
        )}
        {segments && (
          <div className="mt-3">
            <Block h={34} w="100%" className="rounded-full" />
          </div>
        )}
      </header>
    </div>
  );
}
