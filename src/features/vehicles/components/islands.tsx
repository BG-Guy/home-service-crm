"use client";

import dynamic from "next/dynamic";

// Client islands of the vehicles server slots (next/dynamic, SSR on): the odometer
// button (and its slots.client module) loads only where the slot renders.
export const OdometerCaptureButton = dynamic(() =>
  import("../slots.client").then((m) => m.OdometerCaptureButton),
);
