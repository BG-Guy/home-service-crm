"use client";

import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { type ReactNode, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { Stepper } from "@/ui/components/Stepper";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { Toggle, ToggleRow } from "@/ui/components/Toggle";
import { saveServiceTypeAction, setServiceTypeActiveAction } from "../actions";
import { SERVICE_ICONS, SWATCHES } from "../options";
import { ColorSwatches } from "./ColorSwatches";
import {
  FieldCard,
  FMoney,
  FormErrors,
  FSelect,
  FText,
  useActionForm,
} from "./form";

export interface ServiceTypeItem {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  aliases: string[];
  defaultDurationMin: number;
  defaultPriceCents: number | null;
  contractKind: "repair" | "improvement";
  checklistTemplateId: string | null;
  photosRequiredBefore: number;
  photosRequiredAfter: number;
  photosOnInvoice: boolean;
  requiresSignedEstimate: boolean;
  requiresOwnershipCheck: boolean;
  upsellCovered: boolean;
  warrantyDays: number;
  maintenanceIntervalMonths: number | null;
  sort: number;
  active: boolean;
}

function duration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export function ServiceTypesManager({
  items,
  checklists,
  icons,
}: {
  items: ServiceTypeItem[];
  checklists: { id: string; name: string }[];
  /** Pre-rendered icon nodes by key (server keeps the icon map out of the bundle). */
  icons: Record<string, ReactNode>;
}) {
  const [editing, setEditing] = useState<ServiceTypeItem | "new" | null>(null);
  const [, start] = useTransition();
  const active = items.filter((i) => i.active);
  const archived = items.filter((i) => !i.active);

  const setActive = (it: ServiceTypeItem, on: boolean) =>
    start(async () => {
      const r = await setServiceTypeActiveAction({ id: it.id, active: on });
      if (r.ok)
        toast({
          title: on ? `${it.name} restored` : `${it.name} archived`,
          undo: () =>
            void setServiceTypeActiveAction({ id: it.id, active: !on }),
        });
      else toast.error(r.error);
    });

  const row = (it: ServiceTypeItem) => (
    <ListRow
      leading={
        <span
          aria-hidden
          className="flex size-[29px] shrink-0 items-center justify-center rounded-[7px] text-white"
          style={{ background: it.color ?? "var(--sys-gray)" }}
        >
          {icons[it.icon ?? ""] ?? icons.clipboard}
        </span>
      }
      sepInset={60}
      title={it.name}
      subtitle={[
        duration(it.defaultDurationMin),
        it.defaultPriceCents != null ? formatMoney(it.defaultPriceCents) : null,
        it.requiresOwnershipCheck ? "ID check" : null,
        it.photosRequiredBefore + it.photosRequiredAfter > 0
          ? `${it.photosRequiredBefore}+${it.photosRequiredAfter} photos`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      detail={
        it.contractKind === "improvement" ? (
          <Pill tone="orange" size="sm">
            Improvement
          </Pill>
        ) : undefined
      }
      onClick={() => setEditing(it)}
      accessory="chevron"
    />
  );

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex justify-end">
        <Button
          variant="tinted"
          size="sm"
          icon={<Plus aria-hidden size={16} />}
          onClick={() => setEditing("new")}
        >
          New service type
        </Button>
      </div>
      {active.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            title="No service types yet"
            message="Service types set default durations, prices, photo rules and checklists for jobs."
            action={
              <Button onClick={() => setEditing("new")}>
                Add service type
              </Button>
            }
          />
        </div>
      ) : (
        <ListSection
          header="Active"
          footer="Swipe left to archive. Archived types stay on old jobs but can't be picked for new ones."
        >
          {active.map((it) => (
            <SwipeActions
              key={it.id}
              trailing={[
                {
                  label: "Archive",
                  icon: <Archive aria-hidden size={18} />,
                  tone: "orange",
                  onAction: () => setActive(it, false),
                },
              ]}
            >
              {row(it)}
            </SwipeActions>
          ))}
        </ListSection>
      )}
      {archived.length > 0 && (
        <ListSection header="Archived">
          {archived.map((it) => (
            <SwipeActions
              key={it.id}
              trailing={[
                {
                  label: "Restore",
                  icon: <ArchiveRestore aria-hidden size={18} />,
                  tone: "green",
                  onAction: () => setActive(it, true),
                },
              ]}
            >
              <div className="opacity-60">{row(it)}</div>
            </SwipeActions>
          ))}
        </ListSection>
      )}
      {editing && (
        <ServiceTypeSheet
          item={editing === "new" ? null : editing}
          checklists={checklists}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ServiceTypeSheet({
  item,
  checklists,
  onClose,
}: {
  item: ServiceTypeItem | null;
  checklists: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [kind, setKind] = useState<"repair" | "improvement">(
    item?.contractKind ?? "repair",
  );
  const f = useActionForm(saveServiceTypeAction, {
    success: item ? "Service type saved" : "Service type added",
    onSuccess: () => {
      setDirty(false);
      setOpen(false);
    },
  });
  const it = item;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      dirty={dirty}
      title={it ? it.name : "New service type"}
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          type="submit"
          form={f.id}
          loading={f.pending}
          className="font-semibold"
        >
          Save
        </Button>
      }
    >
      <FormErrors errors={f.errors}>
        <form
          {...f.formProps}
          onChange={() => setDirty(true)}
          className="flex flex-col gap-6"
        >
          {it && <input type="hidden" name="id" value={it.id} />}
          <input type="hidden" name="contractKind" value={kind} />
          <FieldCard>
            <FText
              name="name"
              label="Name"
              defaultValue={it?.name}
              required
              autoFocus={!it}
              placeholder="Lockout"
            />
            <ColorSwatches
              label="Color"
              name="color"
              defaultValue={(it?.color ?? "#007aff").toLowerCase()}
              options={SWATCHES.map((s) => ({
                value: s.hex.toLowerCase(),
                name: s.name,
              }))}
            />
            <FSelect
              name="icon"
              label="Icon"
              defaultValue={it?.icon ?? "tools"}
              options={SERVICE_ICONS}
            />
            <FText
              name="aliases"
              label="Also known as"
              defaultValue={it?.aliases.join(", ")}
              placeholder="locked out, lockout, can't get in"
              hint="Words customers use. Lead forms match them to this type."
            />
          </FieldCard>

          <FieldCard header="Defaults">
            <div className="grid grid-cols-2 gap-4">
              <FText
                name="defaultDurationMin"
                label="Duration (min)"
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                defaultValue={String(it?.defaultDurationMin ?? 60)}
              />
              <FMoney
                name="defaultPriceCents"
                label="Default price"
                defaultCents={it?.defaultPriceCents ?? null}
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FText
                name="warrantyDays"
                label="Warranty (days)"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={String(it?.warrantyDays ?? 30)}
              />
              <FText
                name="maintenanceIntervalMonths"
                label="Maintenance every (months)"
                type="number"
                inputMode="numeric"
                min={1}
                defaultValue={
                  it?.maintenanceIntervalMonths != null
                    ? String(it.maintenanceIntervalMonths)
                    : ""
                }
                placeholder="—"
              />
            </div>
            <FSelect
              name="checklistTemplateId"
              label="Checklist"
              defaultValue={it?.checklistTemplateId ?? ""}
              placeholder="None"
              options={checklists.map((c) => ({ value: c.id, label: c.name }))}
              hint="Techs complete it before finishing the job."
            />
          </FieldCard>

          <section>
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              Photos
            </h2>
            <div className="rounded-card bg-card">
              <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-body">Required before</span>
                <Stepper
                  name="photosRequiredBefore"
                  label="Photos required before"
                  defaultValue={it?.photosRequiredBefore ?? 0}
                  min={0}
                  max={20}
                />
              </div>
              <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-body">Required after</span>
                <Stepper
                  name="photosRequiredAfter"
                  label="Photos required after"
                  defaultValue={it?.photosRequiredAfter ?? 0}
                  min={0}
                  max={20}
                />
              </div>
              <ToggleRow
                title="Include photos on the invoice"
                name="photosOnInvoice"
                defaultChecked={it?.photosOnInvoice ?? true}
              />
            </div>
          </section>

          <section>
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              Requirements
            </h2>
            <div className="rounded-card bg-card">
              <ToggleRow
                title="Signed estimate before work"
                name="requiresSignedEstimate"
                defaultChecked={it?.requiresSignedEstimate ?? false}
              />
              <ToggleRow
                title="Ownership check"
                subtitle="ID and proof of address before opening a lock or door."
                name="requiresOwnershipCheck"
                defaultChecked={it?.requiresOwnershipCheck ?? false}
              />
            </div>
          </section>

          <section>
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              Contract type ⚖️
            </h2>
            <div className="flex flex-col gap-3 rounded-card bg-card p-4">
              <SegmentedControl
                label="Contract type"
                value={kind}
                onChange={(v) => {
                  setKind(v);
                  setDirty(true);
                }}
                segments={[
                  { value: "repair", label: "Repair" },
                  { value: "improvement", label: "Home improvement" },
                ]}
              />
              <p className="text-footnote text-label-2">
                {kind === "improvement"
                  ? "Many states cap deposits on home-improvement contracts and require specific contract language. Deposit warnings follow your compliance profile."
                  : "Repairs and service calls. Deposit caps for home improvement don't apply."}
              </p>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside the label */}
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span>
                  <span className="block text-body">
                    Upsells may need a cooling-off notice
                  </span>
                  <span className="block text-footnote text-label-2">
                    ⚖️ FTC rule: in-home sales over $25 can need a 3-day
                    cancellation notice. Keep on unless your attorney says
                    otherwise.
                  </span>
                </span>
                <Toggle
                  name="upsellCovered"
                  defaultChecked={it?.upsellCovered ?? false}
                  label="Upsells may need a cooling-off notice"
                />
              </label>
            </div>
          </section>

          <section>
            <div className="rounded-card bg-card">
              <ToggleRow
                title="Active"
                subtitle="Off hides it from new jobs and lead forms."
                name="active"
                defaultChecked={it?.active ?? true}
              />
              <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-body">Sort order</span>
                <Stepper
                  name="sort"
                  label="Sort order"
                  defaultValue={it?.sort ?? 0}
                  min={0}
                  max={999}
                />
              </div>
            </div>
            <p className="px-4 pt-1.5 text-footnote text-label-2">
              Deposit rules by service type live in Settings → Deposits.
            </p>
          </section>
        </form>
      </FormErrors>
    </Sheet>
  );
}
