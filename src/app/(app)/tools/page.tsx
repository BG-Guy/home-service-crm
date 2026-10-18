import {
  ClipboardCheck,
  PackageCheck,
  QrCode,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiProviderName } from "@/adapters/ai";
import { createItemsFor } from "@/app/(app)/_components/create-items";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { getCustomFieldDefs } from "@/features/settings/api";
import { hasSignature } from "@/features/signatures/api";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { acknowledgeTools, signToolAgreement } from "@/features/tools/actions";
import {
  CheckOutButton,
  DecideIncidentButton,
  KitButton,
  ScheduleAuditButton,
  ToolFormButton,
} from "@/features/tools/components/ToolButtons";
import { ToolRowView } from "@/features/tools/components/ToolRow";
import type { PickTool } from "@/features/tools/contracts";
import {
  listAudits,
  listCustodians,
  listKits,
  listOpenIncidents,
  listTools,
  today as todayKey,
} from "@/features/tools/queries";
import { BLOCK_LABEL, checkoutBlock } from "@/features/tools/rules";
import { ActionButton } from "@/features/vehicles/components/ActionButton";
import { SegmentLinks } from "@/features/vehicles/components/SegmentLinks";
import { requireAnyPerm } from "@/lib/auth/current";
import { getFeatureFlags, getSettings, isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Tools" };

const STATUSES = [
  "available",
  "assigned",
  "in_repair",
  "lost",
  "stolen",
  "retired",
  "all",
] as const;
const short = (k: string) =>
  formatDateKey(k, "en-US", { month: "short", day: "numeric" });
const DEFAULT_AGREEMENT =
  "I received the company tools listed in my custody. I'll use them for company work, keep them secure, report loss, theft or damage right away, and return them when asked or when I leave.";

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPerm(["tools.view_own", "tools.view_all"]);
  if (!(await isEnabled("tools"))) notFound();
  const sp = await searchParams;
  const all = user.perms.has("tools.view_all");
  const manage = user.perms.has("tools.manage");
  const reviewer = user.perms.has("tools.audit_review");
  const scope = all && sp.scope !== "mine" ? "all" : "mine";
  const status =
    typeof sp.status === "string" &&
    (STATUSES as readonly string[]).includes(sp.status)
      ? sp.status
      : null;
  const holder =
    typeof sp.holder === "string" && /^[0-9a-f-]{36}$/i.test(sp.holder)
      ? sp.holder
      : null;

  const [
    settings,
    day,
    toolsList,
    audits,
    incidents,
    kits,
    custodians,
    defs,
    signed,
  ] = await Promise.all([
    getSettings(),
    todayKey(),
    listTools({ scope, status }),
    user.perms.has("tools.audit_submit") || reviewer
      ? listAudits({ scope: scope === "all" && reviewer ? "all" : "mine" })
      : Promise.resolve([]),
    scope === "all" && reviewer ? listOpenIncidents() : Promise.resolve([]),
    scope === "all" && manage ? listKits() : Promise.resolve([]),
    manage ? listCustodians() : Promise.resolve({ users: [], vehicles: [] }),
    getCustomFieldDefs("tool"),
    hasSignature("tool_agreement", user.id),
  ]);
  const list = holder
    ? toolsList.filter((t) => t.holderId === holder)
    : toolsList;
  const ts = settings.tools;
  const mineHeld = list.filter((t) => t.holderId === user.id);
  const unack = mineHeld.filter((t) => t.unacknowledged);
  const categories = [
    ...new Set(
      toolsList.map((t) => t.category).filter((c): c is string => !!c),
    ),
  ].sort();
  const pick: PickTool[] = toolsList
    .filter((t) => t.owner === "company")
    .map((t) => {
      const why = checkoutBlock(
        { status: t.status, calibrationDueOn: t.calibrationDueOn },
        day,
        {
          blockOnCalibration: ts.block_on_calibration_overdue,
          allowReassign: true,
        },
      );
      return {
        id: t.id,
        name: t.name,
        serial: t.serial,
        assetTag: t.assetTag,
        status: t.status,
        holderName: t.holderName ?? t.vehicleName,
        blocked: why ? BLOCK_LABEL[why] : null,
      };
    });
  const formProps = {
    manage,
    users: custodians.users,
    customDefs: defs,
    aiEnabled: aiProviderName() !== "none",
    categories,
  };
  // One "+" in the header (QA T4-11): when the global "+" menu offers New Tool
  // (`/tools?new=tool`), the page keeps only the deep link, not a 2nd "+".
  const inPlusMenu = createItemsFor(user.perms, await getFeatureFlags()).some(
    (i) => i.href.startsWith("/tools?new="),
  );
  const byCategory = new Map<string, typeof list>();
  for (const t of list) {
    const k = t.category ?? "Other";
    byCategory.set(k, [...(byCategory.get(k) ?? []), t]);
  }

  return (
    <PageTransition>
      <LargeTitleHeader
        title={scope === "all" ? "Tools" : "My tools"}
        trailing={
          <div className="flex items-center gap-1">
            <ToolFormButton
              mode="new"
              hideTrigger={inPlusMenu}
              {...formProps}
            />
            <HeaderActions />
          </div>
        }
      />
      <Page wide>
        <div className="flex flex-col gap-[var(--section-gap)]">
          {all && (
            <SegmentLinks
              param="scope"
              value={scope}
              segments={[
                { value: "all", label: "All tools" },
                { value: "mine", label: "Mine" },
              ]}
              label="Which tools"
              clear={["status", "holder"]}
            />
          )}

          {unack.length > 0 && (
            <Banner
              tone="info"
              icon={<PackageCheck size={20} aria-hidden />}
              title={`${unack.length} new tool${unack.length === 1 ? "" : "s"} assigned to you`}
              action={
                <ActionButton
                  action={acknowledgeTools}
                  input={{}}
                  variant="filled"
                  success="Thanks — receipt confirmed"
                >
                  I have received these tools
                </ActionButton>
              }
            >
              {unack.map((t) => t.name).join(", ")}
            </Banner>
          )}

          {scope === "mine" && mineHeld.length > 0 && !signed && (
            <Banner
              tone="legal"
              title="Tool agreement"
              action={
                <SignatureSheet
                  title="Tool agreement"
                  docType="tool_agreement"
                  consentText={ts.agreement_text ?? DEFAULT_AGREEMENT}
                  summaryLines={mineHeld.map(
                    (t) => `${t.name}${t.serial ? ` (S/N ${t.serial})` : ""}`,
                  )}
                  signerNameDefault={user.name}
                  action={signToolAgreement}
                  triggerLabel="Review and sign"
                />
              }
            >
              Please review and sign the agreement for the company tools in your
              custody.
            </Banner>
          )}

          {incidents.length > 0 && (
            <ListSection header="Needs a decision">
              {incidents.map((i) => (
                <div
                  key={i.id}
                  className="list-row flex items-center gap-3 px-4 py-3"
                >
                  <ShieldAlert
                    aria-hidden
                    size={20}
                    className="shrink-0 text-danger"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body">
                      {i.toolName}{" "}
                      <Pill tone="red" size="sm">
                        {i.kind}
                      </Pill>
                    </p>
                    <p className="truncate text-footnote text-label-2">
                      {[i.reportedBy, i.description]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <DecideIncidentButton
                    incidentId={i.id}
                    defaultAmountCents={
                      toolsList.find((t) => t.id === i.toolId)
                        ?.replacementCostCents ?? null
                    }
                    deductionsEnabled={ts.deductions_enabled}
                  />
                </div>
              ))}
            </ListSection>
          )}

          {(audits.length > 0 || (scope === "all" && reviewer)) && (
            <ListSection
              header="Tool checks"
              trailing={
                scope === "all" && reviewer ? (
                  <ScheduleAuditButton users={custodians.users} today={day} />
                ) : undefined
              }
            >
              {audits.length === 0 ? (
                <EmptyState
                  compact
                  title="No tool checks"
                  message={`They’re scheduled every ${ts.audit_frequency_days} days for techs with company tools.`}
                />
              ) : (
                audits.slice(0, 8).map((a) => (
                  <ListRow
                    key={a.id}
                    href={`/tools/audits/${a.id}`}
                    icon={<ClipboardCheck size={16} />}
                    iconTone={
                      a.overdue
                        ? "red"
                        : a.status === "submitted"
                          ? "blue"
                          : "orange"
                    }
                    title={scope === "all" ? a.userName : "Tool check"}
                    subtitle={`${a.items} tool${a.items === 1 ? "" : "s"}${a.missing ? ` · ${a.missing} missing` : ""} · due ${short(a.dueOn)}`}
                    detail={
                      a.overdue ? (
                        <Pill tone="red" size="sm">
                          Overdue
                        </Pill>
                      ) : (
                        <StatusPill
                          kind="toolAudit"
                          status={a.status}
                          size="sm"
                        />
                      )
                    }
                  />
                ))
              )}
            </ListSection>
          )}

          {scope === "all" && manage && (
            <ListSection
              header="Kits"
              trailing={
                <KitButton
                  kit={null}
                  tools={pick}
                  users={custodians.users}
                  vehicles={custodians.vehicles}
                  requirePhoto={ts.require_handoff_photo}
                />
              }
            >
              {kits.length === 0 ? (
                <EmptyState
                  compact
                  title="No kits"
                  message="Group tools into a kit to assign them to a van or tech in one step."
                />
              ) : (
                kits.map((k) => (
                  <KitButton
                    key={k.id}
                    kit={{
                      id: k.id,
                      name: k.name,
                      vehicleId: k.vehicleId,
                      userId: k.userId,
                      toolIds: toolsList
                        .filter((t) => t.kitName === k.name)
                        .map((t) => t.id),
                    }}
                    tools={pick}
                    users={custodians.users}
                    vehicles={custodians.vehicles}
                    requirePhoto={ts.require_handoff_photo}
                  >
                    <ListRow
                      icon={<Wrench size={16} />}
                      iconTone="indigo"
                      title={k.name}
                      subtitle={[
                        `${k.tools} tool${k.tools === 1 ? "" : "s"}`,
                        k.vehicleName,
                        k.userName,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      accessory="chevron"
                    />
                  </KitButton>
                ))
              )}
            </ListSection>
          )}

          <div className="flex flex-col gap-2">
            <ChipRow label="Status">
              <Chip href={`/tools?scope=${scope}`} selected={!status} replace>
                Active
              </Chip>
              {STATUSES.map((s) => (
                <Chip
                  key={s}
                  href={`/tools?scope=${scope}&status=${s}`}
                  selected={status === s}
                  replace
                >
                  {s === "all"
                    ? "All"
                    : s
                        .replace("_", " ")
                        .replace(/^\w/, (c) => c.toUpperCase())}
                </Chip>
              ))}
            </ChipRow>
            {manage && scope === "all" && (
              <div className="flex flex-wrap gap-2">
                <CheckOutButton
                  tools={pick}
                  users={custodians.users}
                  vehicles={custodians.vehicles}
                  requirePhoto={ts.require_handoff_photo}
                />
                <ChipRow label="More">
                  <Chip
                    href="/tools/labels"
                    icon={<QrCode size={14} aria-hidden />}
                  >
                    Print QR labels
                  </Chip>
                </ChipRow>
              </div>
            )}
          </div>

          {list.length === 0 ? (
            <div className="list-card">
              <EmptyState
                icon={<Wrench size={44} strokeWidth={1.5} />}
                title={
                  scope === "mine"
                    ? "No tools in your custody"
                    : "No tools here"
                }
                message={
                  scope === "mine"
                    ? "Company tools assigned to you show up here. You can also register your own tools for theft and insurance records."
                    : "Add your tools with a photo of each so they're ready for check-out, audits and theft reports."
                }
                action={<ToolFormButton mode="new-inline" {...formProps} />}
              />
            </div>
          ) : (
            [...byCategory.entries()].map(([cat, items]) => (
              <ListSection key={cat} header={`${cat} · ${items.length}`}>
                {items.map((t) => (
                  <ToolRowView key={t.id} t={t} showHolder={scope === "all"} />
                ))}
              </ListSection>
            ))
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
