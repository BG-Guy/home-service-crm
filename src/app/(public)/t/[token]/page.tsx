import { CheckCircle2, Clock, Phone } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AutoRefresh } from "@/features/map/components/AutoRefresh";
import { StaticMap } from "@/features/map/components/StaticMap";
import { getTrackingView } from "@/features/map/tracking";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { TechCard } from "@/ui/components/TechCard";

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
      <div className="list-card mt-4">
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
        <div className="list-card" aria-live="polite">
          <EmptyState
            icon={
              view.phase === "inactive" ? (
                <Clock size={44} strokeWidth={1.5} />
              ) : (
                <CheckCircle2 size={44} strokeWidth={1.5} />
              )
            }
            title={copy.title(view.firstName)}
            message={copy.message}
          />
        </div>
        {view.companyPhone && (
          <Button
            href={`tel:${view.companyPhone}`}
            variant="gray"
            size="lg"
            fullWidth
            icon={<Phone size={18} aria-hidden />}
          >
            Call {view.companyName || "us"}
          </Button>
        )}
      </div>
    );
  }

  const { etaClock } = view;
  return (
    <div className="mt-2 flex flex-col gap-4">
      <AutoRefresh seconds={90} />
      <section
        className="list-card flex flex-col gap-1 p-5 text-center"
        aria-live="polite"
      >
        <p className="text-subhead text-label-2">
          {view.tech.firstName} is on the way
        </p>
        <p className="num text-large-title font-bold">
          {view.etaMinutes != null
            ? `About ${view.etaMinutes} min`
            : "On the way"}
        </p>
        {etaClock && (
          <p className="text-subhead text-label-2">
            Expected around {etaClock}
          </p>
        )}
      </section>
      <div className="list-card p-4">
        <TechCard
          firstName={view.tech.firstName}
          photoUrl={view.tech.photoUrl}
          seed={view.tech.seed}
          licenseNo={view.tech.licenseNo}
          subtitle={view.companyName}
        />
      </div>
      {view.tech_at ? (
        <figure className="flex flex-col gap-1.5">
          <StaticMap
            center={view.tech_at}
            dest={view.dest}
            label={`Last known position of ${view.tech.firstName}`}
          />
          <figcaption className="px-1 text-footnote text-label-2">
            Last known position, updated {ago(view.tech_at.recordedAt)}. This
            page refreshes on its own.
          </figcaption>
        </figure>
      ) : (
        <p className="px-1 text-footnote text-label-2">
          Your technician’s position isn’t available right now — the ETA above
          is our best estimate.
        </p>
      )}
      {view.companyPhone && (
        <Button
          href={`tel:${view.companyPhone}`}
          variant="gray"
          size="lg"
          fullWidth
          icon={<Phone size={18} aria-hidden />}
        >
          Call {view.companyName || "us"}
        </Button>
      )}
      <p className="px-1 text-caption text-label-2">
        Live tracking ends when your technician arrives. This link expires after
        3 hours.
      </p>
    </div>
  );
}
