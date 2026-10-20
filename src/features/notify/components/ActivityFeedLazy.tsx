"use client";

import dynamic from "next/dynamic";

// ActivityFeed as its own chunk. slots.tsx also feeds NotificationBell (in the app
// header), so a direct import put the feed in every route that shows the bell.
export const ActivityFeed = dynamic(() =>
  import("./ActivityFeed").then((m) => m.ActivityFeed),
);
