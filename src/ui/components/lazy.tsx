"use client";

// Lazy wrappers for heavy or rarely-needed client components (SPEC §14 rule 2).
// Each loads its own chunk on first render; nothing here is in the shell bundle.
// The placeholders are plain `.skeleton` blocks: importing Skeleton.tsx here would
// pull the page-skeleton code (and AppShell's module) into every importer.
import dynamic from "next/dynamic";

function Placeholder({
  height,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`skeleton block rounded-card ${className ?? ""}`}
      style={height ? { height } : undefined}
    />
  );
}

/** `<SignaturePad>` loaded on demand (~3 KB). Forwards `ref`. */
export const LazySignaturePad = dynamic(() => import("./SignaturePad"), {
  ssr: false,
  loading: () => <Placeholder height={180} />,
});

/** `<PhotoCompare>` loaded on demand. */
export const LazyPhotoCompare = dynamic(() => import("./PhotoCompare"), {
  ssr: false,
  loading: () => <Placeholder className="aspect-[4/3] w-full" />,
});

/** `<MapView>` + Leaflet CSS loaded on demand (Leaflet JS loads inside on mount). */
export const LazyMapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <Placeholder height={360} />,
});

/** `<PullToRefresh>` loaded after hydration (renders only its spinner; moves `#main`). */
export const LazyPullToRefresh = dynamic(() => import("./PullToRefresh"), {
  ssr: false,
});

/** `<InstallPrompt>` loaded on demand. */
export const LazyInstallPrompt = dynamic(() => import("./InstallPrompt"), {
  ssr: false,
});
