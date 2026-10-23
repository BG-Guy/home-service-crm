import { Page } from "@/ui/components/AppShell";
import { SkeletonHeader } from "@/ui/components/NavTitles";
import { Skeleton } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

/** The lead page skeleton: the card's TL;DR, its boxes and the action groups. */
export default function Loading() {
  return (
    <PageTransition>
      <output className="sr-only">Loading</output>
      <SkeletonHeader bar back={{ href: "/leads", label: "Leads" }} />
      <Page className="pt-3">
        <div
          aria-hidden
          className="mx-auto flex max-w-[720px] flex-col gap-[var(--section-gap)]"
        >
          <div className="flex flex-col gap-3">
            <Skeleton height={32} width="62%" />
            <div className="flex gap-2">
              <Skeleton height={32} width={150} rounded="full" />
              <Skeleton height={32} width={120} rounded="full" />
            </div>
            <Skeleton height={16} width="48%" />
            <Skeleton height={16} width="40%" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton height={168} rounded="card" />
            <Skeleton height={168} rounded="card" />
            <Skeleton height={104} rounded="card" />
            <Skeleton height={104} rounded="card" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton height={118} rounded="card" />
            <Skeleton height={118} rounded="card" />
          </div>
        </div>
      </Page>
    </PageTransition>
  );
}
