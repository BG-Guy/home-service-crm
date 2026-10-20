import type { CSSProperties } from "react";
import { cx } from "../cx";
import { PageTransition } from "../motion/PageTransition";
import { Page } from "./AppShell";
import type { BackTarget } from "./NavBar";
import { SkeletonHeader } from "./NavTitles";

/*
 * Loading placeholders for `loading.tsx` files (DESIGN.md §4 M13): a shimmer
 * sweep (transform only) that stops under reduced motion. Each variant matches
 * the geometry of the real component so content doesn't jump when it arrives.
 */

/** A single block. Give it a size with className or width/height. */
export function Skeleton({
  className,
  width,
  height,
  rounded,
  style,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
  /** `full` for circles/pills. */
  rounded?: "full" | "card" | "control";
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "skeleton block",
        rounded === "full" && "rounded-full",
        rounded === "card" && "rounded-card",
        rounded === "control" && "rounded-control",
        className,
      )}
      style={{ width, height, ...style }}
    />
  );
}

/** Lines of text. The last line is shorter. */
export function SkeletonText({
  lines = 2,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span aria-hidden className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={i}
          height={12}
          width={i === lines - 1 && lines > 1 ? "60%" : "100%"}
        />
      ))}
    </span>
  );
}

/** A list row placeholder (52 px like ListRow, optional leading tile/avatar). */
export function SkeletonRow({
  leading = "icon",
  subtitle = true,
  detail = true,
}: {
  leading?: "icon" | "avatar" | "none";
  subtitle?: boolean;
  detail?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="list-row flex min-h-[var(--row-min)] items-center gap-3 px-4 py-2.5"
      data-icon={leading === "icon" ? "" : undefined}
    >
      {leading === "icon" && (
        <Skeleton width={32} height={32} className="rounded-[10px]" />
      )}
      {leading === "avatar" && (
        <Skeleton width={40} height={40} rounded="full" />
      )}
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton height={14} width="55%" />
        {subtitle && <Skeleton height={11} width="35%" />}
      </span>
      {detail && <Skeleton height={14} width={48} />}
    </div>
  );
}

/** A grouped list section with `rows` placeholder rows. */
export function SkeletonList({
  rows = 5,
  header = true,
  leading,
}: {
  rows?: number;
  header?: boolean;
  leading?: "icon" | "avatar" | "none";
}) {
  return (
    <div aria-hidden>
      {header && <Skeleton height={14} width={110} className="mx-4 mb-3" />}
      <div className="list-card">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          <SkeletonRow key={i} leading={leading} />
        ))}
      </div>
    </div>
  );
}

/** A card placeholder (title + text lines). */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cx("card p-[var(--card-pad)]", className)}>
      <Skeleton height={18} width="40%" className="mb-3" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** A StatCard placeholder. */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("card p-4", className)}>
      <Skeleton height={13} width="50%" />
      <Skeleton height={30} width="70%" className="mt-2.5" />
      <Skeleton height={20} width="45%" className="mt-2" rounded="full" />
    </div>
  );
}

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
