import "server-only";
import {
  ClipboardCheck,
  FileText,
  Fuel,
  Gauge,
  Route,
  ShieldAlert,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { ActivityTimeline } from "@/features/notify/slots";
import { getEntityTags } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { personHref } from "@/lib/links";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { formatDate, formatDateKey, formatDateTime } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { PhotoGrid } from "@/ui/components/PhotoGrid";
import { StatCard } from "@/ui/components/StatCard";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { refreshRecalls } from "../actions";
import { aiEnabled, type VehicleRow } from "../engine";
import {
  getMaintenanceSuggestion,
  getVehicleStats,
  listDocuments,
  listIssues,
  listReminderRules,
  listServiceRecords,
  listTrips,
  listVehicleLogs,
  recallsOf,
} from "../queries";
import { ANOMALY_LABELS, DOCUMENT_TASKS, docKindLabel } from "../rules";
import { ActionButton } from "./ActionButton";
import { Elapsed } from "./Elapsed";
import { IssueActions } from "./IssueActions";
import { MaintenanceSuggest } from "./MaintenanceSuggest";
import { ReminderRuleButton } from "./ReminderRuleButton";
import { TripButton } from "./TripSheet";

// Server-rendered tab bodies for /vehicles/[id] (SPEC M17). Each loads its own data.

const num = new Intl.NumberFormat("en-US");
const OWNERSHIP: Record<string, string> = {
  company_owned: "Company owned",
  leased: "Leased",
  tech_owned: "Tech owned (mileage reimbursed)",
};

function ApprovalChip({
  status,
  inReview,
}: {
  status: "pending" | "approved" | "rejected";
  inReview?: boolean;
}) {
  if (status === "approved") return null;
  if (status === "rejected")
    return (
      <Pill tone="red" size="sm">
        Rejected
      </Pill>
    );
  return (
    <Pill tone={inReview ? "blue" : "gray"} size="sm">
      {inReview ? "In review" : "Pending"}
    </Pill>
  );
}

function Thumb({
  url,
  full,
  label,
}: {
  url: string | null;
  full?: string | null;
  label: string;
}) {
  if (!url) return null;
  return (
    <a
      href={full ?? url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${label} photo`}
      className="shrink-0"
    >
      {/* biome-ignore lint/performance/noImgElement: signed storage thumbnail */}
      <img
        src={url}
        alt=""
        width={44}
        height={44}
        loading="lazy"
        decoding="async"
        className="size-11 rounded-[10px] object-cover"
      />
    </a>
  );
}

// ------------------------------------------------------------------ overview

export async function OverviewTab({
  v,
  assigneeName,
  photos,
  user,
}: {
  v: VehicleRow;
  assigneeName: string | null;
  photos: { id: string; thumbUrl: string; url: string }[];
  user: SessionUser;
}) {
  const manage = user.perms.has("vehicles.manage");
  const [stats, rules, suggestion, tags] = await Promise.all([
    getVehicleStats(v.id),
    listReminderRules(v.id),
    manage && aiEnabled() ? getMaintenanceSuggestion(v.id) : null,
    getEntityTags([{ type: "vehicle", id: v.id }]),
  ]);
  const recalls = recallsOf(v);
  const custom = Object.entries(
    (v.custom ?? {}) as Record<string, unknown>,
  ).filter(([k, val]) => !k.startsWith("_") && val != null && val !== "");
  const heavy = (v.gvwrLbs ?? 0) >= 10_001;
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Cost / mile"
          icon={<Gauge size={16} aria-hidden />}
          value={
            stats.costPerMileCents != null ? (
              <MoneyText cents={stats.costPerMileCents} />
            ) : (
              "—"
            )
          }
          footnote="Last 90 days"
        />
        <StatCard
          label="Avg MPG"
          icon={<Fuel size={16} aria-hidden />}
          value={stats.avgMpg ?? "—"}
          footnote={`${num.format(stats.miles)} mi driven`}
        />
        <StatCard
          label="Fuel spend"
          icon={<Fuel size={16} aria-hidden />}
          value={<MoneyText cents={stats.fuelCents} compactWhole />}
          footnote="Last 90 days"
        />
        <StatCard
          label="Service spend"
          icon={<Wrench size={16} aria-hidden />}
          value={<MoneyText cents={stats.serviceCents} compactWhole />}
          footnote="Last 90 days"
        />
      </div>

      <ListSection
        header="Reminders"
        trailing={manage ? <ReminderRuleButton vehicleId={v.id} /> : undefined}
      >
        {rules.length === 0 ? (
          <EmptyState
            compact
            title="No reminders"
            message="Add oil changes, rotations and inspections."
          />
        ) : (
          rules.map((r) => {
            const due = [
              r.nextDueOn
                ? `by ${formatDateKey(r.nextDueOn, "en-US", { month: "short", day: "numeric", year: "numeric" })}`
                : null,
              r.nextDueMiles != null
                ? `at ${num.format(r.nextDueMiles)} mi`
                : null,
            ]
              .filter(Boolean)
              .join(" or ");
            const row = (
              <ListRow
                key={r.id}
                icon={<Wrench size={16} />}
                iconTone={
                  r.status === "overdue"
                    ? "red"
                    : r.status === "due_soon"
                      ? "orange"
                      : "gray"
                }
                title={r.label}
                subtitle={
                  r.task === "recall"
                    ? `${recalls.length} open recall${recalls.length === 1 ? "" : "s"}`
                    : due
                      ? `Due ${due}`
                      : !r.active
                        ? "Paused"
                        : DOCUMENT_TASKS.includes(r.task)
                          ? "No document on file yet"
                          : "No service logged yet"
                }
                detail={
                  // Nothing to forecast yet: no "OK" next to a missing record (QA T3-23).
                  !due && r.task !== "recall" && r.status === "ok" ? (
                    DOCUMENT_TASKS.includes(r.task) && r.active ? (
                      <Pill tone="orange" size="sm">
                        Missing
                      </Pill>
                    ) : undefined
                  ) : (
                    <StatusPill
                      kind="vehicleReminder"
                      status={r.status}
                      size="sm"
                    />
                  )
                }
                accessory={manage ? "chevron" : "none"}
              />
            );
            return manage && r.task !== "recall" ? (
              <ReminderRuleButton key={r.id} vehicleId={v.id} rule={r}>
                {row}
              </ReminderRuleButton>
            ) : (
              <div key={r.id}>{row}</div>
            );
          })
        )}
      </ListSection>

      {recalls.length > 0 && (
        <ListSection
          header="Open recalls (NHTSA)"
          footer="Book the free dealer repair, then log it as a service with the campaign number."
        >
          {recalls.map((r) => (
            <ListRow
              key={r.campaign}
              icon={<ShieldAlert size={16} />}
              iconTone="red"
              multiline
              title={r.component ?? r.campaign}
              subtitle={[r.campaign, r.summary].filter(Boolean).join(" · ")}
            />
          ))}
        </ListSection>
      )}

      {manage && aiEnabled() && (
        <ListSection header="Maintenance assistant">
          <MaintenanceSuggest vehicleId={v.id} initial={suggestion} />
        </ListSection>
      )}

      <ListSection
        header="Details"
        trailing={
          manage && v.year && v.make && v.model ? (
            <ActionButton
              action={refreshRecalls}
              input={{ vehicleId: v.id }}
              variant="plain"
              success="Checking NHTSA recalls — results appear shortly"
            >
              Check recalls
            </ActionButton>
          ) : undefined
        }
      >
        <KeyValueList
          items={[
            {
              label: "Assigned to",
              value: assigneeName ?? "Unassigned",
              href: assigneeName
                ? (personHref(user, v.assignedUserId) ?? undefined)
                : undefined,
            },
            {
              label: "Odometer",
              value:
                v.odometerCached != null
                  ? `${num.format(v.odometerCached)} mi`
                  : "—",
              numeric: true,
            },
            ...(v.avgDailyMiles
              ? [
                  {
                    label: "Average",
                    value: `${v.avgDailyMiles} mi/day`,
                    numeric: true,
                  },
                ]
              : []),
            {
              label: "Ownership",
              value: OWNERSHIP[v.ownership] ?? v.ownership,
            },
            {
              label: "Plate",
              value: v.plate
                ? `${v.plate}${v.plateState ? ` (${v.plateState})` : ""}`
                : "—",
            },
            { label: "VIN", value: v.vin ?? "—" },
            ...(v.engine ? [{ label: "Engine", value: v.engine }] : []),
            ...(v.fuelType ? [{ label: "Fuel", value: v.fuelType }] : []),
            ...(v.tankGal
              ? [{ label: "Tank", value: `${v.tankGal} gal`, numeric: true }]
              : []),
            ...(v.gvwrLbs
              ? [
                  {
                    label: "GVWR",
                    value: `${num.format(v.gvwrLbs)} lb`,
                    numeric: true,
                  },
                ]
              : []),
            ...(heavy
              ? [{ label: "USDOT #", value: v.usdotNumber ?? "Missing" }]
              : []),
            ...custom.map(([k, val]) => ({
              label: k
                .replace(/_/g, " ")
                .replace(/^\w/, (c) => c.toUpperCase()),
              value: Array.isArray(val) ? val.join(", ") : String(val),
            })),
          ]}
        />
      </ListSection>

      {photos.length > 0 && (
        <ListSection header="Photos">
          <div className="p-3">
            <PhotoGrid
              photos={photos.map((p) => ({ ...p, alt: v.nickname }))}
              columns={3}
            />
          </div>
        </ListSection>
      )}

      <ListSection header="Tags">
        <div className="p-3">
          <TagEditor
            entityType="vehicle"
            entityId={v.id}
            initial={tags[v.id] ?? []}
            readOnly={!manage}
          />
        </div>
      </ListSection>

      <section aria-label="History" className="flex flex-col gap-1.5">
        <h2 className="px-4 text-footnote uppercase text-label-2">History</h2>
        <ActivityTimeline entity={{ type: "vehicle", id: v.id }} limit={20} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ logs

export async function LogsTab({ vehicleId }: { vehicleId: string }) {
  const [logs, tz] = await Promise.all([
    listVehicleLogs(vehicleId),
    getCompanyTimezone(),
  ]);
  if (logs.length === 0)
    return (
      <div className="list-card">
        <EmptyState
          icon={<Gauge size={40} strokeWidth={1.5} />}
          title="No logs yet"
          message="Odometer readings, fuel fills and inspections show up here."
        />
      </div>
    );
  const ICON = {
    odometer: Gauge,
    fuel: Fuel,
    inspection: ClipboardCheck,
  } as const;
  const TONE = {
    odometer: "blue",
    fuel: "green",
    inspection: "indigo",
  } as const;
  return (
    <ListSection header="Odometer, fuel and inspections">
      {logs.map((l) => {
        const Icon = ICON[l.type];
        return (
          <ListRow
            key={`${l.type}-${l.id}`}
            multiline
            icon={<Icon size={16} />}
            iconTone={TONE[l.type]}
            title={
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="num">{l.title}</span>
                <ApprovalChip status={l.status} inReview={l.inReview} />
                {l.flags.map((f) => (
                  <Pill key={f} tone="red" size="sm">
                    {ANOMALY_LABELS[f] ?? f}
                  </Pill>
                ))}
              </span>
            }
            subtitle={[l.subtitle, l.by, formatDateTime(l.at, tz)]
              .filter(Boolean)
              .join(" · ")}
            detail={<Thumb url={l.thumbUrl} full={l.fullUrl} label={l.type} />}
          />
        );
      })}
    </ListSection>
  );
}

// ------------------------------------------------------------------ service

export async function ServiceTab({
  vehicleId,
  manage,
}: {
  vehicleId: string;
  manage: boolean;
}) {
  const [records, rules] = await Promise.all([
    listServiceRecords(vehicleId),
    manage ? listReminderRules(vehicleId) : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {records.length === 0 ? (
        <div className="list-card">
          <EmptyState
            icon={<Wrench size={40} strokeWidth={1.5} />}
            title="No service records"
            message="Log oil changes, rotations and repairs with the shop invoice. Approved records reset their reminders."
          />
        </div>
      ) : (
        <ListSection header="Service history">
          {records.map((r) => (
            <ListRow
              key={r.id}
              multiline
              icon={<Wrench size={16} />}
              iconTone="purple"
              title={
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.taskLabels.join(", ")}
                  <ApprovalChip status={r.status} inReview={r.inReview} />
                  {r.paidBy === "tech" && (
                    <Pill tone="indigo" size="sm">
                      Tech paid
                    </Pill>
                  )}
                </span>
              }
              subtitle={[
                formatDateKey(r.performedOn, "en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }),
                r.odometer != null ? `${num.format(r.odometer)} mi` : null,
                r.vendor,
                r.aiTasks.length
                  ? `AI read: ${r.aiTasks.join(", ").replace(/_/g, " ")}`
                  : null,
                r.notes,
              ]
                .filter(Boolean)
                .join(" · ")}
              detail={
                <span className="flex items-center gap-2">
                  {r.costCents != null && <MoneyText cents={r.costCents} />}
                  {r.receiptUrl && (
                    <a
                      href={r.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text"
                      aria-label="Open receipt"
                    >
                      <FileText size={18} aria-hidden />
                    </a>
                  )}
                </span>
              }
            />
          ))}
        </ListSection>
      )}
      {manage && rules.length > 0 && (
        <ListSection
          header="Reminder rules"
          trailing={<ReminderRuleButton vehicleId={vehicleId} />}
          footer="Rules reset only from approved service records."
        >
          {rules
            .filter((r) => r.task !== "recall")
            .map((r) => (
              <ReminderRuleButton key={r.id} vehicleId={vehicleId} rule={r}>
                <ListRow
                  title={r.label}
                  subtitle={
                    [
                      r.intervalMiles
                        ? `every ${num.format(r.intervalMiles)} mi`
                        : null,
                      r.intervalDays ? `every ${r.intervalDays} days` : null,
                    ]
                      .filter(Boolean)
                      .join(" or ") || "Expiry date"
                  }
                  detail={
                    r.lastDoneOn
                      ? `Last ${formatDateKey(r.lastDoneOn, "en-US", { month: "short", day: "numeric" })}`
                      : undefined
                  }
                  accessory="chevron"
                />
              </ReminderRuleButton>
            ))}
        </ListSection>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ docs

export async function DocsTab({
  vehicleId,
  canAdd = false,
}: {
  vehicleId: string;
  /** Viewer may add documents (opens the sheet via `?log=document`). */
  canAdd?: boolean;
}) {
  const docs = await listDocuments(vehicleId);
  const tz = await getCompanyTimezone();
  const add = canAdd ? (
    <Button
      href="?tab=docs&log=document"
      transition="none"
      prefetch={false}
      size="sm"
      variant="tinted"
    >
      Add document
    </Button>
  ) : undefined;
  if (docs.length === 0)
    return (
      <div className="list-card">
        <EmptyState
          icon={<FileText size={40} strokeWidth={1.5} />}
          title="No documents"
          message="Add the registration and insurance card. You’ll get reminders 30, 14 and 3 days before they expire."
          action={add}
        />
      </div>
    );
  const today = formatDate(new Date(), tz);
  return (
    <ListSection
      header="Documents"
      trailing={add}
      footer={`Today is ${today}.`}
    >
      {docs.map((d) => (
        // No row link: the thumbnail (or "Open") is the only <a>, a plain
        // anchor so the signed file URL is never prefetched (QA T3-08).
        <ListRow
          key={d.id}
          multiline
          icon={<FileText size={16} />}
          iconTone={d.expired ? "red" : "blue"}
          title={
            <span className="flex flex-wrap items-center gap-1.5">
              {docKindLabel(d.kind)}
              <ApprovalChip status={d.status} inReview={d.inReview} />
              {d.expired && (
                <Pill tone="red" size="sm">
                  Expired
                </Pill>
              )}
            </span>
          }
          subtitle={[
            d.expiresOn
              ? `Expires ${formatDateKey(d.expiresOn, "en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : "No expiry",
            d.notes,
          ]
            .filter(Boolean)
            .join(" · ")}
          detail={
            d.thumbUrl ? (
              <Thumb
                url={d.thumbUrl}
                full={d.url}
                label={docKindLabel(d.kind)}
              />
            ) : d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="text-subhead text-accent-text"
                aria-label={`Open ${docKindLabel(d.kind)}`}
              >
                Open
              </a>
            ) : undefined
          }
        />
      ))}
    </ListSection>
  );
}

