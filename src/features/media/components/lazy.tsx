"use client";

// Split chunks for the media islands (server-rendered, loaded only where they
// render): the job page's Photos tab gallery and its edit / compare sheets.
import dynamic from "next/dynamic";

export const LazyJobPhotosGallery = dynamic(() =>
  import("./JobPhotosGallery").then((m) => m.JobPhotosGallery),
);
