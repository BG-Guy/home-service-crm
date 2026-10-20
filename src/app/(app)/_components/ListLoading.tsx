import { DetailLayout, Page } from "@/ui/components/AppShell";
import type { BackTarget } from "@/ui/components/NavBar";
import { SkeletonHeader } from "@/ui/components/NavTitles";
import { Skeleton } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

// Shared `loading.tsx` bodies in the v2 look (docs/DESIGN.md §6): the real header
// geometry, then shimmer blocks in the shape of the content (rich list rows, a
// hero card). Without props the title (list) or the back target (detail) comes
// from the nav manifests for the current path; pass them when the screen isn't a
// nav entry or its title differs. Wrapped in PageTransition, so a push slides the
// skeleton in and a tab switch cross-fades it.

/** A rich list row: leading avatar/tile, title + meta line, trailing pill. */
function RowBlock({ i }: { i: number }) {
  return (
    <div
      aria-hidden
      className="list-row flex min-h-[64px] items-center gap-3 px-4 py-3"
      data-icon=""
    >
      <Skeleton width={40} height={40} rounded={i % 3 ? "full" : "control"} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton height={14} width={`${62 - ((i * 13) % 24)}%`} />
        <Skeleton height={11} width={`${38 - ((i * 7) % 14)}%`} />
      </span>
      <Skeleton height={22} width={i % 2 ? 64 : 52} rounded="full" />
    </div>
  );
}

function Rows({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="list-card">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <RowBlock key={i} i={i} />
      ))}
    </div>
  );
}

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
    <PageTransition>
      <output className="sr-only">Loading</output>
      <SkeletonHeader title={title} search={search} segments={segments} />
      <Page className="pt-2">
        <Skeleton height={20} width={132} className="mb-3 ml-1" />
        <Rows rows={rows} />
      </Page>
    </PageTransition>
  );
}

/** The detail hero: status pill, title, two fact lines, the primary action. */
function HeroBlock() {
  return (
    <div aria-hidden className="rounded-card bg-card p-5 shadow-card">
      <Skeleton height={24} width={96} rounded="full" />
      <Skeleton height={26} width="72%" className="mt-4" />
      <Skeleton height={13} width="54%" className="mt-3" />
      <Skeleton height={13} width="40%" className="mt-2" />
      <Skeleton height={52} width="100%" rounded="full" className="mt-5" />
    </div>
  );
}

function StatBlock() {
  return (
    <div aria-hidden className="rounded-card bg-card p-4 shadow-card">
      <Skeleton height={12} width="55%" />
      <Skeleton height={24} width="70%" className="mt-3" />
    </div>
  );
}

/**
 * Detail (pushed) screens: inline bar with a working back button, a hero card,
 * stat tiles, the in-page tab row and a list. `rail` adds the desktop right-rail
 * placeholders for pages laid out with `DetailLayout`.
 */
export function DetailLoading({
  title,
  back,
  stats = 2,
  rows = 5,
  rail,
}: {
  title?: string;
  back?: BackTarget;
  stats?: number;
  rows?: number;
  /** The page uses `DetailLayout` (sticky right rail at ≥ 1200 px). */
  rail?: boolean;
} = {}) {
  const main = (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <HeroBlock />
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            <StatBlock key={i} />
          ))}
        </div>
      )}
      <div>
        <Skeleton height={36} width="100%" rounded="full" className="mb-4" />
        <Rows rows={rows} />
      </div>
    </div>
  );
  return (
    <PageTransition>
      <output className="sr-only">Loading</output>
      <SkeletonHeader bar title={title} back={back} />
      <Page className="pt-4">
        {rail ? (
          <DetailLayout
            railOnPhone="hide"
            rail={
              <>
                <div
                  aria-hidden
                  className="rounded-card bg-card p-5 shadow-card"
                >
                  <Skeleton height={14} width="45%" />
                  <Skeleton height={28} width="60%" className="mt-3" />
                  <Skeleton
                    height={44}
                    width="100%"
                    rounded="full"
                    className="mt-4"
                  />
                </div>
                <StatBlock />
              </>
            }
          >
            {main}
          </DetailLayout>
        ) : (
          main
        )}
      </Page>
    </PageTransition>
  );
}
