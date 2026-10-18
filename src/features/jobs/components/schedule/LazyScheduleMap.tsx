"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/ui/components/Skeleton";
import type { ScheduleMapProps } from "./ScheduleMap";

// /schedule?layout=map loads the map layout as its own chunk (Leaflet loads inside
// it), so the calendar layout never downloads it. Client-only like the desktop
// board: the map can't render on the server, and time ranges format differently in
// Node and browsers (Intl range separators), which would break hydration.

const ScheduleMap = dynamic(() => import("./ScheduleMap"), {
  ssr: false,
  loading: () => (
    <Skeleton className="h-[55dvh] lg:h-[calc(100dvh-224px)]" rounded="card" />
  ),
});

export function LazyScheduleMap(props: ScheduleMapProps) {
  return <ScheduleMap {...props} />;
}