// ------------------------------------------------------------------ issues

export async function IssuesTab({
  vehicleId,
  manage,
}: {
  vehicleId: string;
  manage: boolean;
}) {
  const [issues, tz, settings] = await Promise.all([
    listIssues(vehicleId),
    getCompanyTimezone(),
    getSettings(),
  ]);
  if (issues.length === 0)
    return (
      <div className="list-card">
        <EmptyState
          icon={<TriangleAlert size={40} strokeWidth={1.5} />}
          title="No issues reported"
          message="Warning lights, noises or damage reported by the driver show up here."
        />
      </div>
    );
  const target = settings.vehicles.issue_ack_target_minutes;
  const SEV_TONE = {
    low: "gray",
    medium: "orange",
    high: "red",
    unsafe: "red",
  } as const;
  return (
    <ListSection header="Issues">
      {issues.map((i) => (
        <div key={i.id} className="list-row flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill kind="vehicleIssue" status={i.status} size="sm" />
            <Pill tone={SEV_TONE[i.severity]} size="sm">
              {i.severity === "unsafe"
                ? "Unsafe"
                : `${i.severity[0]?.toUpperCase()}${i.severity.slice(1)}`}
            </Pill>
            {!i.canDrive && (
              <Pill tone="red" size="sm">
                Not drivable
              </Pill>
            )}
            {i.status === "open" && (
              <Elapsed
                since={i.createdAt}
                targetMinutes={target}
                prefix="Unacknowledged"
              />
            )}
          </div>
          <p className="text-body">{i.description}</p>
          {i.photos.length > 0 && (
            <PhotoGrid
              photos={i.photos.map((p) => ({ ...p, alt: "Issue photo" }))}
              columns={4}
            />
          )}
          <p className="text-footnote text-label-2">
            {[
              i.reportedBy ? `Reported by ${i.reportedBy}` : "Reported",
              formatDateTime(i.createdAt, tz),
              i.acknowledgedBy ? `acknowledged by ${i.acknowledgedBy}` : null,
              i.resolvedAt
                ? `resolved ${formatDateTime(i.resolvedAt, tz)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {i.resolution && (
            <p className="text-subhead text-label-2">Fix: {i.resolution}</p>
          )}
          {manage && <IssueActions issueId={i.id} status={i.status} />}
        </div>
      ))}
    </ListSection>
  );
}

// ------------------------------------------------------------------ trips

export async function TripsTab({
  v,
  user,
  canLog,
}: {
  v: VehicleRow;
  user: SessionUser;
  canLog: boolean;
}) {
  const trips = await listTrips(v.id);
  const reimbursable = v.ownership === "tech_owned";
  const totals = trips.reduce(
    (a, t) => {
      if (t.status !== "rejected") a[t.classification] += t.miles;
      return a;
    },
    { business: 0, commute: 0, personal: 0 },
  );
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Business"
          value={`${num.format(totals.business)} mi`}
        />
        <StatCard label="Commute" value={`${num.format(totals.commute)} mi`} />
        <StatCard
          label="Personal"
          value={`${num.format(totals.personal)} mi`}
        />
      </div>
      <ListSection
        header="Mileage log (IRS Pub 463)"
        trailing={
          canLog ? (
            <TripButton vehicleId={v.id} reimbursable={reimbursable} />
          ) : undefined
        }
        footer={
          reimbursable
            ? "Tech-owned vehicle: approved business trips are reimbursed at the IRS mileage rate on the next statement."
            : "Trips are drafted automatically when the driver clocks out."
        }
      >
        {trips.length === 0 ? (
          <EmptyState
            compact
            icon={<Route size={32} strokeWidth={1.5} />}
            title="No trips yet"
            message="A trip is drafted from the clock-in and clock-out odometers and the day's job stops."
          />
        ) : (
          trips.map((t) => {
            const mine =
              t.userId === user.id || user.perms.has("vehicles.manage");
            return (
              <div
                key={t.id}
                className="list-row flex items-start gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-body">
                    <span className="num font-medium">
                      {num.format(t.miles)} mi
                    </span>
                    <span className="text-label-2">
                      {formatDateKey(t.tripDate, "en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <Pill
                      tone={t.classification === "business" ? "blue" : "gray"}
                      size="sm"
                    >
                      {t.classification}
                    </Pill>
                    {t.draft ? (
                      <Pill tone="orange" size="sm">
                        Draft
                      </Pill>
                    ) : (
                      <ApprovalChip status={t.status} inReview={t.inReview} />
                    )}
                    {t.hasLedger && (
                      <Pill tone="green" size="sm">
                        Reimbursed
                      </Pill>
                    )}
                  </p>
                  <p className="text-footnote text-label-2">
                    {[
                      user.perms.has("vehicles.view_all") ? t.userName : null,
                      t.startOdometer != null && t.endOdometer != null
                        ? `${num.format(t.startOdometer)} → ${num.format(t.endOdometer)}`
                        : null,
                      t.purpose,
                      t.destinations.length
                        ? `${t.destinations.length} stop${t.destinations.length === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canLog && mine && t.status === "pending" && !t.inReview && (
                  <TripButton
                    vehicleId={v.id}
                    reimbursable={reimbursable}
                    label={t.draft ? "Review" : "Edit"}
                    trip={{
                      id: t.id,
                      tripDate: t.tripDate,
                      startOdometer: t.startOdometer,
                      endOdometer: t.endOdometer,
                      miles: t.miles,
                      purpose: t.purpose,
                      classification: t.classification,
                    }}
                  />
                )}
              </div>
            );
          })
        )}
      </ListSection>
    </div>
  );
}
