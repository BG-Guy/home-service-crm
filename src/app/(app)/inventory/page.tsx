import {
  Boxes,
  ClipboardList,
  PackageOpen,
  Truck,
  Warehouse,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  CountButton,
  MoveStockButton,
  ParButton,
  RequestRestockButton,
  SyncLocationsButton,
} from "@/features/parts/components/InventorySheets";
import { getInventory } from "@/features/parts/queries";
import { MOVE_LABEL } from "@/features/parts/server/inventory";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Inventory" };

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser("inventory.view");
  if (!(await isEnabled("inventory")) || !(await isEnabled("parts")))
    notFound();
  const sp = await searchParams;
  const inv = await getInventory(typeof sp.loc === "string" ? sp.loc : null);
  const tz = await getCompanyTimezone();
  const below = inv.levels.filter((l) => l.min != null && l.onHand < l.min);
  const value = inv.levels.reduce(
    (a, l) => a + Math.round(l.onHand * (l.costCents ?? 0)),
    0,
  );
  const isMyTruck = !!inv.mine && inv.current?.id === inv.mine.id;

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Inventory"
        subtitle={
          inv.current
            ? `${inv.current.name}${inv.current.assigned ? ` · ${inv.current.assigned}` : ""}`
            : undefined
        }
        trailing={
          <div className="flex items-center gap-2">
            {inv.manage && inv.locations.length > 0 && (
              <MoveStockButton
                locations={inv.locations}
                items={inv.items.map((i) => ({
                  id: i.id,
                  name: i.name,
                  sku: i.sku,
                  cost: i.cost,
                }))}
                currentId={inv.current?.id ?? null}
              />
            )}
            {!inv.manage &&
              isMyTruck &&
              inv.user.perms.has("inventory.request_restock") && (
                <RequestRestockButton
                  locationId={inv.current?.id ?? null}
                  belowPar={below.length}
                />
              )}
            <HeaderActions />
          </div>
        }
      />
      <Page wide>
        <div className="flex flex-col gap-[var(--section-gap)]">
          {inv.locations.length === 0 ? (
            <div className="list-card">
              <EmptyState
                icon={<Warehouse size={44} strokeWidth={1.5} />}
                title={inv.manage ? "No stock locations yet" : "No truck stock"}
                message={
                  inv.manage
                    ? "Add the warehouse and one location per vehicle, then receive stock."
                    : "You don't have a vehicle with stock assigned."
                }
                action={inv.manage ? <SyncLocationsButton /> : undefined}
              />
            </div>
          ) : (
            <>
              {inv.locations.length > 1 && (
                <ChipRow label="Location">
                  {inv.locations.map((l) => (
                    <Chip
                      key={l.id}
                      href={`/inventory?loc=${l.id}`}
                      replace
                      selected={l.id === inv.current?.id}
                      icon={
                        l.kind === "warehouse" ? (
                          <Warehouse size={15} aria-hidden />
                        ) : (
                          <Truck size={15} aria-hidden />
                        )
                      }
                    >
                      {l.name}
                    </Chip>
                  ))}
                </ChipRow>
              )}
              {below.length > 0 && (
                <Banner
                  tone="warning"
                  title={`${below.length} item${below.length === 1 ? "" : "s"} below par`}
                >
                  {below
                    .slice(0, 4)
                    .map((b) => b.name)
                    .join(", ")}
                  {below.length > 4 ? "…" : ""}
                </Banner>
              )}
              <ListSection
                header="On hand"
                trailing={
                  inv.manage && inv.current ? (
                    <CountButton
                      locationId={inv.current.id}
                      locationName={inv.current.name}
                      levels={inv.levels.map((l) => ({
                        itemId: l.itemId,
                        name: l.name,
                        onHand: l.onHand,
                      }))}
                    />
                  ) : null
                }
                footer={
                  inv.levels.length
                    ? `Stock value at average cost: ${formatMoney(value)}`
                    : undefined
                }
              >
                {inv.levels.length === 0 ? (
                  <ListRow
                    icon={<PackageOpen size={18} aria-hidden />}
                    iconTone="gray"
                    title="Nothing stocked here"
                    subtitle={
                      inv.manage
                        ? "Use Move stock → Receive or Transfer."
                        : undefined
                    }
                  />
                ) : (
                  inv.levels.map((l) => {
                    const low = l.min != null && l.onHand < l.min;
                    return (
                      <ListRow
                        key={l.itemId}
                        icon={<Boxes size={18} aria-hidden />}
                        iconTone={low ? "orange" : "blue"}
                        title={l.name}
                        subtitle={[
                          l.sku,
                          l.min != null || l.max != null
                            ? `Par ${l.min ?? "–"}–${l.max ?? "–"}`
                            : "No par set",
                          l.costCents != null &&
                          inv.user.perms.has("parts.view_cost")
                            ? `avg ${formatMoney(l.costCents)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        detail={
                          <span className="flex items-center gap-2">
                            <span
                              className={
                                low
                                  ? "num font-semibold text-warning"
                                  : "num text-label"
                              }
                            >
                              {qty(l.onHand)}
                            </span>
                            {inv.manage && inv.current && (
                              <ParButton
                                locationId={inv.current.id}
                                item={{ id: l.itemId, name: l.name }}
                                min={l.min}
                                max={l.max}
                              />
                            )}
                          </span>
                        }
                      />
                    );
                  })
                )}
              </ListSection>
            </>
          )}

          {inv.restock.length > 0 && (
            <ListSection
              header="Restock requests"
              footer={
                inv.manage
                  ? "Transfer the items to the truck to close a request."
                  : undefined
              }
            >
              {inv.restock.map((t) => (
                <ListRow
                  key={t.id}
                  icon={<Truck size={18} aria-hidden />}
                  iconTone="orange"
                  multiline
                  title={t.title}
                  subtitle={t.body ?? undefined}
                  detail={formatDateTime(t.createdAt, tz)}
                />
              ))}
            </ListSection>
          )}

          {inv.manage && inv.variances.length > 0 && (
            <ListSection
              header="Count variances (last 35 days)"
              footer="Variances are recorded only; nothing is deducted from anyone's pay."
            >
              {inv.variances.map((v) => (
                <ListRow
                  key={v.id}
                  icon={<ClipboardList size={18} aria-hidden />}
                  iconTone={v.delta < 0 ? "red" : "green"}
                  title={v.item}
                  subtitle={`${v.location ?? ""} · ${formatDateTime(v.at, tz)}`}
                  detail={
                    <span className="num">
                      {v.delta > 0 ? "+" : ""}
                      {qty(v.delta)} · {formatMoney(v.valueCents)}
                    </span>
                  }
                />
              ))}
            </ListSection>
          )}

          {inv.manage && inv.locations.length > 0 && (
            <div className="flex justify-center">
              <SyncLocationsButton />
            </div>
          )}
          {inv.moves.length > 0 && (
            <ListSection header="Recent moves">
              {inv.moves.map((m) => {
                const into = m.m.toLocationId === inv.current?.id;
                const signed =
                  m.m.kind === "adjust" || m.m.kind === "count"
                    ? Number(m.m.qty)
                    : into
                      ? Number(m.m.qty)
                      : -Number(m.m.qty);
                return (
                  <ListRow
                    key={m.m.id}
                    title={m.item}
                    subtitle={[
                      MOVE_LABEL[m.m.kind as keyof typeof MOVE_LABEL] ??
                        m.m.kind,
                      m.jobNumber,
                      m.actor,
                      formatDateTime(m.m.createdAt, tz),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    detail={
                      <span
                        className={
                          signed < 0 ? "num text-danger" : "num text-success"
                        }
                      >
                        {signed > 0 ? "+" : ""}
                        {qty(signed)}
                      </span>
                    }
                  />
                );
              })}
            </ListSection>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
