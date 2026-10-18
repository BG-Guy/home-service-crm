"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { DateField, Select, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  addMileageRate,
  assignPlan,
  savePayrollSettings,
  saveRoleRates,
} from "../actions";

const today = () => new Date().toISOString().slice(0, 10);

/** Hour fields of the payroll settings form (bounds match savePayrollSettings). */
const HOUR_RULES = {
  closeDelayHours: { max: 240, label: "Close periods after" },
  reviewHours: { max: 240, label: "The review window" },
  bankChangeHoldHours: { max: 720, label: "The bank-change hold" },
} as const;
const pct = (bps: number | undefined | null) =>
  bps == null ? "" : String(bps / 100);
const toBps = (v: string) =>
  v.trim() === "" ? null : Math.round(Number(v) * 100);

type Overrides = {
  rate_bps?: number;
  by_service_type?: Record<string, number>;
  tech_keeps_cash?: boolean;
  cash_settlement?: "net_in_payout" | "separate_remittance";
};

/** Assign a plan + per-tech overrides (rate, by service type, cash handling). Audited; re-sign required. */
export function AssignPlanButton({
  person,
  plans,
  serviceTypes,
}: {
  person: {
    id: string;
    name: string;
    workerType: string;
    planKey: string;
    overrides: Overrides;
  };
  plans: { planKey: string; name: string; version: number }[];
  serviceTypes: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [planKey, setPlanKey] = useState(person.planKey);
  const [from, setFrom] = useState(today);
  const [rate, setRate] = useState(pct(person.overrides.rate_bps));
  const [bySvc, setBySvc] = useState<{ id: string; pct: string }[]>(
    Object.entries(person.overrides.by_service_type ?? {}).map(([id, b]) => ({
      id,
      pct: pct(b),
    })),
  );
  const [keeps, setKeeps] = useState(
    person.overrides.tech_keeps_cash == null
      ? "inherit"
      : person.overrides.tech_keeps_cash
        ? "yes"
        : "no",
  );
  const [settle, setSettle] = useState(
    person.overrides.cash_settlement ?? "inherit",
  );
  const [pending, start] = useTransition();
  const w2 = person.workerType === "w2";

  const save = () =>
    start(async () => {
      const by: Record<string, number> = {};
      for (const r of bySvc) {
        const b = toBps(r.pct);
        if (r.id && b != null) by[r.id] = b;
      }
      const res = await assignPlan({
        userId: person.id,
        planKey,
        effectiveFrom: from,
        overrides: {
          rate_bps: toBps(rate),
          by_service_type: by,
          tech_keeps_cash: keeps === "inherit" ? null : keeps === "yes",
          cash_settlement:
            settle === "inherit"
              ? null
              : (settle as "net_in_payout" | "separate_remittance"),
        },
      });
      if (!res.ok) {
        toast({ title: "Not saved", message: res.error, tone: "error" });
        return;
      }
      toast({
        title: `${person.name}'s pay plan updated`,
        message: "They're asked to sign the new agreement.",
        tone: "success",
      });
      setOpen(false);
    });

  return (
    <>
      <IconButton
        label={`Edit ${person.name}'s plan`}
        variant="gray"
        size={36}
        onClick={() => setOpen(true)}
      >
        <Pencil size={16} aria-hidden />
      </IconButton>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={person.name}
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button size="lg" fullWidth loading={pending} onClick={save}>
            Save assignment
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-6 pt-1">
          <Select
            label="Plan"
            value={planKey}
            onChange={(e) => setPlanKey(e.currentTarget.value)}
            options={plans.map((p) => ({
              value: p.planKey,
              label: `${p.name} (v${p.version})`,
            }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Personal rate (%)"
              inputMode="decimal"
              placeholder="Plan rate"
              value={rate}
              onChange={(e) => setRate(e.currentTarget.value)}
            />
            <DateField
              label="Effective from"
              value={from}
              onChange={(e) => setFrom(e.currentTarget.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-footnote font-semibold uppercase text-label-2">
              Rate by service type
            </legend>
            {bySvc.map((r, i) => (
              <div key={`${r.id}-${i}`} className="flex items-end gap-2">
                <Select
                  label="Service"
                  className="flex-1"
                  value={r.id}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setBySvc((s) =>
                      s.map((x, j) => (j === i ? { ...x, id: v } : x)),
                    );
                  }}
                  options={[
                    { value: "", label: "Choose…" },
                    ...serviceTypes.map((s) => ({
                      value: s.id,
                      label: s.name,
                    })),
                  ]}
                />
                <TextField
                  label="%"
                  className="w-24"
                  inputMode="decimal"
                  value={r.pct}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setBySvc((s) =>
                      s.map((x, j) => (j === i ? { ...x, pct: v } : x)),
                    );
                  }}
                />
                <IconButton
                  label="Remove"
                  onClick={() => setBySvc((s) => s.filter((_, j) => j !== i))}
                >
                  <Trash2 size={17} aria-hidden />
                </IconButton>
              </div>
            ))}
            <Button
              size="sm"
              variant="plain"
              icon={<Plus size={16} aria-hidden />}
              onClick={() => setBySvc((s) => [...s, { id: "", pct: "" }])}
            >
              Add service rate
            </Button>
          </fieldset>
          <Select
            label="Keeps the cash they collect"
            value={keeps}
            onChange={(e) => setKeeps(e.currentTarget.value)}
            options={[
              { value: "inherit", label: "Use the plan setting" },
              { value: "yes", label: "Yes" },
              { value: "no", label: "No, hands it in" },
            ]}
          />
          <Select
            label="Cash kept is"
            value={w2 ? "separate_remittance" : settle}
            disabled={w2 || keeps === "no"}
            onChange={(e) => setSettle(e.currentTarget.value as typeof settle)}
            options={[
              { value: "inherit", label: "Use the plan setting" },
              { value: "net_in_payout", label: "Deducted from pay" },
              { value: "separate_remittance", label: "Handed in separately" },
            ]}
          />
          {w2 && (
            <Banner tone="legal">
              ⚖️ W-2 employees never have cash deducted from wages; it is tracked
              and handed in.
            </Banner>
          )}
          <p className="text-footnote text-label-2">
            Changes are audited. Changing the plan or terms asks the tech to
            sign a new agreement.
          </p>
        </div>
      </Sheet>
    </>
  );
}

type PayrollSettings = {
  period: "weekly" | "biweekly" | "semimonthly";
  week_starts_on: number;
  biweekly_anchor: string;
  close_delay_hours: number;
  review_hours: number;
  negative_balance: "carry_forward" | "request_remittance";
  nacha_enabled: boolean;
  bank_change_hold_hours: number;
  threshold_1099_cents: number;
  default_plan_key: string;
  nacha: Record<string, string | null>;
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function PayrollSettingsForm({
  initial,
  plans,
}: {
  initial: PayrollSettings;
  plans: { planKey: string; name: string }[];
}) {
  const [s, setS] = useState(initial);
  const [account, setAccount] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, start] = useTransition();
  const n = (k: string) => String(s.nacha[k] ?? "");
  const setN = (k: string, v: string) =>
    setS((x) => ({ ...x, nacha: { ...x.nacha, [k]: v } }));
  const e = (k: string) => errors?.[k]?.[0] ?? null;
  // Hour fields keep what was typed; bad input is a field error, never a silent 0
  // (QA2, the T3-10 pattern). Keys match the server's fieldErrors.
  const [hours, setHours] = useState({
    closeDelayHours: String(initial.close_delay_hours),
    reviewHours: String(initial.review_hours),
    bankChangeHoldHours: String(initial.bank_change_hold_hours),
  });
  return (
    <form
      className="flex flex-col gap-4 p-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        const parsed: Record<keyof typeof hours, number> = {
          closeDelayHours: 0,
          reviewHours: 0,
          bankChangeHoldHours: 0,
        };
        const bad: Record<string, string[]> = {};
        for (const k of Object.keys(HOUR_RULES) as (keyof typeof hours)[]) {
          const { max, label } = HOUR_RULES[k];
          const raw = hours[k].trim();
          const v = Number(raw);
          if (!/^\d+$/.test(raw) || v > max)
            bad[k] = [`${label} must be a whole number from 0 to ${max}.`];
          else parsed[k] = v;
        }
        if (Object.keys(bad).length) {
          setErrors(bad);
          toast({ title: "Check the highlighted fields.", tone: "error" });
          return;
        }
        start(async () => {
          const r = await savePayrollSettings({
            period: s.period,
            weekStartsOn: s.week_starts_on,
            biweeklyAnchor: s.biweekly_anchor,
            closeDelayHours: parsed.closeDelayHours,
            reviewHours: parsed.reviewHours,
            negativeBalance: s.negative_balance,
            bankChangeHoldHours: parsed.bankChangeHoldHours,
            threshold1099Cents: s.threshold_1099_cents,
            defaultPlanKey: s.default_plan_key,
            nachaEnabled: s.nacha_enabled,
            nacha: {
              immediate_destination: n("immediate_destination"),
              immediate_destination_name: n("immediate_destination_name"),
              immediate_origin: n("immediate_origin"),
              immediate_origin_name: n("immediate_origin_name"),
              company_name: n("company_name"),
              company_id: n("company_id"),
              odfi_routing: n("odfi_routing"),
              entry_description: n("entry_description"),
              company_account: account || undefined,
            },
          });
          if (!r.ok) {
            setErrors(r.fieldErrors);
            toast({ title: "Not saved", message: r.error, tone: "error" });
            return;
          }
          setErrors(undefined);
          setAccount("");
          toast({ title: "Payroll settings saved", tone: "success" });
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Pay period"
          value={s.period}
          onChange={(ev) => {
            const v = ev.currentTarget.value as PayrollSettings["period"];
            setS((x) => ({ ...x, period: v }));
          }}
          options={[
            { value: "weekly", label: "Weekly" },
            { value: "biweekly", label: "Every two weeks" },
            { value: "semimonthly", label: "Twice a month (1st & 16th)" },
          ]}
        />
        {s.period !== "semimonthly" && (
          <Select
            label="Week starts on"
            value={String(s.week_starts_on)}
            onChange={(ev) => {
              const v = Number(ev.currentTarget.value);
              setS((x) => ({ ...x, week_starts_on: v }));
            }}
            options={DAYS.map((d, i) => ({ value: String(i), label: d }))}
          />
        )}
        {s.period === "biweekly" && (
          <DateField
            label="A period start date"
            value={s.biweekly_anchor}
            onChange={(ev) => {
              const v = ev.currentTarget.value;
              setS((x) => ({ ...x, biweekly_anchor: v }));
            }}
          />
        )}
        <TextField
          label="Close periods after (hours)"
          inputMode="numeric"
          value={hours.closeDelayHours}
          onChange={(ev) => {
            const v = ev.currentTarget.value;
            setHours((x) => ({ ...x, closeDelayHours: v }));
          }}
          hint="Time to finish late paperwork"
          error={e("closeDelayHours")}
        />
        <TextField
          label="Tech review window (hours)"
          inputMode="numeric"
          value={hours.reviewHours}
          onChange={(ev) => {
            const v = ev.currentTarget.value;
            setHours((x) => ({ ...x, reviewHours: v }));
          }}
          error={e("reviewHours")}
        />
        <Select
          label="Default plan"
          value={s.default_plan_key}
          onChange={(ev) => {
            const v = ev.currentTarget.value;
            setS((x) => ({ ...x, default_plan_key: v }));
          }}
          options={plans.map((p) => ({ value: p.planKey, label: p.name }))}
        />
        <Select
          label="Negative balance"
          value={s.negative_balance}
          onChange={(ev) => {
            const v = ev.currentTarget
              .value as PayrollSettings["negative_balance"];
            setS((x) => ({ ...x, negative_balance: v }));
          }}
          options={[
            { value: "carry_forward", label: "Carry forward" },
            {
              value: "request_remittance",
              label: "Ask the tech to pay it back",
            },
          ]}
        />
        <MoneyField
          label="1099 reporting threshold"
          valueCents={s.threshold_1099_cents}
          onChangeCents={(c) =>
            setS((x) => ({ ...x, threshold_1099_cents: c ?? 0 }))
          }
          hint="$2,000 from 2026; check with your accountant"
        />
        <TextField
          label="Bank-change payout hold (hours)"
          inputMode="numeric"
          value={hours.bankChangeHoldHours}
          onChange={(ev) => {
            const v = ev.currentTarget.value;
            setHours((x) => ({ ...x, bankChangeHoldHours: v }));
          }}
          hint="Payouts wait this long after a tech changes bank details"
          error={e("bankChangeHoldHours")}
        />
      </div>
      {/* A visible label, like the plan editor's switches (QA2, T3-02 pattern). */}
      <div className="list-card">
        <ToggleRow
          title="NACHA direct-deposit file export"
          subtitle="Download a bank file to pay techs by direct deposit"
          checked={s.nacha_enabled}
          onChange={(ev) => {
            const v = ev.currentTarget.checked;
            setS((x) => ({ ...x, nacha_enabled: v }));
          }}
        />
      </div>
      {s.nacha_enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Bank routing (immediate destination)"
            inputMode="numeric"
            maxLength={9}
            value={n("immediate_destination")}
            onChange={(ev) =>
              setN("immediate_destination", ev.currentTarget.value)
            }
            error={e("nacha.immediate_destination")}
          />
          <TextField
            label="Bank name"
            maxLength={23}
            value={n("immediate_destination_name")}
            onChange={(ev) =>
              setN("immediate_destination_name", ev.currentTarget.value)
            }
          />
          <TextField
            label="Immediate origin (from your bank)"
            maxLength={10}
            value={n("immediate_origin")}
            onChange={(ev) => setN("immediate_origin", ev.currentTarget.value)}
            error={e("nacha.immediate_origin")}
            hint="Often 1 + your EIN"
          />
          <TextField
            label="Origin name"
            maxLength={23}
            value={n("immediate_origin_name")}
            onChange={(ev) =>
              setN("immediate_origin_name", ev.currentTarget.value)
            }
          />
          <TextField
            label="Company name (16)"
            maxLength={16}
            value={n("company_name")}
            onChange={(ev) => setN("company_name", ev.currentTarget.value)}
            error={e("nacha.company_name")}
          />
          <TextField
            label="Company ID (10)"
            maxLength={10}
            value={n("company_id")}
            onChange={(ev) => setN("company_id", ev.currentTarget.value)}
            error={e("nacha.company_id")}
          />
          <TextField
            label="ODFI routing"
            inputMode="numeric"
            maxLength={9}
            value={n("odfi_routing")}
            onChange={(ev) => setN("odfi_routing", ev.currentTarget.value)}
            hint="Defaults to the bank routing"
          />
          <TextField
            label="Entry description"
            maxLength={10}
            value={n("entry_description")}
            onChange={(ev) => setN("entry_description", ev.currentTarget.value)}
          />
          <TextField
            label="Funding account"
            inputMode="numeric"
            type="password"
            placeholder={
              s.nacha.company_account_last4
                ? `On file ••${s.nacha.company_account_last4}`
                : "Account number"
            }
            value={account}
            onChange={(ev) =>
              setAccount(ev.currentTarget.value.replace(/\D/g, ""))
            }
            hint="Encrypted; only the last 4 are shown"
          />
        </div>
      )}
      <Button type="submit" loading={pending} className="self-start">
        Save settings
      </Button>
    </form>
  );
}

export function RoleRatesForm({
  roles,
  rates,
}: {
  roles: { key: string; name: string; baseRole: string }[];
  rates: Record<string, number>;
}) {
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(roles.map((r) => [r.key, pct(rates[r.key])])),
  );
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {roles.map((r) => (
          <TextField
            key={r.key}
            label={`${r.name} (%)`}
            inputMode="decimal"
            placeholder="Plan rate"
            value={v[r.key] ?? ""}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setV((x) => ({ ...x, [r.key]: val }));
            }}
          />
        ))}
      </div>
      <Button
        variant="tinted"
        className="self-start"
        loading={pending}
        onClick={() =>
          start(async () => {
            const res = await saveRoleRates({
              rates: Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, toBps(x)]),
              ),
            });
            toast(
              res.ok
                ? { title: "Role rates saved", tone: "success" }
                : { title: "Not saved", message: res.error, tone: "error" },
            );
          })
        }
      >
        Save role rates
      </Button>
    </div>
  );
}

export function MileageRateForm() {
  const [from, setFrom] = useState(today);
  const [cents, setCents] = useState("");
  const [source, setSource] = useState("IRS standard rate");
  const [pending, start] = useTransition();
  return (
    <div className="grid items-end gap-3 p-4 sm:grid-cols-4">
      <DateField
        label="Effective from"
        value={from}
        onChange={(e) => setFrom(e.currentTarget.value)}
      />
      <TextField
        label="Cents per mile"
        inputMode="decimal"
        placeholder="72.5"
        value={cents}
        onChange={(e) => setCents(e.currentTarget.value)}
      />
      <TextField
        label="Source"
        value={source}
        onChange={(e) => setSource(e.currentTarget.value)}
      />
      <Button
        variant="tinted"
        loading={pending}
        disabled={!Number(cents)}
        onClick={() =>
          start(async () => {
            const r = await addMileageRate({
              effectiveFrom: from,
              centsPerMile: Number(cents),
              source,
            });
            toast(
              r.ok
                ? { title: "Mileage rate saved", tone: "success" }
                : { title: "Not saved", message: r.error, tone: "error" },
            );
            if (r.ok) setCents("");
          })
        }
      >
        Add rate
      </Button>
    </div>
  );
}
