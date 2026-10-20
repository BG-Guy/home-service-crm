"use client";

import { Plus } from "lucide-react";
import { type ReactNode, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet, useSheetState } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { Toggle, ToggleRow } from "@/ui/components/Toggle";
import {
  deleteDepositRule,
  publishDepositPolicy,
  saveDepositRule,
  saveDepositSettings,
} from "../actions";

type TriggerType =
  | "always"
  | "estimate_total_gte"
  | "has_special_order_parts"
  | "after_hours"
  | "new_customer"
  | "risk_band_gte"
  | "scheduled_days_out_gte"
  | "service_type_in"
  | "lead_source_in"
  | "customer_flag";
type AmountType =
  | "fixed"
  | "percent_total"
  | "percent_parts"
  | "parts_plus_percent";
type Mode = "capture" | "hold" | "card_on_file" | "manual";

export interface RuleView {
  id?: string;
  name: string;
  priority: number;
  active: boolean;
  trigger: { type: TriggerType; value?: string | number | string[] };
  amount: {
    type: AmountType;
    value: number;
    min_cents?: number;
    max_cents?: number;
    round_to_cents?: number;
  };
  mode: Mode;
  policyLabel?: string | null;
  uses?: number;
}

const TRIGGER_LABEL: Record<TriggerType, string> = {
  always: "Every job",
  estimate_total_gte: "Estimate total at least",
  has_special_order_parts: "Special-order parts",
  after_hours: "After-hours job",
  new_customer: "New customer",
  risk_band_gte: "Risk band at least",
  scheduled_days_out_gte: "Booked at least N days out",
  service_type_in: "Service type is",
  lead_source_in: "Lead source is",
  customer_flag: "Customer is prepay-required",
};
const AMOUNT_LABEL: Record<AmountType, string> = {
  fixed: "Fixed amount",
  percent_total: "% of the total",
  percent_parts: "% of parts",
  parts_plus_percent: "Parts + % of labor",
};
const MODE_LABEL: Record<Mode, string> = {
  capture: "Charge now",
  hold: "Card hold (captured at completion)",
  card_on_file: "Card on file",
  manual: "Cash / Zelle / check",
};

function triggerText(r: RuleView, names: Record<string, string>) {
  const v = r.trigger.value;
  switch (r.trigger.type) {
    case "estimate_total_gte":
      return `${TRIGGER_LABEL.estimate_total_gte} ${formatMoney(Number(v ?? 0))}`;
    case "risk_band_gte":
      return `${TRIGGER_LABEL.risk_band_gte} ${String(v ?? "high")}`;
    case "scheduled_days_out_gte":
      return `Booked ${Number(v ?? 0)}+ days out`;
    case "service_type_in":
    case "lead_source_in": {
      const ids = Array.isArray(v) ? v : v ? String(v).split(",") : [];
      return `${TRIGGER_LABEL[r.trigger.type]} ${ids.map((i) => names[i] ?? "?").join(", ") || "—"}`;
    }
    default:
      return TRIGGER_LABEL[r.trigger.type];
  }
}

function amountText(r: RuleView) {
  const a = r.amount;
  const base =
    a.type === "fixed"
      ? formatMoney(a.value)
      : a.type === "parts_plus_percent"
        ? `parts + ${a.value}%`
        : `${a.value}% of ${a.type === "percent_parts" ? "parts" : "total"}`;
  const bounds = [
    a.min_cents ? `min ${formatMoney(a.min_cents)}` : null,
    a.max_cents ? `max ${formatMoney(a.max_cents)}` : null,
  ].filter(Boolean);
  return bounds.length ? `${base} (${bounds.join(", ")})` : base;
}

const EMPTY: RuleView = {
  name: "",
  priority: 100,
  active: true,
  trigger: { type: "always" },
  amount: { type: "percent_total", value: 25 },
  mode: "capture",
};

