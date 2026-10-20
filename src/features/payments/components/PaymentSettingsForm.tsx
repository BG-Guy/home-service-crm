"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { Toggle, ToggleRow } from "@/ui/components/Toggle";
import { savePaymentSettings } from "../actions";
import { DEFAULT_MANUAL_INSTRUCTIONS } from "../defaults";
import {
  effectiveSurchargeBps,
  surchargeBlocked,
  surchargeCapBps,
} from "../engine/fees";

type Method = "card" | "ach" | "cash" | "check" | "zelle" | "venmo" | "other";
type RefMethod = "check" | "zelle" | "venmo" | "ach" | "other";

export interface PaymentSettingsValues {
  methods: Method[];
  fee_policy: "absorb" | "cash_discount" | "surcharge";
  surcharge_bps: number;
  cash_discount_bps: number;
  tips_enabled: boolean;
  tip_presets_pct: number[];
  tip_on_fees: boolean;
  allow_keyed: boolean;
  require_check_photo: boolean;
  reference_required: RefMethod[];
  statement_descriptor: string | null;
  descriptor_suffix: "job_number" | "invoice_number";
  pay_link_expires_minutes: number;
  unverified_alert_days: number;
  manual_instructions: string;
  promised_refund_days: number;
  fee_pct_by_method: Record<string, number>;
  max_refund_cents: {
    admin: number | null;
    office: number | null;
    tech: number | null;
  };
}

const METHOD_LABEL: Record<Method, string> = {
  card: "Card",
  ach: "Bank transfer (ACH)",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  other: "Other",
};
const ALL: Method[] = [
  "card",
  "cash",
  "check",
  "zelle",
  "venmo",
  "ach",
  "other",
];
const REF: RefMethod[] = ["check", "zelle", "venmo", "ach", "other"];

