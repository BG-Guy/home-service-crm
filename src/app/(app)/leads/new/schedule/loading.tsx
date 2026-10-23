import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

/** The When step's shape: steps, the lead line, the job type row, the week strip and the windows. */
export default function Loading() {
  return (
    <PageTransition>
      <NavBar title="Book" back={{ href: "/leads", label: "Leads" }} />
      <Page className="pt-2">
        <div
          aria-busy
          className="mx-auto w-full max-w-[1160px] min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,1fr)_360px] min-[1200px]:gap-8"
        >
          <div className="flex flex-col gap-5">
            <BookingSteps current={3} />
            <div className="flex items-center gap-3">
              <span className="skeleton size-9 shrink-0 rounded-full" />
              <span className="flex flex-col gap-1.5">
                <span className="skeleton block h-4 w-40 rounded-full" />
                <span className="skeleton block h-3 w-56 rounded-full" />
              </span>
            </div>
            <span className="skeleton block h-[64px] rounded-card" />
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                <span
                  key={i}
                  className="skeleton block h-[76px] w-[54px] shrink-0 rounded-tile"
                />
              ))}
            </div>
            <span className="skeleton block h-4 w-28 rounded-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="skeleton block h-[86px] rounded-tile"
                />
              ))}
            </div>
          </div>
          <span className="skeleton hidden h-[220px] rounded-card min-[1200px]:block" />
        </div>
      </Page>
    </PageTransition>
  );
}
