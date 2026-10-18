"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, use } from "react";
import { type BackTarget, LargeTitleHeader, NavBar } from "./NavBar";
import { backForPath, type NavTitle, titleForPath } from "./nav-titles";

const NavTitlesContext = createContext<readonly NavTitle[]>([]);

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

/**
 * The header of a `loading.tsx` skeleton, with the real geometry: a large title
 * (list screens) or an inline bar with a working back button (pushed screens).
 * Without an explicit `title`, the title (or the back target) comes from the
 * nav manifests for the current path.
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
      <NavBar
        back={parent}
        title={title ?? <Block h={17} w={120} className="mx-auto" />}
      />
    );
  }
  const resolved = title ?? titleForPath(titles, pathname);
  return (
    <LargeTitleHeader
      back={back}
      title={resolved ?? <Block h={34} w="45%" className="my-[3px]" />}
      search={
        search ? (
          <Block h={36} w="100%" className="rounded-control" />
        ) : undefined
      }
    >
      {segments ? (
        <Block h={32} w="100%" className="rounded-control" />
      ) : undefined}
    </LargeTitleHeader>
  );
}
