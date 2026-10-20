"use client";

import dynamic from "next/dynamic";

// Client islands of the parts server slots (next/dynamic, SSR on): they load only on
// pages where the slot renders, not on every route that imports parts/slots.tsx.
export const AddReceiptButton = dynamic(() =>
  import("./LineActions").then((m) => m.AddReceiptButton),
);
export const RemovePartButton = dynamic(() =>
  import("./LineActions").then((m) => m.RemovePartButton),
);
export const AddPartButton = dynamic(() =>
  import("../slots.client").then((m) => m.AddPartButton),
);