/** Settings → Payments (M09): methods, fee policy ⚖️, tips, keyed cards, refunds. */
export function PaymentSettingsForm({
  initial,
  state,
  processor,
}: {
  initial: PaymentSettingsValues;
  state: string | null;
  processor: boolean;
}) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof PaymentSettingsValues>(
    k: K,
    val: PaymentSettingsValues[K],
  ) => setV((x) => ({ ...x, [k]: val }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const cap = surchargeCapBps(state);
  const blocked = surchargeBlocked(state);

  const toggleIn = <T extends string>(list: T[], item: T, on: boolean) =>
    on ? [...new Set([...list, item])] : list.filter((x) => x !== item);

  const save = () =>
    start(async () => {
      const r = await savePaymentSettings({
        ...v,
        statement_descriptor: v.statement_descriptor?.trim() || null,
      });
      if (r.ok) toast.success("Payment settings saved");
      else toast.error(r.error);
    });

  const limitRow = (role: "admin" | "office" | "tech", label: string) => {
    const val = v.max_refund_cents[role];
    return (
      <div className="list-row flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body">{label}</span>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant */}
          <label className="flex items-center gap-2 text-subhead text-label-2">
            No limit
            <Toggle
              checked={val == null}
              onChange={(e) =>
                set("max_refund_cents", {
                  ...v.max_refund_cents,
                  [role]: e.currentTarget.checked ? null : 0,
                })
              }
              label={`${label}: no refund limit`}
            />
          </label>
        </div>
        {val != null && (
          <MoneyField
            label="Up to"
            hideLabel
            valueCents={val}
            onChangeCents={(c) =>
              set("max_refund_cents", { ...v.max_refund_cents, [role]: c ?? 0 })
            }
            hint={
              val === 0
                ? "Can't refund"
                : `Up to ${formatMoney(val)} per refund`
            }
          />
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {!processor && (
        <Banner tone="info" title="No card processor">
          Cash, check, Zelle and Venmo work now. Add Stripe keys in Settings →
          Integrations (and set PAYMENTS_DRIVER=stripe) for card pay links,
          holds and dispute tracking.
        </Banner>
      )}

      <ListSection header="Methods you accept">
        {ALL.map((m) => (
          <ToggleRow
            key={m}
            title={METHOD_LABEL[m]}
            subtitle={
              m === "card" && !processor ? "Needs a card processor" : undefined
            }
            checked={v.methods.includes(m)}
            onChange={(e) =>
              set("methods", toggleIn(v.methods, m, e.currentTarget.checked))
            }
          />
        ))}
      </ListSection>

      <ListSection
        header="Reference # required"
        footer="Techs must type the check # or the Zelle/Venmo confirmation. Manual payments stay Unverified until the office matches them in the bank."
      >
        {REF.map((m) => (
          <ToggleRow
            key={m}
            title={METHOD_LABEL[m]}
            checked={v.reference_required.includes(m)}
            onChange={(e) =>
              set(
                "reference_required",
                toggleIn(v.reference_required, m, e.currentTarget.checked),
              )
            }
          />
        ))}
        <ToggleRow
          title="Photo of every check"
          checked={v.require_check_photo}
          onChange={(e) => set("require_check_photo", e.currentTarget.checked)}
        />
        <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
          <span className="text-body">Flag unverified after</span>
          <Stepper
            label="Days before an unverified payment is flagged"
            value={v.unverified_alert_days}
            min={1}
            max={30}
            onChange={(n) => set("unverified_alert_days", n)}
            format={(n) => `${n} day${n === 1 ? "" : "s"}`}
          />
        </div>
      </ListSection>

      <section className="flex flex-col gap-3">
        <h2 className="px-4 text-subhead font-semibold text-label-2">
          Card fees ⚖️
        </h2>
        <SegmentedControl<PaymentSettingsValues["fee_policy"]>
          label="Fee policy"
          value={v.fee_policy}
          onChange={(p) => set("fee_policy", p)}
          segments={[
            { value: "absorb", label: "Absorb" },
            { value: "cash_discount", label: "Cash discount" },
            { value: "surcharge", label: "Surcharge", disabled: blocked },
          ]}
        />
        {v.fee_policy === "cash_discount" && (
          <TextField
            label="Cash discount (%)"
            type="number"
            min={0}
            max={10}
            step={0.25}
            value={v.cash_discount_bps / 100}
            onChange={(e) =>
              set(
                "cash_discount_bps",
                Math.round(Number(e.currentTarget.value || 0) * 100),
              )
            }
            hint="Shown as the cash price on the collect sheet. Card customers pay the listed price."
          />
        )}
        {v.fee_policy === "surcharge" && (
          <>
            <TextField
              label="Surcharge (%)"
              type="number"
              min={0}
              max={cap / 100}
              step={0.25}
              value={v.surcharge_bps / 100}
              onChange={(e) =>
                set(
                  "surcharge_bps",
                  Math.round(Number(e.currentTarget.value || 0) * 100),
                )
              }
              hint={`Capped at ${cap / 100}% in ${state ?? "your state"}; applied ${effectiveSurchargeBps(v.surcharge_bps, state) / 100}%.`}
            />
            <Banner tone="legal" title="Surcharging rules">
              Credit cards only (never debit or prepaid), disclosed before
              payment, capped at 3% (2% in Colorado), banned in Connecticut and
              Massachusetts. Card networks require 30 days' notice to your
              processor before you start.
            </Banner>
          </>
        )}
        {blocked && (
          <Banner tone="legal">
            Surcharges aren't allowed in {state}. Use a cash discount instead.
          </Banner>
        )}
        <div className="list-card">
          {(["cash", "check", "zelle", "venmo"] as const).map((m) => (
            <div
              key={m}
              className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5"
            >
              <span className="text-body">{METHOD_LABEL[m]} fee</span>
              <Stepper
                label={`${METHOD_LABEL[m]} fee percent`}
                value={v.fee_pct_by_method[m] ?? 0}
                min={0}
                max={1000}
                step={25}
                onChange={(n) =>
                  set("fee_pct_by_method", { ...v.fee_pct_by_method, [m]: n })
                }
                format={(n) => `${(n / 100).toFixed(2)}%`}
              />
            </div>
          ))}
        </div>
        <p className="px-4 text-footnote text-label-2">
          Configured fees for manual methods (used in commission math). Card
          fees come from the processor.
        </p>
      </section>

      <ListSection
        header="Tips"
        footer="Tips go 100% to the tech. No card fee is taken from tips."
      >
        <ToggleRow
          title="Offer a tip"
          checked={v.tips_enabled}
          onChange={(e) => set("tips_enabled", e.currentTarget.checked)}
        />
        <ToggleRow
          title="Tip on fees"
          subtitle="Include trip and service-call fees in the tip base"
          checked={v.tip_on_fees}
          onChange={(e) => set("tip_on_fees", e.currentTarget.checked)}
        />
        <div className="list-row flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-auto text-body">Presets (%)</span>
          {v.tip_presets_pct.map((p, i) => (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed preset slots
              key={i}
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              aria-label={`Tip preset ${i + 1}`}
              value={p}
              onChange={(e) => {
                const next = [...v.tip_presets_pct];
                next[i] = Number(e.currentTarget.value || 0);
                set("tip_presets_pct", next);
              }}
              className="h-11 w-16 rounded-[10px] bg-fill-2 text-center text-body"
            />
          ))}
        </div>
      </ListSection>

      <ListSection
        header="Card security"
        footer="Typed card numbers have no chip or 3-D Secure protection and lose most disputes. Leave off unless you take phone orders."
      >
        <ToggleRow
          title="Allow typed card numbers"
          subtitle="Also needs the 'Type a card number' permission"
          checked={v.allow_keyed}
          onChange={(e) => set("allow_keyed", e.currentTarget.checked)}
        />
        <div className="list-row px-4 py-3">
          <TextField
            label="Statement descriptor"
            maxLength={22}
            value={v.statement_descriptor ?? ""}
            onChange={(e) => set("statement_descriptor", e.currentTarget.value)}
            hint="What customers see on their card statement (≤ 22 characters). A recognizable name prevents 'I don't recognize this' disputes."
          />
        </div>
        <div className="list-row px-4 py-3">
          <Select
            label="Statement suffix"
            value={v.descriptor_suffix}
            onChange={(e) =>
              set(
                "descriptor_suffix",
                e.currentTarget
                  .value as PaymentSettingsValues["descriptor_suffix"],
              )
            }
            options={[
              { value: "job_number", label: "Job number" },
              { value: "invoice_number", label: "Invoice number" },
            ]}
          />
        </div>
        <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
          <span className="text-body">Pay links expire after</span>
          <Stepper
            label="Pay link expiry in minutes"
            value={v.pay_link_expires_minutes}
            min={30}
            max={1440}
            step={30}
            onChange={(n) => set("pay_link_expires_minutes", n)}
            format={(n) => (n % 60 === 0 ? `${n / 60} h` : `${n} min`)}
          />
        </div>
      </ListSection>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-subhead font-semibold text-label-2">
          Pay page instructions
        </h2>
        <TextArea
          label="Shown on the pay page when cards aren't available"
          hideLabel
          rows={3}
          maxLength={1000}
          value={v.manual_instructions}
          onChange={(e) => set("manual_instructions", e.currentTarget.value)}
        />
        {v.manual_instructions.trim() === DEFAULT_MANUAL_INSTRUCTIONS ||
        v.manual_instructions.trim() === "" ? (
          <Banner
            tone={processor ? "info" : "warning"}
            title="Placeholder text"
          >
            {processor
              ? "Customers see this if card payments are ever unavailable. "
              : "Customers see this on every pay and deposit link. "}
            Add your Zelle or Venmo handle and who checks are payable to, so
            they can actually pay.
          </Banner>
        ) : null}
      </section>

      <ListSection
        header="Refunds"
        footer="Refunds go back to the original method. Promised refunds create a reminder task on their due date."
      >
        {limitRow("admin", "Admin")}
        {limitRow("office", "Office")}
        {limitRow("tech", "Tech")}
        <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
          <span className="text-body">Promise refunds within</span>
          <Stepper
            label="Default promised refund days"
            value={v.promised_refund_days}
            min={1}
            max={60}
            onChange={(n) => set("promised_refund_days", n)}
            format={(n) => `${n} day${n === 1 ? "" : "s"}`}
          />
        </div>
        <ListRow
          title="Payment provider keys"
          href="/settings/integrations"
          subtitle="Stripe secret key and webhook secret"
        />
      </ListSection>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] z-10">
        <Button
          size="lg"
          fullWidth
          disabled={!dirty}
          loading={pending}
          onClick={save}
          className="shadow-float"
        >
          {dirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