/** Deposit rules list + editor sheet (first match by priority wins). */
export function DepositRulesEditor({
  rules,
  serviceTypes,
  leadSources,
  processor,
}: {
  rules: RuleView[];
  serviceTypes: { id: string; name: string }[];
  leadSources: { id: string; name: string }[];
  processor: boolean;
}) {
  const sheet = useSheetState();
  const [edit, setEdit] = useState<RuleView>(EMPTY);
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const names = Object.fromEntries(
    [...serviceTypes, ...leadSources].map((x) => [x.id, x.name]),
  );
  const open = (r: RuleView) => {
    setEdit(structuredClone(r));
    sheet.show();
  };
  const t = edit.trigger.type;
  const listValue = Array.isArray(edit.trigger.value)
    ? edit.trigger.value
    : edit.trigger.value
      ? String(edit.trigger.value).split(",")
      : [];
  const options = t === "service_type_in" ? serviceTypes : leadSources;

  return (
    <>
      <ListSection
        header="Rules"
        footer="Checked in priority order, lowest number first; the first matching rule sets the deposit."
        trailing={
          <Button
            size="sm"
            variant="plain"
            icon={<Plus size={16} />}
            onClick={() => open({ ...EMPTY })}
          >
            Add rule
          </Button>
        }
      >
        {rules.length === 0 ? (
          <p className="px-4 py-4 text-subhead text-label-2">
            No rules: deposits are only requested by hand.
          </p>
        ) : (
          rules.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => open(r)}
              className="list-row pressable flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left"
            >
              <span className="num w-8 shrink-0 text-subhead text-label-2">
                {r.priority}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-body">{r.name}</span>
                  {!r.active && (
                    <Pill tone="gray" size="sm">
                      Off
                    </Pill>
                  )}
                </span>
                <span className="block truncate text-footnote text-label-2">
                  {triggerText(r, names)} → {amountText(r)} ·{" "}
                  {processor || r.mode === "manual"
                    ? MODE_LABEL[r.mode]
                    : `${MODE_LABEL.manual} (no processor)`}
                </span>
              </span>
            </button>
          ))
        )}
      </ListSection>

      <Sheet
        {...sheet.props}
        title={edit.id ? "Edit rule" : "New rule"}
        detents={["large"]}
        leading={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Cancel
          </Button>
        }
        trailing={
          <Button
            size="sm"
            variant="plain"
            loading={pending}
            disabled={edit.name.trim().length < 2}
            onClick={() =>
              start(async () => {
                const r = await saveDepositRule({
                  id: edit.id,
                  name: edit.name,
                  priority: edit.priority,
                  active: edit.active,
                  trigger: edit.trigger,
                  amount: edit.amount,
                  mode: edit.mode,
                });
                if (r.ok) {
                  toast.success("Rule saved");
                  sheet.hide();
                } else toast.error(r.error);
              })
            }
          >
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          <TextField
            label="Name"
            value={edit.name}
            maxLength={80}
            placeholder="Big jobs: 25% deposit"
            onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })}
          />
          <div className="list-card">
            <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
              <span className="text-body">Priority</span>
              <Stepper
                label="Priority"
                value={edit.priority}
                min={0}
                max={1000}
                step={10}
                onChange={(n) => setEdit({ ...edit, priority: n })}
              />
            </div>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant */}
            <label className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
              <span className="text-body">Active</span>
              <Toggle
                checked={edit.active}
                onChange={(e) =>
                  setEdit({ ...edit, active: e.currentTarget.checked })
                }
              />
            </label>
          </div>
          <Select
            label="When"
            value={t}
            onChange={(e) =>
              setEdit({
                ...edit,
                trigger: { type: e.currentTarget.value as TriggerType },
              })
            }
            options={(Object.keys(TRIGGER_LABEL) as TriggerType[]).map((k) => ({
              value: k,
              label: TRIGGER_LABEL[k],
            }))}
          />
          {t === "estimate_total_gte" && (
            <MoneyField
              label="Total at least"
              valueCents={Number(edit.trigger.value ?? 0) || null}
              onChangeCents={(c) =>
                setEdit({ ...edit, trigger: { type: t, value: c ?? 0 } })
              }
            />
          )}
          {t === "risk_band_gte" && (
            <Select
              label="Band"
              value={String(edit.trigger.value ?? "high")}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  trigger: { type: t, value: e.currentTarget.value },
                })
              }
              options={[
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
            />
          )}
          {t === "scheduled_days_out_gte" && (
            <TextField
              label="Days out"
              type="number"
              min={0}
              value={Number(edit.trigger.value ?? 14)}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  trigger: {
                    type: t,
                    value: Number(e.currentTarget.value || 0),
                  },
                })
              }
            />
          )}
          {t === "customer_flag" && (
            <Select
              label="Flag"
              value={String(edit.trigger.value ?? "prepay_required")}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  trigger: { type: t, value: e.currentTarget.value },
                })
              }
              options={[
                { value: "prepay_required", label: "Prepay required" },
                { value: "dispute_history", label: "Has disputed before" },
              ]}
            />
          )}
          {(t === "service_type_in" || t === "lead_source_in") && (
            <fieldset className="list-card">
              <legend className="sr-only">{TRIGGER_LABEL[t]}</legend>
              {options.length === 0 ? (
                <p className="px-4 py-3 text-subhead text-label-2">
                  Nothing to pick yet.
                </p>
              ) : (
                options.map((o) => (
                  <ToggleRow
                    key={o.id}
                    title={o.name}
                    checked={listValue.includes(o.id)}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        trigger: {
                          type: t,
                          value: e.currentTarget.checked
                            ? [...new Set([...listValue, o.id])]
                            : listValue.filter((x) => x !== o.id),
                        },
                      })
                    }
                  />
                ))
              )}
            </fieldset>
          )}
          <Select
            label="Deposit"
            value={edit.amount.type}
            onChange={(e) =>
              setEdit({
                ...edit,
                amount: {
                  ...edit.amount,
                  type: e.currentTarget.value as AmountType,
                  value:
                    e.currentTarget.value === "fixed"
                      ? 10_000
                      : edit.amount.type === "fixed"
                        ? 25
                        : edit.amount.value,
                },
              })
            }
            options={(Object.keys(AMOUNT_LABEL) as AmountType[]).map((k) => ({
              value: k,
              label: AMOUNT_LABEL[k],
            }))}
          />
          {edit.amount.type === "fixed" ? (
            <MoneyField
              label="Amount"
              valueCents={edit.amount.value}
              onChangeCents={(c) =>
                setEdit({ ...edit, amount: { ...edit.amount, value: c ?? 0 } })
              }
            />
          ) : (
            <TextField
              label="Percent"
              type="number"
              min={0}
              max={100}
              value={edit.amount.value}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  amount: {
                    ...edit.amount,
                    value: Number(e.currentTarget.value || 0),
                  },
                })
              }
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              label="Minimum"
              valueCents={edit.amount.min_cents ?? null}
              onChangeCents={(c) =>
                setEdit({
                  ...edit,
                  amount: { ...edit.amount, min_cents: c ?? undefined },
                })
              }
            />
            <MoneyField
              label="Maximum"
              valueCents={edit.amount.max_cents ?? null}
              onChangeCents={(c) =>
                setEdit({
                  ...edit,
                  amount: { ...edit.amount, max_cents: c ?? undefined },
                })
              }
            />
          </div>
          <Select
            label="Collect by"
            value={edit.mode}
            onChange={(e) =>
              setEdit({ ...edit, mode: e.currentTarget.value as Mode })
            }
            options={(Object.keys(MODE_LABEL) as Mode[]).map((k) => ({
              value: k,
              label: MODE_LABEL[k],
            }))}
            hint={
              processor
                ? edit.mode === "hold"
                  ? "Holds are only used for jobs within the hold window; otherwise the card is charged."
                  : undefined
                : "No card processor: card modes fall back to cash / Zelle / check."
            }
          />
          {edit.id && (
            <Button
              variant="plain"
              className="text-danger"
              loading={pending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete this rule?",
                  message: edit.uses
                    ? "It was used on past deposits, so it will be turned off instead."
                    : undefined,
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!ok || !edit.id) return;
                const id = edit.id;
                start(async () => {
                  const r = await deleteDepositRule({ id });
                  if (r.ok) {
                    toast.success(
                      r.data?.deactivated ? "Rule turned off" : "Rule deleted",
                    );
                    sheet.hide();
                  } else toast.error(r.error);
                });
              }}
            >
              Delete rule
            </Button>
          )}
        </div>
      </Sheet>
      {confirmEl}
    </>
  );
}

