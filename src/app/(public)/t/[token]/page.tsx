import { Clock, Phone } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AutoRefresh } from "@/features/map/components/AutoRefresh";
import { StaticMap } from "@/features/map/components/StaticMap";
import { getTrackingView } from "@/features/map/tracking";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { Pill } from "@/ui/components/StatusPill";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { TechCard } from "@/ui/components/TechCard";
import { TripTimeline } from "@/ui/components/Timeline";

export const metadata: Metadata = {
  title: "Technician on the way",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function ago(iso: string): string {
  const min = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  return min < 1 ? "just now" : `${min} min ago`;
}

const DONE_COPY = {
  arrived: {
    title: (name: string | null) =>
      name ? `${name} has arrived` : "Your technician has arrived",
    message: "Live tracking has ended.",
  },
  finished: {
    title: () => "Your visit is complete",
    message: "Thanks for choosing us.",
  },
  inactive: {
    title: () => "Tracking isn’t active",
    message: "We’ll text you a new link when your technician is on the way.",
  },
} as const;

// /t/[token] (SPEC M19): live only while the job is en route (≤ 3 h). After arrival
// the link shows "arrived" (no position) until it expires.
export default async function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, h] = await Promise.all([params, headers()]);
  const view = await getTrackingView(token, {
    ip: clientIpFromHeaders(h),
    userAgent: h.get("user-agent"),
  });

  if (view.state === "invalid")
    return (
      <div className="card mt-4">
        <EmptyState
          icon={<Clock size={44} strokeWidth={1.5} />}
          title="This link has expired"
          message="Tracking links work only while your technician is on the way."
        />
      </div>
    );

  if (view.state === "done") {
    const copy = DONE_COPY[view.phase];
    return (
      <div className="mt-4 flex flex-col gap-4">
        <section
          className="card flex flex-col items-center px-6 py-10 text-center"
          aria-live="polite"
        >
          {view.phase === "inactive" ? (
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-fill text-label-2">
              <Clock size={28} aria-hidden />
            </span>
          ) : (
            <SuccessCheck label={copy.title(view.firstName)} />
          )}
          <h1 className="mt-4 text-title2">{copy.title(view.firstName)}</h1>
          <p className="mt-1 text-body text-label-2">{copy.message}</p>
        </section>
        {view.companyPhone && (
          <Button
            href={`tel:${view.companyPhone}`}
            variant="secondary"
            size="lg"
            block
            icon={<Phone size={18} aria-hidden />}
          >
            Call {view.companyName || "us"}
          </Button>
        )}
      </div>
    );
  }

  const { etaClock, etaMinutes } = view;
  const first = view.tech.firstName;
  const arriving = etaClock
    ? `Arriving around ${etaClock}`
    : etaMinutes != null
      ? `Arriving in about ${etaMinutes} min`
      : "Arriving soon";
  return (
    <div className="mt-1 flex flex-col gap-4">
      <AutoRefresh seconds={90} />
      {/* Uber-style ETA hero: map on top, then the live status and the ETA */}
      <section className="card overflow-hidden" aria-live="polite">
        {view.tech_at ? (
          <StaticMap
            center={view.tech_at}
            dest={view.dest}
            height={200}
            flush
            label={`Last known position of ${first}`}
          />
        ) : null}
        <div className="flex items-end justify-between gap-4 p-5">
          <div className="min-w-0">
            <Pill tone="blue" live>
              On the way
            </Pill>
            <h1 className="mt-3 text-title1">{first} is on the way</h1>
            <p className="mt-1 text-body text-label-2">{arriving}</p>
          </div>
          {etaMinutes != null ? (
            <div className="shrink-0 rounded-tile bg-label px-3.5 py-2.5 text-center text-bg">
              <div className="num text-title1 leading-none">{etaMinutes}</div>
              <div className="mt-1 text-caption">min</div>
            </div>
          ) : null}
        </div>
      </section>

      <TechCard
        firstName={first}
        photoUrl={view.tech.photoUrl}
        seed={view.tech.seed}
        licenseNo={view.tech.licenseNo}
        subtitle="Your technician"
      />

      <section className="card p-5" aria-labelledby="trip-title">
        <h2 id="trip-title" className="text-headline">
          Your visit
        </h2>
        <TripTimeline
          className="mt-4"
          label="Visit progress"
          steps={[
            { id: "booked", state: "done", title: "Booked" },
            {
              id: "way",
              state: "current",
              title: `${first} is driving to you`,
              body: view.tech_at
                ? `Position updated ${ago(view.tech_at.recordedAt)}`
                : "Live position not available, the ETA is our best estimate",
              time: "Now",
            },
            {
              id: "arrive",
              state: "upcoming",
              title: "Arrives at your door",
              time: etaClock ? `~${etaClock}` : undefined,
            },
            { id: "work", state: "upcoming", title: "Work begins" },
          ]}
        />
      </section>

      {view.companyPhone && (
        <Button
          href={`tel:${view.companyPhone}`}
          variant="secondary"
          size="lg"
          block
          icon={<Phone size={18} aria-hidden />}
        >
          Call {view.companyName || "us"}
        </Button>
      )}
      <p className="px-1 text-center text-footnote text-label-2">
        This page refreshes on its own. Live tracking ends when your technician
        arrives, and the link expires after 3 hours.
      </p>
    </div>
  );
}
