import { Skeleton, SkeletonList } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

export default function Loading() {
  return (
    <PageTransition>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-[var(--gutter)] pt-[calc(env(safe-area-inset-top)+64px)] md:grid md:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[52dvh] w-full md:h-[70dvh]" rounded="card" />
        <SkeletonList rows={4} leading="avatar" />
      </div>
    </PageTransition>
  );
}
