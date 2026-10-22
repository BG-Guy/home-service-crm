import { MonitorPlay } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { LiveMap } from "@/features/map/components/LiveMap";
import { getLiveMap } from "@/features/map/queries";
import { requireUser } from "@/lib/auth/current";
import { isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { FullscreenButton } from "@/ui/components/FullscreenButton";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage() {
  await requireUser("map.view");
  if (!(await isEnabled("map"))) notFound();
  const data = await getLiveMap();
  const live = data.techs.filter((t) => t.clockedIn).length;
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Map"
        subtitle={`${live} of ${data.techs.length} techs on shift · ${data.jobs.length} jobs today`}
        trailing={
          <>
            {/* Wall mode for an office TV or a tablet (the map's FullscreenHub
                "wall"); phones use the map's corner Expand. */}
            <FullscreenButton
              hub="wall"
              icon={<MonitorPlay size={18} aria-hidden />}
              variant="tinted"
              className="mr-1 hidden md:inline-flex"
            >
              Wall mode
            </FullscreenButton>
            <HeaderActions />
          </>
        }
      />
      <Page wide>
        <LiveMap data={data} />
      </Page>
    </PageTransition>
  );
}
