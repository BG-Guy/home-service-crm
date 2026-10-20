"use client";

// Client UI slots produced by B4 (BUILD_PLAN §5.1 S24, S25). The code lives in
// `components/capture.tsx`; these wrappers keep it (the capture sheet, the
// camera, the upload pipeline) out of every importing page's entry chunk. They
// server-render as before and load where they render.
import dynamic from "next/dynamic";

export const CameraCaptureButton = dynamic(() =>
  import("./components/capture").then((m) => m.CameraCaptureButton),
);

export const PhotoPicker = dynamic(() =>
  import("./components/capture").then((m) => m.PhotoPicker),
);
