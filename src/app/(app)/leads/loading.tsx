import { cookies } from "next/headers";
import {
  LEAD_COLS_COOKIE,
  parseLeadCols,
} from "@/features/leads/components/inbox-prefs";
import { Page } from "@/ui/components/AppShell";
import { SkeletonHeader } from "@/ui/components/NavTitles";
import { Skeleton } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

/** The inbox skeleton: header, count line, chips and the lead-box grid. */
export default async function Loading() {
  const cols = parseLeadCols((await cookies()).get(LEAD_COLS_COOKIE)?.value);
  return (
    <PageTransition>
      <output className="sr-only">Loading</output>
      <SkeletonHeader title="Leads" search />
      <Page wide className="pb-6 lg:max-w-[1480px]">
        <div aria-hidden className="flex min-h-11 items-center gap-3">
          <Skeleton height={22} width={140} />
          <Skeleton
            height={32}
            width={92}
            rounded="full"
            className="ml-auto md:hidden"
          />
        </div>
        <div aria-hidden className="mt-1 flex gap-2 overflow-hidden py-1.5">
          {[84, 72, 104, 96, 80, 70].map((w) => (
            <Skeleton key={w} height={34} width={w} rounded="full" />
          ))}
        </div>
        <div className="mt-3 lg:grid lg:grid-cols-[minmax(340px,1fr)_min(50vw,calc(100%_-_360px))] lg:gap-5">
          <div
            aria-hidden
            className={
              cols === 1
                ? "grid gap-3 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))] lg:grid-cols-1"
                : "grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(232px,1fr))] lg:grid-cols-1"
            }
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                key={i}
                height={cols === 1 ? 172 : 150}
                rounded="card"
              />
            ))}
          </div>
          <Skeleton height={560} rounded="card" className="hidden lg:block" />
        </div>
      </Page>
    </PageTransition>
  );
}
