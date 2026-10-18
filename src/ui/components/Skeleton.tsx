import type { CSSProperties } from "react";
import { cx } from "../cx";

/*
 * Loading placeholders for `loading.tsx` files (SPEC §12.6): shimmer-free
 * opacity pulse that stops under reduced motion. Each variant matches the
 * geometry of the real component so content doesn't jump when it arrives.
 * The full-page placeholder is `SkeletonPage.tsx` (it pulls in the nav bars, so
 * it stays out of the shell, which imports these primitives).
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

/** A list row placeholder (44+ px, optional leading tile/avatar). */
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
      className="list-row flex min-h-11 items-center gap-3 px-4 py-2.5"
      data-icon={leading === "icon" ? "" : undefined}
    >
      {leading === "icon" && (
        <Skeleton width={29} height={29} className="rounded-[7px]" />
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
      {header && <Skeleton height={11} width={96} className="mx-4 mb-2.5" />}
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
    <div
      aria-hidden
      className={cx("rounded-card bg-card p-4 shadow-card", className)}
    >
      <Skeleton height={16} width="40%" className="mb-3" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** A StatCard placeholder. */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("rounded-tile bg-card p-4 shadow-card", className)}
    >
      <Skeleton height={12} width="50%" />
      <Skeleton height={28} width="70%" className="mt-2.5" />
      <Skeleton height={12} width="40%" className="mt-2.5" />
    </div>
  );
}
