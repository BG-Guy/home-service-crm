import type { BackTarget } from "@/ui/components/NavBar";
import { SkeletonPage } from "@/ui/components/Skeleton";

// Shared `loading.tsx` bodies. Without props the title (list) or the back target
// (detail) comes from the nav manifests for the current path; pass them when the
// screen isn't a nav entry or its title differs.

/** List screens: large title (+ optional search / segmented placeholders). */
export function ListLoading({
  title,
  search,
  segments,
  rows = 8,
}: {
  title?: string;
  search?: boolean;
  segments?: boolean;
  rows?: number;
} = {}) {
  return (
    <SkeletonPage
      rows={rows}
      title={title}
      search={search}
      segments={segments}
    />
  );
}

/** Detail (pushed) screens: inline bar with a working back button. */
export function DetailLoading({
  title,
  back,
  stats = 2,
  rows = 5,
}: {
  title?: string;
  back?: BackTarget;
  stats?: number;
  rows?: number;
} = {}) {
  return (
    <SkeletonPage bar stats={stats} rows={rows} title={title} back={back} />
  );
}
