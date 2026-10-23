"use client";

import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { type ReactNode, useState, useTransition } from "react";
import {
  durationLabel,
  JOB_KINDS,
  type JobKind,
  KIND_COLOR,
  KIND_DEFAULTS,
  KIND_HINT,
  KIND_ICON,
  KIND_LABEL,
  type KindGroup,
  splitByKind,
} from "@/features/jobs/kinds";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
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

// Settings → Job types (leads-flow redesign, item 6). Two levels: the three job
// types every booking starts from (Free estimate, Service call, Project), each with
// its own defaults row, and the trade's jobs under each ("What's the job?" chips),
// each with its own rules. No maintenance interval (reminders are retired).

export interface ServiceTypeItem {
  id: string;
  name: string;
  kind: JobKind;
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
  sort: number;
  active: boolean;
}

/** One line under each job type card. */
const KIND_FOOTER: Record<JobKind, string> = {
  estimate: "A visit to look and quote. It ends with an estimate.",
  service:
    "Booking shows these as “What's the job?” chips. Each keeps its own price, length, photos and checklist.",
  project:
    "Bigger work, booked with deposit and home-improvement contract rules.",
};

interface Editing {
  item: ServiceTypeItem | null;
  kind: JobKind;
  /** The kind's own row (card defaults). */
  primary: boolean;
}

/** "45 min · $125 · ID check · 1+1 photos" */
function rules(it: ServiceTypeItem): string {
  return [
    durationLabel(it.defaultDurationMin),
    it.defaultPriceCents != null ? formatMoney(it.defaultPriceCents) : null,
    it.requiresOwnershipCheck ? "ID check" : null,
    it.photosRequiredBefore + it.photosRequiredAfter > 0
      ? `${it.photosRequiredBefore}+${it.photosRequiredAfter} photos`
      : null,
    it.requiresSignedEstimate ? "Signed estimate" : null,
    it.contractKind === "improvement" ? "Home improvement" : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  const [editing, setEditing] = useState<Editing | null>(null);
  const [, start] = useTransition();
  const groups = splitByKind(items.filter((i) => i.active));
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

  const tile = (it: { color: string | null; icon: string | null }) => (
    <span
      aria-hidden
      className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white"
      style={{ background: it.color ?? "var(--sys-gray)" }}
    >
      {icons[it.icon ?? ""] ?? icons.clipboard}
    </span>
  );

  const row = (it: ServiceTypeItem, primary: boolean) => (
    <ListRow
      leading={tile(it)}
      sepInset={62}
      title={it.name}
      subtitle={rules(it)}
      detail={
        primary ? (
          <Pill tone="gray" size="sm" dot={false}>
            Default
          </Pill>
        ) : undefined
      }
      onClick={() => setEditing({ item: it, kind: it.kind, primary })}
      accessory="chevron"
    />
  );

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {groups.map((g) => (
        <KindSection
          key={g.kind}
          group={g}
          icon={icons[KIND_ICON[g.kind]]}
          onAdd={() => setEditing({ item: null, kind: g.kind, primary: false })}
          onSetUp={() =>
            setEditing({ item: null, kind: g.kind, primary: true })
          }
          renderPrimary={(it) => row(it, true)}
          renderJob={(it) => (
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
              {row(it, false)}
            </SwipeActions>
          )}
        />
      ))}
      {archived.length > 0 && (
        <ListSection
          header="Archived"
          footer="Archived job types stay on old jobs but can't be booked. Swipe left to restore."
        >
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
              <div className="opacity-60">{row(it, false)}</div>
            </SwipeActions>
          ))}
        </ListSection>
      )}
      {editing && (
        <ServiceTypeSheet
          editing={editing}
          checklists={checklists}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** One job type card: its defaults row, then the trade's jobs under it. */
function KindSection({
  group,
  icon,
  onAdd,
  onSetUp,
  renderPrimary,
  renderJob,
}: {
  group: KindGroup<ServiceTypeItem>;
  icon: ReactNode;
  onAdd: () => void;
  onSetUp: () => void;
  renderPrimary: (it: ServiceTypeItem) => ReactNode;
  renderJob: (it: ServiceTypeItem) => ReactNode;
}) {
  const { kind, primary, jobs } = group;
  const headingId = `kind-${kind}-h`;
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-center gap-3 px-1 pb-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] text-white"
          style={{ background: KIND_COLOR[kind] }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-title3 text-label">
            {KIND_LABEL[kind]}
          </h2>
          <p className="text-subhead text-label-2">{KIND_HINT[kind]}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus aria-hidden size={16} />}
          onClick={onAdd}
          aria-label={`Add a job under ${KIND_LABEL[kind]}`}
        >
          Add job
        </Button>
      </div>
      <ul className="list-card">
        <li>
          {primary ? (
            renderPrimary(primary)
          ) : (
            <ListRow
              title={`Set up ${KIND_LABEL[kind]}`}
              subtitle={`${durationLabel(KIND_DEFAULTS[kind].durationMin)} by default`}
              onClick={onSetUp}
              accessory="chevron"
            />
          )}
        </li>
        {jobs.map((it) => (
          <li key={it.id}>{renderJob(it)}</li>
        ))}
      </ul>
      <p className="px-4 pt-2 text-footnote text-label-2">
        {KIND_FOOTER[kind]}
        {jobs.length > 0
          ? " Swipe left or right-click a job to archive it."
          : ""}
      </p>
    </section>
  );
}

