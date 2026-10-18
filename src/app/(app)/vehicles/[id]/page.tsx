import { Truck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCustomFieldDefs } from "@/features/settings/api";
import { setVehicleStatus } from "@/features/vehicles/actions";
import { ActionButton } from "@/features/vehicles/components/ActionButton";
import { SegmentLinks } from "@/features/vehicles/components/SegmentLinks";
import {
  type LogKind,
  VehicleActions,
} from "@/features/vehicles/components/VehicleActions";
import { VehicleFormButton } from "@/features/vehicles/components/VehicleFormButton";
import {
  DocsTab,
  IssuesTab,
  LogsTab,
  OverviewTab,
  ServiceTab,
  TripsTab,
} from "@/features/vehicles/components/VehicleTabs";
import type { VehicleFormValues } from "@/features/vehicles/contracts";
import { aiEnabled } from "@/features/vehicles/engine";
import {
  getVehicle,
  listAssignableUsers,
  listFleet,
} from "@/features/vehicles/queries";
import {
  approvalHint,
  canLogVehicle,
  type VehiclePolicies,
} from "@/features/vehicles/rules";
import { requireAnyPerm } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { ActionRailFrame } from "@/ui/components/PageActions";
import { SkeletonList } from "@/ui/components/Skeleton";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Vehicle" };

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "logs", label: "Logs" },
  { value: "service", label: "Service" },
  { value: "docs", label: "Docs" },
  { value: "issues", label: "Issues" },
  { value: "trips", label: "Trips" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const num = new Intl.NumberFormat("en-US");

export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPerm(["vehicles.view_own", "vehicles.view_all"]);
  if (!(await isEnabled("vehicles"))) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const {
    vehicle: v,
    assigneeName,
    description,
    photos,
  } = await getVehicle(id);
  const tab = (TABS.find((t) => t.value === sp.tab)?.value ??
    "overview") as Tab;
  const manage = user.perms.has("vehicles.manage");
  const all = user.perms.has("vehicles.view_all");
  const [settings, tz] = await Promise.all([
    getSettings(),
    getCompanyTimezone(),
  ]);
  const policies = settings.vehicles.policies as VehiclePolicies;
  const retired = v.status === "retired";
  const allowed: LogKind[] = retired
    ? []
    : [
        ...(
          ["odometer", "fuel", "service", "document", "inspection"] as const
        ).filter((k) => canLogVehicle(user, k, policies)),
        ...(user.perms.has("vehicles.report_issue")
          ? (["issue"] as const)
          : []),
      ];
  const canLogTrip = !retired && canLogVehicle(user, "trip", policies);
  const odometerHint = approvalHint(user, "odometer", policies, aiEnabled());
  // Pushed screen: always a way back (QA T1-16). The fleet for office/admin; a
  // tech with one vehicle lands here from More (/vehicles redirects straight here).
  const back = all
    ? { href: "/vehicles", label: "Vehicles" }
    : (await listFleet()).length > 1
      ? { href: "/vehicles", label: "My vehicle" }
      : { href: "/more", label: "More" };

  const [users, defs] = manage
    ? await Promise.all([listAssignableUsers(), getCustomFieldDefs("vehicle")])
    : [[], []];
  const initial: VehicleFormValues = {
    id: v.id,
    nickname: v.nickname,
    vin: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim,
    engine: v.engine,
    fuelType: v.fuelType,
    gvwrLbs: v.gvwrLbs,
    usdotNumber: v.usdotNumber,
    plate: v.plate,
    plateState: v.plateState,
    ownership: v.ownership as VehicleFormValues["ownership"],
    assignedUserId: v.assignedUserId,
    tankGal: v.tankGal,
    status: v.status as VehicleFormValues["status"],
    custom: Object.fromEntries(
      Object.entries((v.custom ?? {}) as Record<string, unknown>).filter(
        ([k]) => !k.startsWith("_"),
      ),
    ),
  };
  const hero = photos[0];

  return (
    <PageTransition>
      <ActionRailFrame enabled={allowed.length > 0}>
        <NavBar
          title={v.nickname}
          back={back}
          trailing={
            manage ? (
              <VehicleFormButton
                mode="edit"
                initial={initial}
                users={users.map((u) => ({ id: u.id, name: u.name }))}
                customDefs={defs}
              />
            ) : undefined
          }
        />
        <Page wide className="pt-4">
          <div className="flex flex-col gap-[var(--section-gap)]">
            <section
              className="list-card flex items-center gap-4 p-4"
              aria-label="Vehicle"
            >
              {hero?.thumbUrl ? (
                // biome-ignore lint/performance/noImgElement: signed storage thumbnail
                <img
                  src={hero.thumbUrl}
                  alt=""
                  width={72}
                  height={72}
                  className="size-[72px] shrink-0 rounded-[14px] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex size-[72px] shrink-0 items-center justify-center rounded-[14px] bg-fill-2 text-label-2"
                >
                  <Truck size={34} />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h1 className="truncate text-title2 font-bold">{v.nickname}</h1>
                <p className="truncate text-subhead text-label-2">
                  {[description, v.plate, assigneeName ?? "Unassigned"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill kind="vehicle" status={v.status} size="sm" />
                  <span className="num text-headline">
                    {v.odometerCached != null
                      ? `${num.format(v.odometerCached)} mi`
                      : "No reading yet"}
                  </span>
                </div>
              </div>
              {manage && !retired && (
                <div className="hidden sm:block">
                  <ActionButton
                    action={setVehicleStatus}
                    input={{
                      vehicleId: v.id,
                      status: v.status === "in_shop" ? "active" : "in_shop",
                    }}
                    success={
                      v.status === "in_shop"
                        ? "Back in service"
                        : "Marked in shop"
                    }
                  >
                    {v.status === "in_shop"
                      ? "Back in service"
                      : "Mark in shop"}
                  </ActionButton>
                </div>
              )}
            </section>

            <VehicleActions
              vehicle={{
                id: v.id,
                nickname: v.nickname,
                odometer: v.odometerCached,
                tankGal: v.tankGal,
              }}
              allowed={allowed}
              today={dateKey(new Date(), tz)}
              odometerHint={odometerHint}
            />

            <SegmentLinks
              param="tab"
              value={tab}
              segments={TABS}
              label="Vehicle sections"
              className="overflow-x-auto"
            />

            <Suspense key={tab} fallback={<SkeletonList rows={5} />}>
              {tab === "overview" && (
                <OverviewTab
                  v={v}
                  assigneeName={assigneeName}
                  photos={photos}
                  user={user}
                />
              )}
              {tab === "logs" && <LogsTab vehicleId={v.id} />}
              {tab === "service" && (
                <ServiceTab vehicleId={v.id} manage={manage} />
              )}
              {tab === "docs" && (
                <DocsTab
                  vehicleId={v.id}
                  canAdd={allowed.includes("document")}
                />
              )}
              {tab === "issues" && (
                <IssuesTab vehicleId={v.id} manage={manage} />
              )}
              {tab === "trips" && (
                <TripsTab v={v} user={user} canLog={canLogTrip} />
              )}
            </Suspense>
          </div>
        </Page>
      </ActionRailFrame>
    </PageTransition>
  );
}
