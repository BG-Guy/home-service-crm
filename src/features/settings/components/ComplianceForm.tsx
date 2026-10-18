"use client";

import { Scale } from "lucide-react";
import { useState } from "react";
import { Banner } from "@/ui/components/Banner";
import { ListSection } from "@/ui/components/List";
import { Stepper } from "@/ui/components/Stepper";
import { TimeField } from "@/ui/components/TimePicker";
import { ToggleRow } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import {
  publishMonitoringNoticeAction,
  updateComplianceAction,
} from "../actions";
import { US_STATES } from "../options";
import {
  ActionForm,
  FArea,
  FieldCard,
  FormErrors,
  FSelect,
  FText,
  StickySave,
  useActionForm,
} from "./form";

export interface ComplianceValues {
  state: string;
  contractTemplates: boolean;
  depositCapWarnings: boolean;
  surchargeRestrictions: boolean;
  wageDeductionBlockedStates: string[];
  quietStart: string;
  quietEnd: string;
  automatedPer24h: number;
  marketingPer7d: number;
  smsConsentText: string;
  marketingConsentText: string;
}

export function ComplianceForm({ initial }: { initial: ComplianceValues }) {
  const f = useActionForm(updateComplianceAction, {
    success: "Compliance profile saved",
  });
  const [blocked, setBlocked] = useState<string[]>(
    initial.wageDeductionBlockedStates,
  );
  // From the result: this component renders <FormErrors>, so useFieldError's
  // context isn't available here (same bug as Branding's hex, QA2 T3-22).
  const quietErr = f.errors?.quietEnd?.[0];
  return (
    <FormErrors errors={f.errors}>
      <form {...f.formProps} className="flex flex-col gap-[var(--section-gap)]">
        <Banner
          tone="info"
          icon={<Scale aria-hidden size={20} />}
          title="Not legal advice"
        >
          These switches add warnings and safe defaults to the app. Check your
          state's rules with an attorney; turning a warning off never removes
          your legal obligations.
        </Banner>

        <FieldCard
          header="Where you operate"
          footer="Your home state picks the deposit-cap, surcharge and wage-deduction warnings that apply."
        >
          <FSelect
            name="state"
            label="State"
            defaultValue={initial.state}
            placeholder="Pick a state"
            options={US_STATES.map(([v, l]) => ({ value: v, label: l }))}
          />
        </FieldCard>

        <ListSection header="Warnings ⚖️">
          <ToggleRow
            title="Contract templates"
            subtitle="Add state-required language to estimates for home-improvement work."
            name="contractTemplates"
            defaultChecked={initial.contractTemplates}
          />
          <ToggleRow
            title="Deposit cap warnings"
            subtitle="Warn when a deposit exceeds your state's limit for home improvement."
            name="depositCapWarnings"
            defaultChecked={initial.depositCapWarnings}
          />
          <ToggleRow
            title="Card surcharge restrictions"
            subtitle="Block or warn on surcharges where your state restricts them."
            name="surchargeRestrictions"
            defaultChecked={initial.surchargeRestrictions}
          />
        </ListSection>

        <section>
          <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
            W-2 wage deductions ⚖️
          </h2>
          <div className="rounded-card bg-card p-4">
            <p className="mb-3 text-subhead text-label-2">
              In these states, tool and chargeback deductions from W-2 pay are
              held for review instead of posted.
            </p>
            <fieldset>
              <legend className="sr-only">States that block deductions</legend>
              <div className="flex flex-wrap gap-1.5">
                {US_STATES.map(([code, name]) => {
                  const on = blocked.includes(code);
                  return (
                    <label
                      key={code}
                      title={name}
                      className={cx(
                        "pressable inline-flex min-h-9 min-w-11 cursor-pointer items-center justify-center rounded-pill px-2.5 text-subhead font-medium",
                        on
                          ? "bg-label text-[var(--card)]"
                          : "bg-fill-2 text-label-2",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        name="wageDeductionBlockedStates[]"
                        value={code}
                        checked={on}
                        onChange={() =>
                          setBlocked((b) =>
                            on ? b.filter((x) => x !== code) : [...b, code],
                          )
                        }
                        aria-label={name}
                      />
                      {code}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </section>

        <section>
          <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
            Texting quiet hours (TCPA) ⚖️
          </h2>
          <div className="flex flex-col gap-4 rounded-card bg-card p-4">
            {/* items-start: an error under one field takes its own space
                without pushing the other field down (QA2 re-check). */}
            <div className="flex items-start gap-3">
              <TimeField
                name="quietStart"
                label="Send texts from"
                defaultValue={initial.quietStart}
                step={900}
                className="flex-1"
              />
              <TimeField
                name="quietEnd"
                label="Until"
                defaultValue={initial.quietEnd}
                step={900}
                className="flex-1"
                error={quietErr}
              />
            </div>
            <p className="text-footnote text-label-2">
              In the customer's local time. Automated texts outside this window
              wait until it opens. Default 8:00–20:00.
            </p>
          </div>
        </section>

        <section>
          <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
            Frequency caps
          </h2>
          <div className="rounded-card bg-card">
            <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              <span className="text-body">Automated texts per 24 h</span>
              <Stepper
                name="automatedPer24h"
                label="Automated texts per 24 hours"
                defaultValue={initial.automatedPer24h}
                min={1}
                max={20}
              />
            </div>
            <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              <span className="text-body">Marketing texts per 7 days</span>
              <Stepper
                name="marketingPer7d"
                label="Marketing texts per 7 days"
                defaultValue={initial.marketingPer7d}
                min={0}
                max={7}
              />
            </div>
          </div>
          <p className="px-4 pt-1.5 text-footnote text-label-2">
            Per customer. Appointment reminders count toward the automated cap.
          </p>
        </section>

        <FieldCard
          header="Consent text"
          footer="Shown next to the SMS checkbox on your lead form and booking pages. Keep “Reply STOP to opt out”."
        >
          <FArea
            name="smsConsentText"
            label="Service texts"
            defaultValue={initial.smsConsentText}
            rows={4}
          />
          <FArea
            name="marketingConsentText"
            label="Marketing texts (separate, optional checkbox)"
            defaultValue={initial.marketingConsentText}
            rows={3}
          />
        </FieldCard>

        <StickySave pending={f.pending} />
      </form>
    </FormErrors>
  );
}

export function MonitoringNoticeForm({
  current,
}: {
  current: { version: number; title: string; body: string; at: string } | null;
}) {
  return (
    <ActionForm
      action={publishMonitoringNoticeAction}
      success={(d) => (d ? `Version ${d.version} published` : "Published")}
      className="flex flex-col gap-3"
    >
      {({ pending }) => (
        <FieldCard
          header="Location monitoring notice ⚖️"
          footer={
            current
              ? `Version ${current.version} is live since ${current.at}. Publishing a change creates a new version; techs accept it on their next sign-in.`
              : "Techs must accept this notice before their location is shared."
          }
        >
          <FText
            name="title"
            label="Title"
            defaultValue={current?.title ?? "Location sharing while on shift"}
          />
          <FArea
            name="body"
            label="Notice"
            rows={6}
            defaultValue={current?.body ?? ""}
          />
          <button
            type="submit"
            disabled={pending}
            className="pressable min-h-11 self-start rounded-control bg-fill-2 px-4 text-body font-semibold text-accent-text disabled:opacity-60"
          >
            {pending ? "Publishing…" : "Publish new version"}
          </button>
        </FieldCard>
      )}
    </ActionForm>
  );
}
