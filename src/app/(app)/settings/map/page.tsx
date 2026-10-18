import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapSettingsForm } from "@/features/map/components/MapSettingsForm";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Live map" };

export default async function SettingsMapPage() {
  await requireUser("settings.manage");
  if (!(await isEnabled("map"))) notFound();
  const m = (await getSettings()).map;
  return (
    <PageTransition>
      <NavBar
        title="Live map"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page className="pt-4">
        <MapSettingsForm
          initial={{
            keep_breadcrumbs_days: m.keep_breadcrumbs_days,
            ping_interval_sec: m.ping_interval_sec,
            stale_minutes: m.stale_minutes,
            hide_after_minutes: m.hide_after_minutes,
          }}
        />
      </Page>
    </PageTransition>
  );
}
