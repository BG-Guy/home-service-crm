"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { recordVisit, scopeTrailTo } from "@/client/nav-history";

// Its own module so the app shell (AppShell, every page) carries only the recorder:
// the breadcrumb UI (NavHistory) loads with the pages' nav bars.

/** Records each page (and its query) this tab visits; scoped to the user. */
export function HistoryTracker({ userId }: { userId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params?.toString() ?? "";
  useEffect(() => {
    scopeTrailTo(userId);
  }, [userId]);
  useEffect(() => {
    if (pathname) recordVisit(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, qs]);
  return null;
}