function ServiceTypeSheet({
  editing,
  checklists,
  onClose,
}: {
  editing: Editing;
  checklists: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { item: it, primary } = editing;
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [kind, setKind] = useState<JobKind>(it?.kind ?? editing.kind);
  const defaults = KIND_DEFAULTS[it?.kind ?? editing.kind];
  const [contract, setContract] = useState<"repair" | "improvement">(
    it?.contractKind ?? defaults.contractKind,
  );
  const f = useActionForm(saveServiceTypeAction, {
    success: it ? "Job type saved" : "Job type added",
    onSuccess: () => {
      setDirty(false);
      setOpen(false);
    },
  });
  const title = it
    ? it.name
    : primary
      ? KIND_LABEL[editing.kind]
      : `New ${KIND_LABEL[editing.kind].toLowerCase()} job`;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      dirty={dirty}
      title={title}
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
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="contractKind" value={contract} />
          {primary ? (
            <p className="px-4 text-subhead text-label-2">
              The {KIND_LABEL[kind].toLowerCase()} card's own job: booked when
              nobody picks one of the jobs under it.
            </p>
          ) : (
            <section>
              <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
                Job type
              </h2>
              <div className="flex flex-col gap-2 rounded-card bg-card p-4">
                <SegmentedControl
                  label="Job type"
                  value={kind}
                  onChange={(v) => {
                    setKind(v);
                    setDirty(true);
                  }}
                  segments={JOB_KINDS.map((k) => ({
                    value: k,
                    label: KIND_LABEL[k],
                  }))}
                />
                <p className="text-footnote text-label-2">{KIND_HINT[kind]}</p>
              </div>
            </section>
          )}
          <FieldCard>
            <FText
              name="name"
              label="Name"
              defaultValue={it?.name ?? (primary ? KIND_LABEL[kind] : "")}
              required
              autoFocus={!it}
              placeholder="Lockout"
            />
            <ColorSwatches
              label="Color"
              name="color"
              defaultValue={(
                it?.color ?? (primary ? KIND_COLOR[kind] : "#007aff")
              ).toLowerCase()}
              options={SWATCHES.map((s) => ({
                value: s.hex.toLowerCase(),
                name: s.name,
              }))}
            />
            <FSelect
              name="icon"
              label="Icon"
              defaultValue={it?.icon ?? (primary ? KIND_ICON[kind] : "tools")}
              options={SERVICE_ICONS}
            />
            <FText
              name="aliases"
              label="Also known as"
              defaultValue={it?.aliases.join(", ")}
              placeholder="locked out, lockout, can't get in"
              hint="Words customers use. Lead forms match them to this job."
            />
          </FieldCard>

          <FieldCard header="Defaults">
            <div className="grid grid-cols-2 gap-4">
              <FText
                name="defaultDurationMin"
                label="Length (min)"
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                defaultValue={String(
                  it?.defaultDurationMin ?? defaults.durationMin,
                )}
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
              <FSelect
                name="checklistTemplateId"
                label="Checklist"
                defaultValue={it?.checklistTemplateId ?? ""}
                placeholder="None"
                options={checklists.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </div>
            <p className="-mt-2 text-footnote text-label-2">
              Techs complete the checklist before finishing the job.
            </p>
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
                title="Ownership check ⚖️"
                subtitle="Photo ID, proof of address and a signed authority line before opening a lock, door, car or safe."
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
                value={contract}
                onChange={(v) => {
                  setContract(v);
                  setDirty(true);
                }}
                segments={[
                  { value: "repair", label: "Repair" },
                  { value: "improvement", label: "Home improvement" },
                ]}
              />
              <p className="text-footnote text-label-2">
                {contract === "improvement"
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
              {primary && it?.active !== false ? (
                <input type="hidden" name="active" value="on" />
              ) : (
                <ToggleRow
                  title="Active"
                  subtitle="Off hides it from booking, new jobs and lead forms."
                  name="active"
                  defaultChecked={it?.active ?? true}
                />
              )}
              <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-body">Sort order</span>
                <Stepper
                  name="sort"
                  label="Sort order"
                  defaultValue={it?.sort ?? (primary ? 0 : 10)}
                  min={0}
                  max={999}
                />
              </div>
            </div>
            <p className="px-4 pt-1.5 text-footnote text-label-2">
              Deposit rules by job type live in Settings → Deposits.
            </p>
          </section>
        </form>
      </FormErrors>
    </Sheet>
  );
}
