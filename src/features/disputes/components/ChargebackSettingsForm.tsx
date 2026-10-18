"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { saveChargebackSettings } from "../actions";

export interface ChargebackValues {
  risk: {
    weights: Record<string, number>;
    bands: { medium: number; high: number; critical: number };
    no_estimate_min_ticket_cents: number;
    critical_control: "approval" | "prepay" | "cash_only";
    enforce_controls: boolean;
  };
  disputes: {
    efw_refund_multiplier: number;
    dispute_fee_cents: number;
    suggest_accept_under_cents: number;
    suggest_accept_readiness_below: number;
    readiness_weights: Record<string, number>;
    rate_threshold_bps: number;
  };
  media: {
    keep_originals: boolean;
    keep_originals_tags: string[];
    max_upload_mb: number;
    far_from_site_m: number;
  };
}

const ORIGINAL_TAGS = [
  ["before", "Before"],
  ["after", "After"],
  ["id_check", "ID check"],
  ["signature", "Signature"],
  ["problem", "Problem"],
  ["receipt", "Receipt"],
] as const;

/** Settings → Chargeback protection (SPEC §11, M10, M11). */
export function ChargebackSettingsForm({
  initial,
  riskSignals,
  readinessItems,
  mediaOnly = false,
}: {
  initial: ChargebackValues;
  riskSignals: { key: string; label: string; default: number }[];
  readinessItems: { key: string; label: string; default: number }[];
  /** Chargeback protection is off: only the photo settings (they still apply). */
  mediaOnly?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const risk = (patch: Partial<ChargebackValues["risk"]>) =>
    setV((x) => ({ ...x, risk: { ...x.risk, ...patch } }));
  const disp = (patch: Partial<ChargebackValues["disputes"]>) =>
    setV((x) => ({ ...x, disputes: { ...x.disputes, ...patch } }));
  const med = (patch: Partial<ChargebackValues["media"]>) =>
    setV((x) => ({ ...x, media: { ...x.media, ...patch } }));
  const bandsOk =
    v.risk.bands.medium < v.risk.bands.high &&
    v.risk.bands.high < v.risk.bands.critical;
  const totalWeight = readinessItems.reduce(
    (s, i) => s + (v.disputes.readiness_weights[i.key] ?? i.default),
    0,
  );

  const stepRow = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    o: {
      min: number;
      max: number;
      step?: number;
      fmt?: (n: number) => string;
      sub?: string;
    },
  ) => (
    <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
      <span className="min-w-0">
        <span className="block text-body">{label}</span>
        {o.sub && (
          <span className="block text-footnote text-label-2">{o.sub}</span>
        )}
      </span>
      <Stepper
        label={label}
        value={value}
        min={o.min}
        max={o.max}
        step={o.step ?? 1}
        format={o.fmt}
        onChange={onChange}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {!mediaOnly && (
        <>
          <ListSection
            header="Risk controls"
            footer="Medium: signed estimate + before/after photos before Complete. High: + deposit or hold, 3-D Secure or card present, completion signature. Critical: + one of the options below."
          >
            <ToggleRow
              title="Enforce controls at Start and Complete"
              subtitle="Off: the risk chip still shows, nothing is blocked"
              checked={v.risk.enforce_controls}
              onChange={(e) =>
                risk({ enforce_controls: e.currentTarget.checked })
              }
            />
            <div className="list-row flex flex-col gap-2 px-4 py-3">
              <span className="text-body">Critical jobs need</span>
              <SegmentedControl<ChargebackValues["risk"]["critical_control"]>
                label="Critical jobs need"
                value={v.risk.critical_control}
                onChange={(c) => risk({ critical_control: c })}
                segments={[
                  { value: "approval", label: "Approval" },
                  { value: "prepay", label: "Prepay" },
                  { value: "cash_only", label: "Cash only" },
                ]}
              />
            </div>
            <div className="list-row px-4 py-3">
              <MoneyField
                label="Signed estimate needed from"
                valueCents={v.risk.no_estimate_min_ticket_cents}
                onChangeCents={(c) =>
                  risk({ no_estimate_min_ticket_cents: c ?? 0 })
                }
                hint="Below this ticket, a missing signed estimate doesn't add risk (routine service calls)."
              />
            </div>
          </ListSection>

          <ListSection
            header="Risk bands"
            footer={
              bandsOk
                ? `Low 0–${v.risk.bands.medium - 1} · Medium ${v.risk.bands.medium}–${v.risk.bands.high - 1} · High ${v.risk.bands.high}–${v.risk.bands.critical - 1} · Critical ${v.risk.bands.critical}+`
                : "Bands must go up: Medium < High < Critical."
            }
          >
            {stepRow(
              "Medium from",
              v.risk.bands.medium,
              (n) => risk({ bands: { ...v.risk.bands, medium: n } }),
              { min: 1, max: 99 },
            )}
            {stepRow(
              "High from",
              v.risk.bands.high,
              (n) => risk({ bands: { ...v.risk.bands, high: n } }),
              { min: 2, max: 99 },
            )}
            {stepRow(
              "Critical from",
              v.risk.bands.critical,
              (n) => risk({ bands: { ...v.risk.bands, critical: n } }),
              { min: 3, max: 100 },
            )}
          </ListSection>

          <ListSection
            header="Risk signals (points)"
            footer="Score = sum of active signals, 0–100. Negative points lower the risk."
          >
            {riskSignals.map((s) =>
              stepRow(
                s.label,
                v.risk.weights[s.key] ?? s.default,
                (n) => risk({ weights: { ...v.risk.weights, [s.key]: n } }),
                {
                  min: -50,
                  max: 100,
                  step: 5,
                  fmt: (n) => (n > 0 ? `+${n}` : String(n)),
                  sub:
                    (v.risk.weights[s.key] ?? s.default) !== s.default
                      ? `Default ${s.default > 0 ? "+" : ""}${s.default}`
                      : undefined,
                },
              ),
            )}
          </ListSection>

          <ListSection
            header="Readiness weights"
            footer={`Readiness = earned ÷ ${totalWeight} applicable points. Items that don't apply to a job earn full credit.`}
          >
            {readinessItems.map((i) =>
              stepRow(
                i.label,
                v.disputes.readiness_weights[i.key] ?? i.default,
                (n) =>
                  disp({
                    readiness_weights: {
                      ...v.disputes.readiness_weights,
                      [i.key]: n,
                    },
                  }),
                { min: 0, max: 50, step: 5 },
              ),
            )}
          </ListSection>

          <ListSection
            header="Disputes"
            footer="Accept is suggested when a dispute is small and the job's evidence is weak. An early fraud warning suggests a refund when the charge is no more than the dispute fee × the multiplier."
          >
            <div className="list-row px-4 py-3">
              <MoneyField
                label="Suggest Accept under"
                valueCents={v.disputes.suggest_accept_under_cents}
                onChangeCents={(c) =>
                  disp({ suggest_accept_under_cents: c ?? 0 })
                }
              />
            </div>
            {stepRow(
              "…and readiness below",
              v.disputes.suggest_accept_readiness_below,
              (n) => disp({ suggest_accept_readiness_below: n }),
              { min: 0, max: 100, step: 5 },
            )}
            <div className="list-row px-4 py-3">
              <MoneyField
                label="Processor dispute fee"
                valueCents={v.disputes.dispute_fee_cents}
                onChangeCents={(c) => disp({ dispute_fee_cents: c ?? 0 })}
              />
            </div>
            {stepRow(
              "Early fraud warning multiplier",
              v.disputes.efw_refund_multiplier,
              (n) => disp({ efw_refund_multiplier: n }),
              {
                min: 0,
                max: 20,
                sub: `Refund suggested up to ${formatMoney(v.disputes.dispute_fee_cents * v.disputes.efw_refund_multiplier)}`,
              },
            )}
            {stepRow(
              "Dispute-rate warning line",
              v.disputes.rate_threshold_bps,
              (n) => disp({ rate_threshold_bps: n }),
              {
                min: 25,
                max: 200,
                step: 5,
                fmt: (n) => `${(n / 100).toFixed(2)}%`,
              },
            )}
          </ListSection>
        </>
      )}

      <ListSection
        header={mediaOnly ? "Photos" : "Photo evidence"}
        footer={
          mediaOnly
            ? "Upload size and the far-from-site flag apply to every photo. Keeping originals takes effect when chargeback protection is on."
            : "Originals are kept (hash recorded either way) for the tags below when chargeback protection is on. Before/after photos are switched on or off in Features."
        }
      >
        <ToggleRow
          title="Keep original photos"
          subtitle="Uses more storage; strongest evidence"
          checked={v.media.keep_originals}
          onChange={(e) => med({ keep_originals: e.currentTarget.checked })}
        />
        {v.media.keep_originals &&
          ORIGINAL_TAGS.map(([k, label]) => (
            <ToggleRow
              key={k}
              title={`Originals for ${label}`}
              checked={v.media.keep_originals_tags.includes(k)}
              onChange={(e) =>
                med({
                  keep_originals_tags: e.currentTarget.checked
                    ? [...new Set([...v.media.keep_originals_tags, k])]
                    : v.media.keep_originals_tags.filter((t) => t !== k),
                })
              }
            />
          ))}
        {stepRow(
          "Flag photos farther than",
          v.media.far_from_site_m,
          (n) => med({ far_from_site_m: n }),
          { min: 100, max: 5000, step: 100, fmt: (n) => `${n} m` },
        )}
        {stepRow(
          "Max upload size",
          v.media.max_upload_mb,
          (n) => med({ max_upload_mb: n }),
          { min: 1, max: 15, fmt: (n) => `${n} MB` },
        )}
        <ListRow
          title="Features (photos, before/after)"
          href="/settings/features"
        />
      </ListSection>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] z-10">
        <Button
          size="lg"
          fullWidth
          className="shadow-float"
          disabled={!dirty || !bandsOk}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveChargebackSettings(v);
              if (r.ok) toast.success("Chargeback protection saved");
              else toast.error(r.error);
            })
          }
        >
          {dirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
