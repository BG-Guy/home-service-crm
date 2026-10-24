"use client";

// The estimate pages' own client islands as split chunks (DESIGN.md §2), apart
// from islands.tsx (which the job page loads through the S10 slot), so the job
// page doesn't carry these wrappers. Each loads only when its page renders it.
import dynamic from "next/dynamic";

/** After signing (E5): only approved estimates load it. */
export const LazyAfterSigning = dynamic(() =>
  import("./AfterSigning").then((m) => m.AfterSigning),
);

/** Estimate photos (E6): the camera button and the job-photo chooser. */
export const LazyEstimatePhotoButton = dynamic(() =>
  import("./EstimatePhotoControls").then((m) => m.EstimatePhotoButton),
);
export const LazyChooseEstimatePhotos = dynamic(() =>
  import("./EstimatePhotoControls").then((m) => m.ChooseEstimatePhotos),
);

/** /estimates/new: from a job the draft starts at once, else the form (E2). */
export const LazyStartEstimate = dynamic(() =>
  import("./StartEstimate").then((m) => m.StartEstimateFromJob),
);
export const LazyNewEstimateForm = dynamic(() =>
  import("./NewEstimateForm").then((m) => m.NewEstimateForm),
);
