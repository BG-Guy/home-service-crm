import { FileWarning, Wrench } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiProviderName } from "@/adapters/ai";
import { ActivityTimeline } from "@/features/notify/slots";
import { getCustomFieldDefs, getEntityTags } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { setToolStatus } from "@/features/tools/actions";
import {
  CheckOutButton,
  HandoffButton,
  IncidentButton,
  MaintenanceButton,
  ToolFormButton,
} from "@/features/tools/components/ToolButtons";
import type { ToolFormValues } from "@/features/tools/contracts";
import {
  getTool,
  getToolHistory,
  listCustodians,
  today as todayKey,
} from "@/features/tools/queries";
import { BLOCK_LABEL, checkoutBlock, dueState } from "@/features/tools/rules";
import { ActionButton } from "@/features/vehicles/components/ActionButton";
import { requireAnyPerm } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { formatDateKey, formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Tool" };

const day = (k: string | null) =>
  k
    ? formatDateKey(k, "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const DUE_TONE = {
  overdue: "red",
  due: "orange",
  due_soon: "orange",
  ok: "green",
} as const;
const DUE_LABEL = {
  overdue: "Overdue",
  due: "Today",
  due_soon: "Soon",
  ok: "OK",
} as const;

export default async function ToolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyPerm(["tools.view_own", "tools.view_all"]);
  if (!(await isEnabled("tools"))) notFound();
  const { id } = await params;
  const {
    tool: t,
    holderName,
    vehicleName,
    kitName,
    ownerName,
    photos,
  } = await getTool(id);
  const manage = user.perms.has("tools.manage");
  const custodian = t.currentUserId === user.id;
  const owner = t.ownerUserId === user.id;
  const [history, settings, tz, today, custodians, defs, tags] =
    await Promise.all([
      getToolHistory(id),
      getSettings(),
      getCompanyTimezone(),
      todayKey(),
      manage ? listCustodians() : Promise.resolve({ users: [], vehicles: [] }),
      manage || owner ? getCustomFieldDefs("tool") : Promise.resolve([]),
      getEntityTags([{ type: "tool", id }]),
    ]);
  const ts = settings.tools;
  const warn = ts.maintenance_warning_days;
  const cal = dueState(t.calibrationDueOn, today, warn);
  const maint = dueState(t.nextMaintenanceOn, today, warn);
  const block = checkoutBlock(t, today, {
    blockOnCalibration: ts.block_on_calibration_overdue,
    allowReassign: true,
  });
  const canMaintain =
    user.perms.has("tools.maintenance_log") && (manage || custodian || owner);
  const canReport =
    user.perms.has("tools.report_incident") && (manage || custodian || owner);
  const initial: ToolFormValues = {
    id: t.id,
    name: t.name,
    category: t.category,
    brand: t.brand,
    model: t.model,
    serial: t.serial,
    purchaseDate: t.purchaseDate,
    purchaseCostCents: t.purchaseCostCents,
    replacementCostCents: t.replacementCostCents,
    owner: t.owner as ToolFormValues["owner"],
    ownerUserId: t.ownerUserId,
    condition: t.condition as ToolFormValues["condition"],
    calibrationDueOn: t.calibrationDueOn,
    maintenanceIntervalDays: t.maintenanceIntervalDays,
    maintenanceTask: t.maintenanceTask,
    lastMaintainedOn: t.lastMaintainedOn,
    notes: t.notes,
    custom: Object.fromEntries(
      Object.entries((t.custom ?? {}) as Record<string, unknown>).filter(
        ([k]) => !k.startsWith("_"),
      ),
    ),
  };
  const lost = t.status === "lost" || t.status === "stolen";

  return (
    <PageTransition>
      <NavBar
        title={t.name}
        back={{
          href: user.perms.has("tools.view_all")
            ? "/tools"
            : "/tools?scope=mine",
          label: "Tools",
        }}
        trailing={
          manage || owner ? (
            <ToolFormButton
              mode="edit"
              initial={initial}
              manage={manage}
              users={custodians.users}
              customDefs={defs}
              aiEnabled={aiProviderName() !== "none"}
              categories={[]}
            />
          ) : undefined
        }
      />
      <Page wide className="pt-4">
        <div className="flex flex-col gap-[var(--section-gap)]">
          <section
            className="list-card flex items-center gap-4 p-4"
            aria-label="Tool"
          >
            {photos[0]?.thumbUrl ? (
              // biome-ignore lint/performance/noImgElement: signed storage thumbnail
              <img
                src={photos[0].thumbUrl}
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
                <Wrench size={32} />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="truncate text-title2 font-bold">{t.name}</h1>
              <p className="truncate text-subhead text-label-2">
                {[
                  t.assetTag,
                  [t.brand, t.model].filter(Boolean).join(" ") || null,
                  t.serial && `S/N ${t.serial}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill kind="tool" status={t.status} size="sm" />
                <Pill
                  tone={
                    t.condition === "poor"
                      ? "red"
                      : t.condition === "fair"
                        ? "orange"
                        : "green"
                  }
                  size="sm"
                >
                  {t.condition[0]?.toUpperCase()}
                  {t.condition.slice(1)}
                </Pill>
                {t.owner === "tech_owned" && (
                  <Pill tone="indigo" size="sm">
                    Tech-owned{ownerName ? `: ${ownerName}` : ""}
                  </Pill>
                )}
              </div>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            {manage &&
              t.owner === "company" &&
              t.status !== "retired" &&
              !lost &&
              t.status !== "in_repair" && (
                <CheckOutButton
                  tools={[
                    {
                      id: t.id,
                      name: t.name,
                      serial: t.serial,
                      assetTag: t.assetTag,
                      status: t.status,
                      holderName: holderName ?? vehicleName,
                      blocked: block ? BLOCK_LABEL[block] : null,
                    },
                  ]}
                  preselected={block ? [] : [t.id]}
                  users={custodians.users}
                  vehicles={custodians.vehicles}
                  requirePhoto={ts.require_handoff_photo}
                  label={t.status === "assigned" ? "Reassign" : "Check out"}
                />
              )}
            {t.status === "assigned" && (manage || custodian) && (
              <HandoffButton
                toolId={t.id}
                mode="check_in"
                requirePhoto={ts.require_handoff_photo}
                leaveTo={
                  user.perms.has("tools.view_all") || owner
                    ? undefined
                    : "/tools?scope=mine"
                }
              />
            )}
            {manage && t.status === "in_repair" && (
              <HandoffButton toolId={t.id} mode="from_repair" requirePhoto />
            )}
            {manage && t.status === "available" && (
              <ActionButton
                action={setToolStatus}
                input={{ toolId: t.id, status: "in_repair" as const }}
                success="Sent to repair"
              >
                Send to repair
              </ActionButton>
            )}
            {canMaintain && !lost && t.status !== "retired" && (
              <MaintenanceButton
                toolId={t.id}
                defaultTask={t.maintenanceTask}
                today={today}
              />
            )}
            {canReport && !lost && t.status !== "retired" && (
              <IncidentButton toolId={t.id} />
            )}
            {(lost || manage || owner) && (
              <Button
                href={`/tools/${t.id}/theft-report`}
                size="sm"
                variant="gray"
                icon={<FileWarning size={16} aria-hidden />}
              >
                Theft report
              </Button>
            )}
            {manage && t.status !== "retired" && (
              <ActionButton
                action={setToolStatus}
                input={{ toolId: t.id, status: "retired" as const }}
                variant="plain"
                success="Tool retired"
                confirm={{
                  title: `Retire ${t.name}?`,
                  message: "It leaves the active register; history is kept.",
                  label: "Retire",
                  destructive: true,
                }}
              >
                Retire
              </ActionButton>
            )}
          </div>
          {block === "calibration_overdue" && (
            <p className="px-1 text-footnote text-danger">
              Calibration is overdue — check-out is blocked until it’s logged.
            </p>
          )}

          <ListSection header="Details">
            <KeyValueList
              items={[
                {
                  label: "With",
                  value:
                    holderName ??
                    vehicleName ??
                    (t.status === "available" ? "In stock" : "—"),
                },
                ...(kitName ? [{ label: "Kit", value: kitName }] : []),
                { label: "Category", value: t.category ?? "—" },
                { label: "Purchased", value: day(t.purchaseDate) },
                {
                  label: "Purchase cost",
                  value: <MoneyText cents={t.purchaseCostCents} />,
                  numeric: true,
                },
                {
                  label: "Replacement value",
                  value: <MoneyText cents={t.replacementCostCents} />,
                  numeric: true,
                },
                {
                  label: "Calibration due",
                  value: t.calibrationDueOn ? (
                    <span className="flex items-center justify-end gap-1.5">
                      {day(t.calibrationDueOn)}
                      {cal !== "ok" && (
                        <Pill tone={DUE_TONE[cal]} size="sm">
                          {DUE_LABEL[cal]}
                        </Pill>
                      )}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t.maintenanceTask ?? "Maintenance",
                  value: t.nextMaintenanceOn ? (
                    <span className="flex items-center justify-end gap-1.5">
                      {day(t.nextMaintenanceOn)}
                      {maint !== "ok" && (
                        <Pill tone={DUE_TONE[maint]} size="sm">
                          {DUE_LABEL[maint]}
                        </Pill>
                      )}
                    </span>
                  ) : t.maintenanceIntervalDays ? (
                    `Every ${t.maintenanceIntervalDays} days`
                  ) : (
                    "Not scheduled"
                  ),
                },
                ...(t.notes
                  ? [{ label: "Notes", value: t.notes, stacked: true }]
                  : []),
              ]}
            />
          </ListSection>

          {photos.length > 0 && (
            <ListSection header="Photos">
              <div className="p-3">
                <PhotoGrid
                  photos={photos.map((p) => ({ ...p, alt: t.name }))}
                  columns={4}
                />
              </div>
            </ListSection>
          )}

          <ListSection header="Custody history">
            {history.assignments.length === 0 ? (
              <EmptyState compact title="Never checked out" />
            ) : (
              history.assignments.map((a) => (
                <ListRow
                  key={a.id}
                  multiline
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      {a.to}
                      {!a.inAt && (
                        <Pill tone="blue" size="sm">
                          Current
                        </Pill>
                      )}
                      {!a.inAt && !a.ackAt && a.userId && (
                        <Pill tone="orange" size="sm">
                          Not acknowledged
                        </Pill>
                      )}
                    </span>
                  }
                  subtitle={[
                    `Out ${formatDateTime(a.outAt, tz)}${a.outCondition ? ` (${a.outCondition})` : ""}`,
                    a.inAt
                      ? `in ${formatDateTime(a.inAt, tz)}${a.inCondition ? ` (${a.inCondition})` : ""}`
                      : null,
                    a.by ? `by ${a.by}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  detail={
                    a.outPhoto ? (
                      // biome-ignore lint/performance/noImgElement: signed storage thumbnail
                      <img
                        src={a.inPhoto ?? a.outPhoto}
                        alt="At handoff"
                        width={40}
                        height={40}
                        className="size-10 rounded-[8px] object-cover"
                      />
                    ) : undefined
                  }
                />
              ))
            )}
          </ListSection>

          <ListSection header="Maintenance log">
            {history.maintenance.length === 0 ? (
              <EmptyState compact title="No maintenance logged" />
            ) : (
              history.maintenance.map((m) => (
                <ListRow
                  key={m.id}
                  multiline
                  icon={<Wrench size={16} />}
                  iconTone="purple"
                  title={m.task}
                  subtitle={[
                    day(m.performedOn),
                    m.by,
                    m.vendor,
                    m.paidBy === "tech" ? "Tech paid" : null,
                    m.notes,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  detail={
                    m.costCents ? <MoneyText cents={m.costCents} /> : undefined
                  }
                />
              ))
            )}
          </ListSection>

          {history.incidents.length > 0 && (
            <ListSection header="Incidents">
              {history.incidents.map((i) => (
                <ListRow
                  key={i.id}
                  multiline
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Pill tone="red" size="sm">
                        {i.kind}
                      </Pill>
                      {i.decision ? (
                        <Pill tone="gray" size="sm">
                          {i.decision.replace(/_/g, " ")}
                        </Pill>
                      ) : (
                        <Pill tone="orange" size="sm">
                          Pending decision
                        </Pill>
                      )}
                      {i.deducted && (
                        <Pill tone="indigo" size="sm">
                          Deduction pending review
                        </Pill>
                      )}
                    </span>
                  }
                  subtitle={[
                    i.reportedBy,
                    formatDateTime(i.at, tz),
                    i.description,
                    i.policeReportNo && `Police #${i.policeReportNo}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </ListSection>
          )}

          <ListSection header="Tags">
            <div className="p-3">
              <TagEditor
                entityType="tool"
                entityId={t.id}
                initial={tags[t.id] ?? []}
                readOnly={!manage}
              />
            </div>
          </ListSection>

          <section aria-label="History" className="flex flex-col gap-1.5">
            <h2 className="px-4 text-subhead font-semibold text-label-2">
              Activity
            </h2>
            <ActivityTimeline entity={{ type: "tool", id: t.id }} limit={20} />
          </section>
        </div>
      </Page>
    </PageTransition>
  );
}
