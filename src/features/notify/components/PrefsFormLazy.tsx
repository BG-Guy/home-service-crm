"use client";

import dynamic from "next/dynamic";

// The preferences form (and the notification catalog it lists) as its own chunk.
// slots.tsx also feeds ActivityTimeline, which renders on many detail pages; importing
// PrefsForm there directly put the catalog in every one of those routes.
export const PrefsForm = dynamic(() =>
  import("./PrefsForm").then((m) => m.PrefsForm),
);
