"use client";

import dynamic from "next/dynamic";

// The map view in its own chunk (server-rendered, hydrated when the chunk is in):
// the calendar views of /schedule never download it. Leaflet is a second lazy
// chunk inside it (MapCanvas, client only).
export const LazyScheduleMap = dynamic(() =>
  import("./ScheduleMapView").then((m) => m.ScheduleMapView),
);
