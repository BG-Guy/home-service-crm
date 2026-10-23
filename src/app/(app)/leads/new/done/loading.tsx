import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

/** The Done card's shape (steps, check, title, status, three buttons). */
export default function Loading() {
  return (
    <PageTransition>
      <NavBar title="Booked" back={{ href: "/leads", label: "Leads" }} />
      <Page className="pt-2">
        <div
          aria-busy
          className="mx-auto flex w-full max-w-[560px] flex-col gap-6"
        >
          <BookingSteps current={4} />
          <div className="flex flex-col items-center gap-4 rounded-card bg-card px-5 py-8 shadow-card">
            <span className="skeleton size-16 rounded-full" />
            <span className="skeleton block h-6 w-64 rounded-full" />
            <span className="skeleton block h-4 w-48 rounded-full" />
            <span className="skeleton block h-7 w-72 rounded-[12px]" />
            <span className="skeleton mt-2 block h-[52px] w-full rounded-full" />
            <span className="skeleton block h-[52px] w-full rounded-full" />
          </div>
        </div>
      </Page>
    </PageTransition>
  );
}
