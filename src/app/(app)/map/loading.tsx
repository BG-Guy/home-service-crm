import { Skeleton, SkeletonList } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

/** Mirrors /map: full-bleed map + bottom sheet (phone), map + side panel (desktop). */
export default function Loading() {
  return (
    <PageTransition>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col px-[var(--gutter)] pt-[calc(env(safe-area-inset-top)+64px)] md:grid md:grid-cols-[minmax(0,1fr)_360px] md:gap-4">
        <Skeleton className="-mx-[var(--gutter)] h-[56dvh] w-auto rounded-none md:mx-0 md:h-[70dvh] md:rounded-card" />
        <div className="relative z-[1] -mx-[var(--gutter)] -mt-6 rounded-t-[24px] bg-bg px-[var(--gutter)] pt-4 md:mx-0 md:mt-0 md:px-0 md:pt-0">
          <SkeletonList rows={4} leading="avatar" />
        </div>
      </div>
    </PageTransition>
  );
}
