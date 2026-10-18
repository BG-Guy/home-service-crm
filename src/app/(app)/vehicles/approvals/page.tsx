import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewDetail } from "@/features/vehicles/components/Review";
import {
  ApproveAllCleanButton,
  ReviewDecision,
} from "@/features/vehicles/components/ReviewDecision";
import { SegmentLinks } from "@/features/vehicles/components/SegmentLinks";
import { aiEnabled } from "@/features/vehicles/engine";
import {
  listVehicleReviewItems,
  VEHICLE_KINDS,
} from "@/features/vehicles/queries";
import { requireUser } from "@/lib/auth/current";
import { isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Review vehicle logs" };

const KINDS = [
  { value: "all", label: "All" },
  { value: "odometer", label: "Odometer" },
  { value: "fuel", label: "Fuel" },
  { value: "service", label: "Service" },
  { value: "document", label: "Docs" },
  { value: "inspection", label: "Inspect" },
  { value: "trip", label: "Trips" },
] as const;

export default async function VehiclesApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser("vehicles.log_approve");
  if (!(await isEnabled("vehicles"))) notFound();
  const sp = await searchParams;
  const kind = (VEHICLE_KINDS as readonly string[]).includes(String(sp.kind))
    ? (sp.kind as (typeof VEHICLE_KINDS)[number])
    : null;
  const items = await listVehicleReviewItems(kind);
  const cleanIds = items.filter((i) => i.clean).map((i) => i.approvalId);
  const ai = aiEnabled();

  return (
    <PageTransition>
      <NavBar
        title="Review logs"
        back={{ href: "/vehicles", label: "Vehicles" }}
        trailing={<ApproveAllCleanButton ids={cleanIds} />}
      />
      <Page wide className="pt-4">
        <div className="flex flex-col gap-[var(--section-gap)]">
          <SegmentLinks
            param="kind"
            value={kind ?? "all"}
            segments={KINDS}
            label="Entry type"
            className="overflow-x-auto"
          />
          {items.length === 0 ? (
            <div className="list-card">
              <EmptyState
                icon={<CircleCheck size={44} strokeWidth={1.5} />}
                title="All caught up"
                message="New odometer, fuel, service and document entries that need a look will appear here."
              />
            </div>
          ) : (
            items.map((item) => (
              <article
                key={item.approvalId}
                className="list-card flex flex-col gap-4 p-4"
                aria-label={`${item.vehicleName}: ${item.headline}`}
              >
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-headline">
                    {item.vehicleId ? (
                      <Link
                        href={`/vehicles/${item.vehicleId}`}
                        className="text-accent-text"
                      >
                        {item.vehicleName}
                      </Link>
                    ) : (
                      item.vehicleName
                    )}
                    <span className="font-normal text-label-2">
                      {" "}
                      · {item.headline}
                    </span>
                  </h2>
                </header>
                <ReviewDetail item={item} />
                <ReviewDecision
                  approvalId={item.approvalId}
                  editable={item.editable}
                  current={item.current}
                  hasFlags={item.flags.length > 0}
                  aiEnabled={ai}
                />
              </article>
            ))
          )}
          <p className="px-4 text-footnote text-label-2">
            Every decision is audited. Pending entries don’t reset reminders or
            create reimbursements until approved. All approval kinds are also on{" "}
            <Link href="/approvals" className="text-accent-text">
              Approvals
            </Link>
            .
          </p>
        </div>
      </Page>
    </PageTransition>
  );
}
