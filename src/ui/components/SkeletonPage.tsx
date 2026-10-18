import { PageTransition } from "../motion/PageTransition";
import { Page } from "./AppShell";
import type { BackTarget } from "./NavBar";
import { SkeletonHeader } from "./NavTitles";
import { SkeletonList, SkeletonStat } from "./Skeleton";

/**
 * A full-page placeholder for `loading.tsx`: the real header (large title, or an
 * inline bar with a working back button when `bar`), a stat row and a list.
 * The title and back target default to the nav manifests' label for the path.
 * Wrapped in `PageTransition`, so a push slides the skeleton in (QA T4-03).
 * Announces "Loading" once for screen readers.
 */
export function SkeletonPage({
  stats = 0,
  rows = 6,
  bar,
  title,
  back,
  search,
  segments,
}: {
  stats?: number;
  rows?: number;
  /** Pushed/detail screen: inline NavBar + back instead of a large title. */
  bar?: boolean;
  title?: string;
  back?: BackTarget;
  /** Show a search-field placeholder under the large title. */
  search?: boolean;
  /** Show a segmented-control placeholder under the large title. */
  segments?: boolean;
}) {
  return (
    <PageTransition>
      <output className="sr-only">Loading</output>
      <SkeletonHeader
        bar={bar}
        title={title}
        back={back}
        search={search}
        segments={segments}
      />
      <Page className={bar ? "pt-4" : "pt-2"}>
        {stats > 0 && (
          <div className="mb-[var(--section-gap)] grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: stats }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              <SkeletonStat key={i} />
            ))}
          </div>
        )}
        <SkeletonList rows={rows} />
      </Page>
    </PageTransition>
  );
}
