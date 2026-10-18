import { Inbox, Truck } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createItemsFor } from "@/app/(app)/_components/create-items";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { getCustomFieldDefs } from "@/features/settings/api";
import { getFleetSummary } from "@/features/vehicles/api";
import { FleetSummaryView } from "@/features/vehicles/components/FleetSummary";
import { SegmentLinks } from "@/features/vehicles/components/SegmentLinks";
import { VehicleFormButton } from "@/features/vehicles/components/VehicleFormButton";
import { VehicleRowView } from "@/features/vehicles/components/VehicleRow";
import {
  listAssignableUsers,
  listFleet,
  listPendingVehicleApprovals,
} from "@/features/vehicles/queries";
import { requireAnyPerm } from "@/lib/auth/current";
import { getFeatureFlags, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Vehicles" };

const STATUS = [
  { value: "active", label: "Active" },
  { value: "in_shop", label: "In shop" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
] as const;
type StatusFilter = (typeof STATUS)[number]["value"];

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPerm(["vehicles.view_own", "vehicles.view_all"]);
  if (!(await isEnabled("vehicles"))) notFound();
  const sp = await searchParams;
  const all = user.perms.has("vehicles.view_all");
  const manage = user.perms.has("vehicles.manage");
  const status = (STATUS.find((s) => s.value === sp.status)?.value ??
    "active") as StatusFilter;

  // "My vehicle": a tech with one assigned vehicle goes straight to it.
  if (!all) {
    const mine = await listFleet({ status: "all" });
    const live = mine.filter((v) => v.status !== "retired");
    if (live.length === 1 && live[0]) redirect(`/vehicles/${live[0].id}`);
    return (
      <PageTransition>
        <LargeTitleHeader title="My vehicle" trailing={<HeaderActions />} />
        <Page>
          {live.length === 0 ? (
            <div className="list-card">
              <EmptyState
                icon={<Truck size={44} strokeWidth={1.5} />}
                title="No vehicle assigned"
                message="When the office assigns you a vehicle, its logs, reminders and inspections show up here."
              />
            </div>
          ) : (
            <ListSection>
              {live.map((v) => (
                <VehicleRowView key={v.id} v={v} />
              ))}
            </ListSection>
          )}
        </Page>
      </PageTransition>
    );
  }

  const now = new Date();
  const [fleet, summary, pending, users, defs] = await Promise.all([
    listFleet({ status }),
    getFleetSummary(new Date(now.getTime() - 30 * 86_400_000), now),
    user.perms.has("vehicles.log_approve")
      ? listPendingVehicleApprovals()
      : Promise.resolve([]),
    manage ? listAssignableUsers() : Promise.resolve([]),
    manage ? getCustomFieldDefs("vehicle") : Promise.resolve([]),
  ]);
  const formProps = {
    users: users.map((u) => ({ id: u.id, name: u.name })),
    customDefs: defs,
  };
  // One "+" in the header (QA T4-11): when the global "+" menu offers New Vehicle
  // (`/vehicles?new=vehicle`), the page keeps only the deep link, not a 2nd "+".
  const inPlusMenu = createItemsFor(user.perms, await getFeatureFlags()).some(
    (i) => i.href.startsWith("/vehicles?new="),
  );

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Vehicles"
        trailing={
          <div className="flex items-center gap-1">
            {manage && (
              <VehicleFormButton
                mode="new"
                hideTrigger={inPlusMenu}
                {...formProps}
              />
            )}
            <HeaderActions />
          </div>
        }
      />
      <Page wide>
        <div className="flex flex-col gap-[var(--section-gap)]">
          <FleetSummaryView data={summary} periodLabel="Last 30 days" />
          {pending.length > 0 && (
            <ListSection>
              <ListRow
                href="/vehicles/approvals"
                icon={<Inbox size={18} />}
                iconTone="orange"
                title="Logs waiting for review"
                subtitle="Odometer, fuel, service, documents and trips"
                badge={pending.length}
              />
            </ListSection>
          )}
          <SegmentLinks
            param="status"
            value={status}
            segments={STATUS}
            label="Vehicle status"
          />
          {fleet.length === 0 ? (
            <div className="list-card">
              <EmptyState
                icon={<Truck size={44} strokeWidth={1.5} />}
                title={status === "active" ? "No vehicles yet" : "Nothing here"}
                message={
                  status === "active"
                    ? "Add your vans and trucks to track odometer, fuel, service reminders and documents."
                    : "No vehicles with this status."
                }
                action={
                  manage && status === "active" ? (
                    <VehicleFormButton mode="new-inline" {...formProps} />
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ListSection
              header={`${fleet.length} vehicle${fleet.length === 1 ? "" : "s"}`}
            >
              {fleet.map((v) => (
                <VehicleRowView key={v.id} v={v} />
              ))}
            </ListSection>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
