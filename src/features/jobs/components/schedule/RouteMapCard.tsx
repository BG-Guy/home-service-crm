"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/ui/components/Skeleton";
import { cx } from "@/ui/cx";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import type { RouteLine, RoutePin } from "../../route-plan";

// The tech's "Today's route" map on /today: the compact RouteMap, loaded only when
// the card comes near the viewport so the Today page's own JS doesn't grow (Leaflet
// and the canvas are a lazy chunk). Tapping a pin opens that job. If the chunk can't
// load (offline in a basement), the card quietly goes away: the route list under it
// has every stop.

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function RouteMapCard({
  pins,
  lines,
  tileUrl,
  attribution,
  canSetup = false,
  label,
  className,
}: {
  pins: RoutePin[];
  lines: RouteLine[];
  tileUrl: string;
  attribution: string;
  canSetup?: boolean;
  /** Accessible name of the map. */
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Quiet>
      <div
        ref={box}
        className={cx(
          "relative overflow-hidden rounded-card bg-fill-2 shadow-card",
          className,
        )}
      >
        {near && (
          <RouteMap
            compact
            pins={pins}
            lines={lines}
            tileUrl={tileUrl}
            attribution={attribution}
            canSetup={canSetup}
            label={label}
            onSelect={(id) =>
              router.push(`/jobs/${id}`, { transitionTypes: NAV_FORWARD })
            }
            className="size-full"
          />
        )}
      </div>
    </Quiet>
  );
}
