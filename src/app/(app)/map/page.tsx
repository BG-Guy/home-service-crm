import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { LiveMap } from "@/features/map/components/LiveMap";
import { getLiveMap } from "@/features/map/queries";
import { requireUser } from "@/lib/auth/current";
import { isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
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
        trailing={<HeaderActions />}
      />
      <Page wide>
        <LiveMap data={data} />
      </Page>
    </PageTransition>
  );
}
