"use client";

import { Calculator, Code2, Plus, Save } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { DateField, Select, TextArea, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { archivePlan, savePlanVersion } from "../actions";
import { computeJob } from "../engine/compute-job";
import { resolvePlan } from "../engine/plan";
import type { CompPlan, PaymentMethod } from "../engine/types";
import { Trace } from "./Trace";

type PlanSummary = {
  planKey: string;
  name: string;
  version: number;
  archived: boolean;
  plan: CompPlan;
};

const pct = (bps: number | undefined) => (bps == null ? "" : String(bps / 100));
const toBps = (v: string) =>
  v.trim() === "" ? undefined : Math.round(Number(v) * 100);
const METHODS: PaymentMethod[] = [
  "card",
  "ach",
  "venmo",
  "zelle",
  "check",
  "cash",
  "other",
];
const today = () => new Date().toISOString().slice(0, 10);

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">{children}</div>;
}

/**
 * Comp plan editor (SPEC M16, §10.1): common fields as a form, everything else in
 * Advanced (JSON). Saving creates a NEW VERSION (agreements must be re-signed). The live
 * calculator runs the same pure engine as payroll, in the browser.
 */
export function PlanEditor({
  plans,
  defaultKey,
}: {
  plans: PlanSummary[];
  defaultKey: string;
}) {
  const [key, setKey] = useState(
    plans.find((p) => p.planKey === defaultKey)?.planKey ??
      plans[0]?.planKey ??
      "",
  );
  const current = plans.find((p) => p.planKey === key);
  const [isNew, setIsNew] = useState(plans.length === 0);
  const [newKey, setNewKey] = useState("");
  const [name, setName] = useState(current?.name ?? "");
  const [plan, setPlan] = useState<CompPlan>(() =>
    resolvePlan(current?.plan ?? {}),
  );
  const [json, setJson] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, start] = useTransition();

  const pick = (k: string) => {
    const p = plans.find((x) => x.planKey === k);
    setKey(k);
    setIsNew(false);
    setName(p?.name ?? "");
    setPlan(resolvePlan(p?.plan ?? {}));
    setJson(null);
    setErrors(undefined);
  };
  const set = (patch: (p: CompPlan) => CompPlan) =>
    setPlan((p) => patch(structuredClone(p)));

  // ---------------------------------------------------------------- example calculator
  const [exTotal, setExTotal] = useState<number | null>(40000);
  const [exCoParts, setExCoParts] = useState<number | null>(4000);
  const [exTechParts, setExTechParts] = useState<number | null>(2500);
  const [exTip, setExTip] = useState<number | null>(2000);
  const [exMethod, setExMethod] = useState<"card" | "cash">("card");
  const [exWorker, setExWorker] = useState<"1099" | "w2">("1099");
  const example = useMemo(() => {
    try {
      const total = exTotal ?? 0;
      const tip = exTip ?? 0;
      const fee = exMethod === "card" ? Math.round((total + tip) * 0.03) : 0;
      const r = computeJob(
        {
          jobId: "example",
          revenueCents: total,
          taxCents: 0,
          serviceTypeId: null,
          customRateBps: null,
          isCallback: false,
          payments: [
            {
              id: "p",
              method: exMethod,
              amountCents: total,
              tipCents: tip,
              feeCents: fee,
              collectedByUserId: exMethod === "cash" ? "t" : null,
            },
          ],
          companyPartsCents: exCoParts ?? 0,
          techPartsByUser:
            (exTechParts ?? 0) > 0 ? { t: exTechParts ?? 0 } : {},
          assignees: [{ userId: "t", splitBps: 10000, role: "primary" }],
        },
        exWorker === "w2"
          ? {
              ...plan,
              w2_floor_check: true,
              tips: { ...plan.tips, deduct_card_fee_on_tip: false },
            }
          : plan,
        [{ userId: "t", workerType: exWorker, overrides: {} }],
        { planLabel: name.trim() || undefined },
      );
      return { earning: r.earnings[0], companyNet: r.companyNetCents, fee };
    } catch {
      return null;
    }
  }, [plan, exTotal, exCoParts, exTechParts, exTip, exMethod, exWorker, name]);

  const save = () =>
    start(async () => {
      let config: unknown = plan;
      if (json != null) {
        try {
          config = JSON.parse(json);
        } catch {
          setJsonError("That isn't valid JSON.");
          return;
        }
      }
      const r = await savePlanVersion({
        planKey: isNew ? newKey : key,
        name,
        effectiveFrom,
        config,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors);
        toast({ title: "Plan not saved", message: r.error, tone: "error" });
        return;
      }
      setErrors(undefined);
      toast({
        title: `Saved ${name} v${r.data?.version}`,
        message:
          (r.data?.version ?? 1) > 1
            ? "Techs on this plan are asked to re-sign their agreement."
            : undefined,
        tone: "success",
      });
      if (isNew) {
        setKey(newKey);
        setIsNew(false);
      }
    });

  const err = (k: string) => errors?.[`config.${k}`]?.[0] ?? null;
  const pf = plan.deductions_before_split.processing_fees;
  const feeMode = typeof pf === "object" ? "configured" : pf;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <ListSection
        header="Plan"
        trailing={
          <Button
            size="sm"
            variant="plain"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => {
              setIsNew(true);
              setNewKey("");
              setName("");
              setPlan(resolvePlan({}));
            }}
          >
            New plan
          </Button>
        }
        footer={
          isNew
            ? "A new plan starts from the Partner 25% defaults."
            : `Current: v${current?.version ?? 1}. Saving creates v${(current?.version ?? 0) + 1}; earlier jobs keep the version they were paid on.`
        }
      >
        <Row>
          {isNew ? (
            <TextField
              label="Plan key"
              placeholder="e.g. helper_15"
              value={newKey}
              onChange={(e) =>
                setNewKey(
                  e.currentTarget.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "_"),
                )
              }
              error={errors?.planKey?.[0]}
            />
          ) : (
            <Select
              label="Plan"
              value={key}
              onChange={(e) => pick(e.currentTarget.value)}
              options={plans.map((p) => ({
                value: p.planKey,
                label: `${p.name} (v${p.version})${p.archived ? " · archived" : ""}`,
              }))}
            />
          )}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={errors?.name?.[0]}
          />
        </Row>
      </ListSection>

      {json == null ? (
        <>
          <ListSection header="Commission">
            <Row>
              <Select
                label="Commission is paid on"
                value={plan.basis}
                onChange={(e) => {
                  const v = e.currentTarget.value as CompPlan["basis"];
                  set((p) => ({ ...p, basis: v }));
                }}
                options={[
                  {
                    value: "net_after_deductions",
                    label: "Job total minus parts & fees",
                  },
                  { value: "revenue", label: "Job total" },
                  {
                    value: "gross_profit",
                    label: "Gross profit (minus labor cost)",
                  },
                  { value: "flat_per_job", label: "Flat amount per job" },
                  { value: "hourly", label: "Hourly only" },
                  {
                    value: "hourly_plus_commission",
                    label: "Hourly + commission",
                  },
                ]}
              />
              {plan.basis === "flat_per_job" ? (
                <MoneyField
                  label="Per job"
                  valueCents={plan.flat_per_job_cents ?? null}
                  onChangeCents={(c) =>
                    set((p) => ({ ...p, flat_per_job_cents: c ?? 0 }))
                  }
                />
              ) : (
                <TextField
                  label="Rate (%)"
                  inputMode="decimal"
                  value={pct(plan.rate_bps)}
                  onChange={(e) => {
                    const v = toBps(e.currentTarget.value) ?? 0;
                    set((p) => ({ ...p, rate_bps: v }));
                  }}
                  error={err("rate_bps")}
                />
              )}
            </Row>
            {plan.basis !== "revenue" && plan.basis !== "flat_per_job" && (
              <>
                <ToggleRow
                  title="Deduct company-paid parts"
                  checked={plan.deductions_before_split.company_parts}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    set((p) => ({
                      ...p,
                      deductions_before_split: {
                        ...p.deductions_before_split,
                        company_parts: v,
                      },
                    }));
                  }}
                />
                <ToggleRow
                  title="Deduct parts the tech bought"
                  checked={plan.deductions_before_split.tech_parts}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    set((p) => ({
                      ...p,
                      deductions_before_split: {
                        ...p.deductions_before_split,
                        tech_parts: v,
                      },
                    }));
                  }}
                />
                <ToggleRow
                  title="Deduct lead cost"
                  checked={plan.deductions_before_split.lead_cost}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    set((p) => ({
                      ...p,
                      deductions_before_split: {
                        ...p.deductions_before_split,
                        lead_cost: v,
                      },
                    }));
                  }}
                />
              </>
            )}
            <Row>
              <Select
                label="Processing fees"
                value={feeMode}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  set((p) => ({
                    ...p,
                    deductions_before_split: {
                      ...p.deductions_before_split,
                      processing_fees:
                        v === "configured"
                          ? {
                              pct_bps_by_method: {
                                card: 300,
                                ach: 80,
                                venmo: 190,
                              },
                            }
                          : (v as "none" | "actual"),
                    },
                  }));
                }}
                options={[
                  { value: "actual", label: "Actual fee charged" },
                  { value: "configured", label: "Fixed % by method" },
                  { value: "none", label: "Not deducted" },
                ]}
              />
              {typeof pf === "object" && (
                <TextField
                  label="Card fee (%)"
                  inputMode="decimal"
                  value={pct(pf.pct_bps_by_method.card)}
                  onChange={(e) => {
                    const v = toBps(e.currentTarget.value) ?? 0;
                    set((p) => ({
                      ...p,
                      deductions_before_split: {
                        ...p.deductions_before_split,
                        processing_fees: {
                          pct_bps_by_method: {
                            ...(typeof p.deductions_before_split
                              .processing_fees === "object"
                              ? p.deductions_before_split.processing_fees
                                  .pct_bps_by_method
                              : {}),
                            card: v,
                          },
                        },
                      },
                    }));
                  }}
                />
              )}
            </Row>
            <fieldset
              className="flex flex-wrap gap-2 px-4 pb-3"
              aria-label="Methods whose fee is deducted"
            >
              {METHODS.map((mth) => {
                const on = plan.fee_methods.includes(mth);
                return (
                  <Button
                    key={mth}
                    size="sm"
                    variant={on ? "filled" : "gray"}
                    aria-pressed={on}
                    onClick={() =>
                      set((p) => ({
                        ...p,
                        fee_methods: on
                          ? p.fee_methods.filter((x) => x !== mth)
                          : [...p.fee_methods, mth],
                      }))
                    }
                  >
                    {mth === "ach"
                      ? "ACH"
                      : mth[0]?.toUpperCase() + mth.slice(1)}
                  </Button>
                );
              })}
            </fieldset>
            <Row>
              <Select
                label="Earned when"
                value={plan.earned_on}
                onChange={(e) => {
                  const v = e.currentTarget.value as CompPlan["earned_on"];
                  set((p) => ({ ...p, earned_on: v }));
                }}
                options={[
                  {
                    value: "paid_in_full",
                    label: "The invoice is paid in full",
                  },
                  { value: "job_done", label: "The job is completed" },
                ]}
              />
              <Select
                label="Two techs on a job"
                value={plan.splits.default}
                onChange={(e) => {
                  const v = e.currentTarget
                    .value as CompPlan["splits"]["default"];
                  set((p) => ({ ...p, splits: { default: v } }));
                }}
                options={[
                  {
                    value: "primary_100",
                    label: "Primary gets 100% (unless split)",
                  },
                  { value: "even", label: "Split evenly" },
                ]}
              />
            </Row>
          </ListSection>

          <ListSection header="Tips & parts">
            <Row>
              <TextField
                label="Tips to tech (%)"
                inputMode="decimal"
                value={pct(plan.tips.pct_to_tech_bps)}
                onChange={(e) => {
                  const v = toBps(e.currentTarget.value) ?? 0;
                  set((p) => ({
                    ...p,
                    tips: { ...p.tips, pct_to_tech_bps: v },
                  }));
                }}
              />
              <TextField
                label="Tech-bought parts reimbursed (%)"
                inputMode="decimal"
                value={pct(plan.tech_parts_reimburse_bps)}
                onChange={(e) => {
                  const v = toBps(e.currentTarget.value) ?? 0;
                  set((p) => ({ ...p, tech_parts_reimburse_bps: v }));
                }}
              />
            </Row>
            <ToggleRow
              title="Deduct the card fee from tips"
              checked={plan.tips.deduct_card_fee_on_tip}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                set((p) => ({
                  ...p,
                  tips: { ...p.tips, deduct_card_fee_on_tip: v },
                }));
              }}
            />
            {plan.tips.deduct_card_fee_on_tip && (
              <div className="px-4 pb-3">
                <Banner tone="legal">
                  ⚖️ Not allowed in some states (e.g. California) and never
                  applied to W-2 employees.
                </Banner>
              </div>
            )}
          </ListSection>

          <ListSection
            header="Cash the tech collects"
            footer="Checks are payable to the company and are always handed in."
          >
            <ToggleRow
              title="Tech keeps the cash"
              checked={plan.cash.tech_keeps_cash}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                set((p) => ({
                  ...p,
                  cash: {
                    ...p.cash,
                    tech_keeps_cash: v,
                    settlement: v ? p.cash.settlement : "separate_remittance",
                  },
                }));
              }}
            />
            <Row>
              <Select
                label="Cash kept is"
                disabled={!plan.cash.tech_keeps_cash}
                value={plan.cash.settlement}
                onChange={(e) => {
                  const v = e.currentTarget
                    .value as CompPlan["cash"]["settlement"];
                  set((p) => ({ ...p, cash: { ...p.cash, settlement: v } }));
                }}
                options={[
                  {
                    value: "net_in_payout",
                    label: "Deducted from pay (1099 only)",
                  },
                  {
                    value: "separate_remittance",
                    label: "Handed in separately",
                  },
                ]}
              />
              <MoneyField
                label="Alert when holding over"
                valueCents={plan.cash.max_cash_held_cents}
                onChangeCents={(c) =>
                  set((p) => ({
                    ...p,
                    cash: { ...p.cash, max_cash_held_cents: c ?? 0 },
                  }))
                }
              />
              <TextField
                label="Hand in within (days)"
                inputMode="numeric"
                value={String(plan.cash.remit_within_days)}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value) || 0;
                  set((p) => ({
                    ...p,
                    cash: { ...p.cash, remit_within_days: v },
                  }));
                }}
              />
            </Row>
          </ListSection>

          <ListSection
            header="Chargebacks & callbacks ⚖️"
            footer="W-2 deductions are never applied automatically: they wait for admin review. Docking pay for recalls may be illegal for employees in some states (e.g. MA)."
          >
            <Row>
              <Select
                label="When a dispute opens"
                value={plan.chargebacks.on_open}
                onChange={(e) => {
                  const v = e.currentTarget
                    .value as CompPlan["chargebacks"]["on_open"];
                  set((p) => ({
                    ...p,
                    chargebacks: { ...p.chargebacks, on_open: v },
                  }));
                }}
                options={[
                  { value: "hold", label: "Hold the commission" },
                  { value: "none", label: "Do nothing" },
                ]}
              />
              <Select
                label="If the dispute is lost"
                value={plan.chargebacks.on_lost}
                onChange={(e) => {
                  const v = e.currentTarget
                    .value as CompPlan["chargebacks"]["on_lost"];
                  set((p) => ({
                    ...p,
                    chargebacks: { ...p.chargebacks, on_lost: v },
                  }));
                }}
                options={[
                  { value: "clawback_100", label: "Take back the commission" },
                  { value: "clawback_pct", label: "Take back a %" },
                  { value: "none", label: "Company absorbs it" },
                ]}
              />
              {plan.chargebacks.on_lost === "clawback_pct" && (
                <TextField
                  label="Chargeback clawback (%)"
                  inputMode="decimal"
                  value={pct(plan.chargebacks.clawback_bps)}
                  onChange={(e) => {
                    const v = toBps(e.currentTarget.value);
                    set((p) => ({
                      ...p,
                      chargebacks: { ...p.chargebacks, clawback_bps: v },
                    }));
                  }}
                  error={err("chargebacks.clawback_bps")}
                />
              )}
              <Select
                label="Callback within the recall window"
                value={plan.recalls.policy}
                onChange={(e) => {
                  const v = e.currentTarget
                    .value as CompPlan["recalls"]["policy"];
                  set((p) => ({ ...p, recalls: { ...p.recalls, policy: v } }));
                }}
                options={[
                  {
                    value: "no_commission_on_recall",
                    label: "No commission on the callback",
                  },
                  {
                    value: "clawback_pct",
                    label: "Claw back a % of the original",
                  },
                  { value: "none", label: "Pay as normal" },
                ]}
              />
              <TextField
                label="Recall window (days)"
                inputMode="numeric"
                value={String(plan.recalls.window_days)}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value) || 0;
                  set((p) => ({
                    ...p,
                    recalls: { ...p.recalls, window_days: v },
                  }));
                }}
              />
              {plan.recalls.policy === "clawback_pct" && (
                <TextField
                  label="Recall clawback (%)"
                  inputMode="decimal"
                  value={pct(plan.recalls.clawback_bps)}
                  onChange={(e) => {
                    const v = toBps(e.currentTarget.value);
                    set((p) => ({
                      ...p,
                      recalls: { ...p.recalls, clawback_bps: v },
                    }));
                  }}
                  error={err("recalls.clawback_bps")}
                />
              )}
            </Row>
            <ToggleRow
              title="Charge the dispute fee to the tech"
              checked={plan.chargebacks.dispute_fee_to_tech}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                set((p) => ({
                  ...p,
                  chargebacks: { ...p.chargebacks, dispute_fee_to_tech: v },
                }));
              }}
            />
          </ListSection>

          <ListSection header="Balances & wage rules">
            <Row>
              <Select
                label="Negative balance"
                value={plan.negative_balance}
                onChange={(e) => {
                  const v = e.currentTarget
                    .value as CompPlan["negative_balance"];
                  set((p) => ({ ...p, negative_balance: v }));
                }}
                options={[
                  { value: "carry_forward", label: "Carry forward" },
                  {
                    value: "request_remittance",
                    label: "Ask the tech to pay it back",
                  },
                ]}
              />
              <TextField
                label="Max deductions per period (% of earnings)"
                inputMode="decimal"
                placeholder="No cap"
                value={pct(plan.max_deduction_per_period_bps)}
                onChange={(e) => {
                  const v = toBps(e.currentTarget.value);
                  set((p) => ({ ...p, max_deduction_per_period_bps: v }));
                }}
              />
              <MoneyField
                label="Minimum wage per hour"
                valueCents={plan.min_wage_cents_per_hour}
                onChangeCents={(c) =>
                  set((p) => ({ ...p, min_wage_cents_per_hour: c ?? 0 }))
                }
                hint="Used for the W-2 floor and overtime check"
              />
            </Row>
            <ToggleRow
              title="Minimum-wage & overtime check for everyone"
              subtitle="Always on for W-2 employees."
              checked={plan.w2_floor_check}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                set((p) => ({ ...p, w2_floor_check: v }));
              }}
            />
          </ListSection>
        </>
      ) : (
        <ListSection
          header="Advanced (JSON)"
          footer="Tiers and spiffs are edited here. Validated with the plan schema when you save."
        >
          <div className="p-4">
            <TextArea
              label="Plan config"
              hideLabel
              rows={22}
              className="font-mono text-footnote"
              value={json}
              onChange={(e) => {
                setJson(e.currentTarget.value);
                setJsonError(null);
              }}
              error={jsonError ?? errors?.["config._"]?.[0] ?? null}
              spellCheck={false}
            />
            {errors &&
              Object.keys(errors).some((k) => k.startsWith("config.")) && (
                <ul className="mt-2 text-footnote text-danger">
                  {Object.entries(errors).map(([k, v]) => (
                    <li key={k}>
                      {k.replace(/^config\./, "")}: {v[0]}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </ListSection>
      )}

      <div className="flex flex-wrap items-end gap-3 px-4">
        <Button
          variant="gray"
          icon={<Code2 size={17} aria-hidden />}
          onClick={() => {
            if (json == null) setJson(JSON.stringify(plan, null, 2));
            else {
              try {
                setPlan(resolvePlan(JSON.parse(json)));
                setJson(null);
              } catch {
                setJsonError("Fix the JSON before switching back.");
              }
            }
          }}
        >
          {json == null ? "Advanced (JSON)" : "Back to form"}
        </Button>
        <DateField
          label="Effective from"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.currentTarget.value)}
        />
        <Button
          icon={<Save size={17} aria-hidden />}
          loading={pending}
          disabled={!name || (isNew && !newKey)}
          onClick={save}
        >
          Save {isNew ? "plan" : `as v${(current?.version ?? 0) + 1}`}
        </Button>
        {!isNew && current && (
          <Button
            variant="plain"
            onClick={() =>
              start(async () => {
                const r = await archivePlan({
                  planKey: current.planKey,
                  archived: !current.archived,
                });
                toast(
                  r.ok
                    ? {
                        title: current.archived
                          ? "Plan restored"
                          : "Plan archived",
                        tone: "success",
                      }
                    : {
                        title: "Couldn't update",
                        message: r.error,
                        tone: "error",
                      },
                );
              })
            }
          >
            {current.archived ? "Restore" : "Archive"}
          </Button>
        )}
      </div>

      <ListSection
        header="Try it"
        footer={
          example
            ? `${
                exMethod === "card"
                  ? `Card fee in this example: 3% (${formatMoney(example.fee)}).`
                  : "Cash has no processing fee."
              } Company keeps ${formatMoney(example.companyNet)}.`
            : undefined
        }
      >
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <MoneyField
            label="Job total (before tax & tip)"
            valueCents={exTotal}
            onChangeCents={setExTotal}
          />
          <MoneyField
            label="Company parts"
            valueCents={exCoParts}
            onChangeCents={setExCoParts}
          />
          <MoneyField
            label="Parts the tech bought"
            valueCents={exTechParts}
            onChangeCents={setExTechParts}
          />
          <MoneyField label="Tip" valueCents={exTip} onChangeCents={setExTip} />
          <SegmentedControl
            label="Paid by"
            value={exMethod}
            onChange={setExMethod}
            segments={[
              { value: "card", label: "Card" },
              { value: "cash", label: "Cash" },
            ]}
          />
          <SegmentedControl
            label="Worker"
            value={exWorker}
            onChange={setExWorker}
            segments={[
              { value: "1099", label: "1099" },
              { value: "w2", label: "W-2" },
            ]}
          />
        </div>
        <div className="border-t border-sep px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-subhead font-semibold">
            <Calculator size={16} aria-hidden /> Tech earns{" "}
            {example?.earning ? formatMoney(example.earning.netCents) : "—"}
          </p>
          {example?.earning && <Trace steps={example.earning.trace} />}
        </div>
      </ListSection>
    </div>
  );
}
