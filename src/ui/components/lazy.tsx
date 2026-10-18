"use client";

// Lazy wrappers for heavy or rarely-needed client components (SPEC §14 rule 2).
// Each loads its own chunk on first render; nothing here is in the shell bundle.
import dynamic from "next/dynamic";
import { Skeleton } from "./Skeleton";

/** `<SignaturePad>` loaded on demand (~3 KB). Forwards `ref`. */
export const LazySignaturePad = dynamic(() => import("./SignaturePad"), {
  ssr: false,
  loading: () => <Skeleton height={180} rounded="card" />,
});

/** `<PhotoCompare>` loaded on demand. */
export const LazyPhotoCompare = dynamic(() => import("./PhotoCompare"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[4/3] w-full" rounded="card" />,
});

/** `<MapView>` + Leaflet CSS loaded on demand (Leaflet JS loads inside on mount). */
export const LazyMapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <Skeleton height={360} rounded="card" />,
});

/** `<PullToRefresh>` loaded after hydration (renders only its spinner; moves `#main`). */
export const LazyPullToRefresh = dynamic(() => import("./PullToRefresh"), {
  ssr: false,
});

/** `<InstallPrompt>` loaded on demand. */
export const LazyInstallPrompt = dynamic(() => import("./InstallPrompt"), {
  ssr: false,
});