export interface DepositSettingsValues {
  hold_max_days_out: number;
  round_to_cents: number;
  refundable_until_hours: number;
  restocking_pct: number;
  nonrefundable_after_po: boolean;
  due_hours: number | null;
}

/** General deposit settings (refund window, rounding, holds, due time). */
export function DepositSettingsForm({
  initial,
}: {
  initial: DepositSettingsValues;
}) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const row = (label: string, node: ReactNode) => (
    <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
      <span className="text-body">{label}</span>
      {node}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <ListSection
        header="Policy terms"
        footer="Shown to the customer with every deposit and snapshotted when they pay."
      >
        {row(
          "Refundable until",
          <Stepper
            label="Refundable until hours before the appointment"
            value={v.refundable_until_hours}
            min={0}
            max={720}
            step={12}
            onChange={(n) => setV({ ...v, refundable_until_hours: n })}
            format={(n) => (n ? `${n} h before` : "Work starts")}
          />,
        )}
        <ToggleRow
          title="Non-refundable once a special-order part is ordered"
          checked={v.nonrefundable_after_po}
          onChange={(e) =>
            setV({ ...v, nonrefundable_after_po: e.currentTarget.checked })
          }
        />
        {row(
          "Restocking fee",
          <Stepper
            label="Restocking fee percent"
            value={v.restocking_pct}
            min={0}
            max={50}
            step={5}
            onChange={(n) => setV({ ...v, restocking_pct: n })}
            format={(n) => `${n}%`}
          />,
        )}
      </ListSection>
      <ListSection header="Collection">
        {row(
          "Round to",
          <Stepper
            label="Round deposits to"
            value={v.round_to_cents}
            min={100}
            max={10_000}
            step={100}
            onChange={(n) => setV({ ...v, round_to_cents: n })}
            format={(n) => formatMoney(n)}
          />,
        )}
        {row(
          "Card holds up to",
          <Stepper
            label="Card holds only for jobs within days"
            value={v.hold_max_days_out}
            min={1}
            max={7}
            onChange={(n) => setV({ ...v, hold_max_days_out: n })}
            format={(n) => `${n} days out`}
          />,
        )}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant */}
        <label className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
          <span className="text-body">Due date</span>
          <Toggle
            checked={v.due_hours != null}
            onChange={(e) =>
              setV({ ...v, due_hours: e.currentTarget.checked ? 48 : null })
            }
            label="Deposits have a due date"
          />
        </label>
        {v.due_hours != null &&
          row(
            "Due within",
            <Stepper
              label="Deposit due within hours"
              value={v.due_hours}
              min={1}
              max={720}
              step={12}
              onChange={(n) => setV({ ...v, due_hours: n })}
              format={(n) => `${n} h`}
            />,
          )}
      </ListSection>
      <Button
        disabled={!dirty}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await saveDepositSettings(v);
            if (r.ok) toast.success("Deposit settings saved");
            else toast.error(r.error);
          })
        }
      >
        {dirty ? "Save deposit settings" : "Saved"}
      </Button>
    </div>
  );
}

