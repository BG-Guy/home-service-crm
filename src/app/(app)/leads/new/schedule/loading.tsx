import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

/** Calendar-shaped skeleton for step 2 (same size as the month grid). */
export default function Loading() {
  return (
    <PageTransition>
      <NavBar title="Schedule" back={{ href: "/leads/new", label: "Caller" }} />
      <Page className="pt-2" wide>
        <div aria-busy className="mx-auto w-full max-w-[1160px]">
          <BookingSteps current={2} className="mb-5 max-w-[640px]" />
          <span className="skeleton mb-5 block h-11 w-64 rounded-control" />
          <div className="grid gap-8 md:grid-cols-2 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]">
            {[0, 1].map((m) => (
              <div key={m} className={m ? "hidden md:block" : undefined}>
                <span className="skeleton mx-auto mb-4 block h-5 w-36 rounded-full" />
                <div className="grid grid-cols-7 gap-y-4">
                  {Array.from({ length: 35 }, (_, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder grid
                      key={i}
                      className="skeleton mx-auto block size-10 rounded-full"
                    />
                  ))}
                </div>
              </div>
            ))}
            <span className="skeleton hidden h-[420px] rounded-card min-[1200px]:block" />
          </div>
        </div>
      </Page>
    </PageTransition>
  );
}
