"use client";

import type { ReactNode } from "react";
import type { NavTitle } from "./nav-titles";
import { NavTitlesContext } from "./nav-titles-context";

// Its own module so the app shell (AppShell, every page) doesn't carry the nav bars:
// NavTitles' skeleton headers import NavBar, and with it the breadcrumb UI.

/** Mounted once by AppShell: the screen titles the skeletons and crumbs can show. */
export function NavTitlesProvider({
  titles,
  children,
}: {
  titles: readonly NavTitle[];
  children: ReactNode;
}) {
  return <NavTitlesContext value={titles}>{children}</NavTitlesContext>;
}