/** Publish a new deposit-policy version (applied to rules; snapshotted per deposit). */
export function DepositPolicyForm({
  current,
}: {
  current: { title: string; body: string; version: number; at: string } | null;
}) {
  const [title, setTitle] = useState(current?.title ?? "Deposit policy");
  const [body, setBody] = useState(current?.body ?? "");
  const [pending, start] = useTransition();
  const changed =
    title !== (current?.title ?? "Deposit policy") ||
    body !== (current?.body ?? "");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-4 text-subhead font-semibold text-label-2">
        Deposit policy
        {current ? ` · version ${current.version}, ${current.at}` : ""}
      </h2>
      {!current && (
        <Banner tone="warning">
          No deposit policy yet. Publish one so customers see the terms they're
          agreeing to.
        </Banner>
      )}
      <TextField
        label="Title"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />
      <TextArea
        label="Policy text"
        rows={8}
        value={body}
        maxLength={10_000}
        onChange={(e) => setBody(e.currentTarget.value)}
        hint="Publishing creates a new version; deposits already accepted keep the version the customer saw."
      />
      <Button
        variant="tinted"
        disabled={!changed || body.trim().length < 20}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await publishDepositPolicy({
              title,
              body,
              applyToRules: true,
            });
            if (r.ok) toast.success(`Version ${r.data?.version} published`);
            else toast.error(r.error);
          })
        }
      >
        Publish new version
      </Button>
    </section>
  );
}
