import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  VehicleSettingsForm,
  type VehicleSettingsValues,
} from "@/features/vehicles/components/VehicleSettingsForm";
import { aiEnabled } from "@/features/vehicles/engine";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Vehicles" };

export default async function SettingsVehiclesPage() {
  await requireUser("settings.manage");
  if (!(await isEnabled("vehicles"))) notFound();
  const v = (await getSettings()).vehicles;
  const initial: VehicleSettingsValues = {
    policies: v.policies,
    inspection_frequency: v.inspection_frequency,
    require_odometer_on_clock: v.require_odometer_on_clock,
    max_daily_miles: v.max_daily_miles,
    anomaly: v.anomaly,
    issue_ack_target_minutes: v.issue_ack_target_minutes,
    reminder_seeds: v.reminder_seeds,
  };
  return (
    <PageTransition>
      <NavBar
        title="Vehicles"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page className="pt-4">
        <VehicleSettingsForm initial={initial} aiEnabled={aiEnabled()} />
      </Page>
    </PageTransition>
  );
}
