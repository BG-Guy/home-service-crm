import type { Metadata } from "next";
import { tileSource } from "@/adapters/maps";
import {
  MapSettingsForm,
  StreetMapSettings,
} from "@/features/map/components/MapSettingsForm";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Map" };

/** Street map tiles for every map; the live map settings when that feature is on. */
export default async function SettingsMapPage() {
  await requireUser("settings.manage");
  const [live, settings] = await Promise.all([isEnabled("map"), getSettings()]);
  const m = settings.map;
  return (
    <PageTransition>
      <NavBar title="Map" back={{ href: "/settings", label: "Settings" }} />
      <Page className="flex flex-col gap-6 pt-4">
        <StreetMapSettings source={tileSource(m)} />
        {live ? (
          <MapSettingsForm
            initial={{
              keep_breadcrumbs_days: m.keep_breadcrumbs_days,
              ping_interval_sec: m.ping_interval_sec,
              stale_minutes: m.stale_minutes,
              hide_after_minutes: m.hide_after_minutes,
            }}
          />
        ) : (
          <p className="px-4 text-footnote text-label-2">
            The live tech map is off. Turn it on in Settings → Features to set
            location pings and breadcrumbs.
          </p>
        )}
      </Page>
    </PageTransition>
  );
}
