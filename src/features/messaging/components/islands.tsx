"use client";

import dynamic from "next/dynamic";

// Client islands the messaging server slots render, each behind next/dynamic (SSR on)
// so a page ships them only where the slot actually renders: Turbopack puts every
// client module reachable from a page in its entry, even inside tabs that are not shown.
export const MessageComposer = dynamic(() =>
  import("../slots.client").then((m) => m.MessageComposer),
);
export const ConsentActions = dynamic(() =>
  import("./ConsentActions").then((m) => m.ConsentActions),
);
export const LogReplyButton = dynamic(() =>
  import("./ThreadActions").then((m) => m.LogReplyButton),
);
export const CancelScheduledButton = dynamic(() =>
  import("./ThreadActions").then((m) => m.CancelScheduledButton),
);
