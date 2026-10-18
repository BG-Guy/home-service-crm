"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AddressAutocomplete } from "@/ui/components/AddressAutocomplete";
import { Button } from "@/ui/components/Button";
import { ListSection } from "@/ui/components/List";
import { PhoneField } from "@/ui/components/PhoneField";
import { TimeField } from "@/ui/components/TimePicker";
import { Toggle, ToggleRow } from "@/ui/components/Toggle";
import { updateCompanyAction } from "../actions";
import { US_STATES, US_TIME_ZONES, WEEKDAYS } from "../options";
import {
  FArea,
  FieldCard,
  FieldErrorText,
  FormErrors,
  FSelect,
  FText,
  StickySave,
  useActionForm,
  useFieldError,
} from "./form";

export interface CompanyFormValues {
  name: string;
  legalName: string;
  phone: string;
  email: string;
  website: string;
  address: {
    street: string;
    unit: string;
    city: string;
    state: string;
    zip: string;
  };
  timezone: string;
  ein: string;
  emergencyPhone: string;
  leadResponseMinutes: number;
  serviceZips: string[];
  weekendsAfterHours: boolean;
  openSignup: boolean;
  showTechRank: boolean;
  hours: { day: number; open: string; close: string }[];
  licenses: { state: string; trade: string; number: string }[];
}

export function CompanyForm({ initial }: { initial: CompanyFormValues }) {
  const f = useActionForm(updateCompanyAction, { success: "Company saved" });
  const [licenses, setLicenses] = useState(
    initial.licenses.length
      ? initial.licenses
      : [{ state: initial.address.state, trade: "", number: "" }],
  );
  const zones = US_TIME_ZONES.some((z) => z.value === initial.timezone)
    ? US_TIME_ZONES
    : [...US_TIME_ZONES, { value: initial.timezone, label: initial.timezone }];

  return (
    <FormErrors errors={f.errors}>
      <form {...f.formProps} className="flex flex-col gap-[var(--section-gap)]">
        <FieldCard
          header="Business"
          footer="The name customers see on texts, invoices and the portal."
        >
          <FText
            name="name"
            label="Business name"
            defaultValue={initial.name}
            required
            maxLength={120}
            autoComplete="organization"
          />
          <FText
            name="legalName"
            label="Legal name"
            defaultValue={initial.legalName}
            placeholder="Acme Home Services LLC"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PhoneFieldF
              name="phone"
              label="Phone"
              defaultValue={initial.phone}
            />
            <FText
              name="email"
              type="email"
              label="Email"
              defaultValue={initial.email}
              autoComplete="email"
            />
          </div>
          <FText
            name="website"
            type="url"
            label="Website"
            defaultValue={initial.website}
            placeholder="https://"
          />
          <FText
            name="ein"
            label="EIN (optional)"
            defaultValue={initial.ein}
            hint="Used later for SMS (10DLC) registration."
            inputMode="numeric"
          />
        </FieldCard>

        <FieldCard header="Address">
          <AddressAutocomplete
            name="address.street"
            label="Street"
            defaultValue={initial.address.street}
            error={f.errors?.["address.street"]}
            fill={{
              city: "address.city",
              state: "address.state",
              zip: "address.zip",
            }}
            focusAfter="address.unit"
          />
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FText
              name="address.city"
              label="City"
              defaultValue={initial.address.city}
              autoComplete="address-level2"
            />
            <FText
              name="address.unit"
              label="Unit"
              defaultValue={initial.address.unit}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FSelect
              name="address.state"
              label="State"
              defaultValue={initial.address.state}
              placeholder="—"
              options={US_STATES.map(([v, l]) => ({ value: v, label: l }))}
            />
            <FText
              name="address.zip"
              label="ZIP"
              defaultValue={initial.address.zip}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </div>
          <FSelect
            name="timezone"
            label="Time zone"
            defaultValue={initial.timezone}
            options={zones}
            hint="Schedules, reminders, quiet hours and reports use this zone."
          />
        </FieldCard>

        <section>
          <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
            Business hours
          </h2>
          <div className="rounded-card bg-card">
            {WEEKDAYS.map((d) => (
              <HoursRow
                key={d.day}
                day={d.day}
                label={d.label}
                initial={initial.hours.find((h) => h.day === d.day)}
              />
            ))}
          </div>
          <p className="px-4 pt-1.5 text-footnote text-label-2">
            Outside these hours counts as after-hours (lead auto-replies,
            after-hours pricing).
          </p>
        </section>

        <ListSection
          header="After hours"
          footer="Emergency calls are routed to this number in after-hours replies."
        >
          <ToggleRow
            title="Weekends are after-hours"
            name="weekendsAfterHours"
            defaultChecked={initial.weekendsAfterHours}
          />
          <div className="px-4 py-3">
            <PhoneFieldF
              name="emergencyPhone"
              label="Emergency phone"
              defaultValue={initial.emergencyPhone}
            />
          </div>
        </ListSection>

        <FieldCard
          header="Service area"
          footer="Leads from other ZIPs are flagged “Out of area”."
        >
          <FArea
            name="serviceZips"
            label="Service ZIP codes"
            defaultValue={initial.serviceZips.join(", ")}
            placeholder="78701, 78702, 78703"
            rows={3}
          />
          <FText
            name="leadResponseMinutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            label="Lead response goal (minutes)"
            defaultValue={String(initial.leadResponseMinutes)}
            hint="New leads past this age turn red on Today."
          />
        </FieldCard>

        <section>
          <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
            Licenses
          </h2>
          <div className="flex flex-col gap-3 rounded-card bg-card p-4">
            {licenses.map((l, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved
                key={i}
                className="grid grid-cols-[4.5rem_1fr_1fr_auto] items-end gap-2"
              >
                <FText
                  name={`licenses.${i}.state`}
                  label="State"
                  defaultValue={l.state}
                  maxLength={2}
                  className="uppercase"
                />
                <FText
                  name={`licenses.${i}.trade`}
                  label="Trade"
                  defaultValue={l.trade}
                  placeholder="Locksmith"
                />
                <FText
                  name={`licenses.${i}.number`}
                  label="License #"
                  defaultValue={l.number}
                />
                <button
                  type="button"
                  aria-label="Remove license"
                  onClick={() =>
                    setLicenses((ls) => ls.filter((_, j) => j !== i))
                  }
                  className="pressable mb-0.5 flex size-11 items-center justify-center rounded-full text-danger"
                >
                  <Trash2 aria-hidden size={18} />
                </button>
              </div>
            ))}
            <Button
              variant="plain"
              size="sm"
              icon={<Plus aria-hidden size={16} />}
              onClick={() =>
                setLicenses((ls) => [
                  ...ls,
                  { state: initial.address.state, trade: "", number: "" },
                ])
              }
              className="self-start"
            >
              Add license
            </Button>
          </div>
          <p className="px-4 pt-1.5 text-footnote text-label-2">
            Printed on estimates and invoices where your state requires it.
          </p>
        </section>

        <ListSection header="Access">
          <ToggleRow
            title="Allow sign-up requests"
            subtitle="New people can request an account from the sign-up page; an admin approves them. Off = invite only."
            name="openSignup"
            defaultChecked={initial.openSignup}
          />
          <ToggleRow
            title="Show techs their rank"
            subtitle="Techs see where they stand on My Stats."
            name="showTechRank"
            defaultChecked={initial.showTechRank}
          />
        </ListSection>

        <FieldErrorText name="_" className="px-4" />
        <StickySave pending={f.pending} />
      </form>
    </FormErrors>
  );
}

function HoursRow({
  day,
  label,
  initial,
}: {
  day: number;
  label: string;
  initial?: { open: string; close: string };
}) {
  const [open, setOpen] = useState(!!initial);
  const err = useFieldError(`hours.${day}.to`);
  return (
    <div className="list-row flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside the label */}
      <label className="flex min-w-[8.5rem] flex-1 items-center gap-3">
        <Toggle
          name={`hours.${day}.open`}
          checked={open}
          onChange={(e) => setOpen(e.currentTarget.checked)}
          label={`Open on ${label}`}
        />
        <span className="text-body">{label}</span>
      </label>
      {open ? (
        // Wide enough for "12:00 PM" plus the picker icon (QA2 T3-24); wraps under
        // the day on narrow phones.
        <div className="flex shrink-0 items-center gap-2">
          <TimeField
            name={`hours.${day}.from`}
            defaultValue={initial?.open ?? "08:00"}
            label={`${label} opens`}
            hideLabel
            step={900}
            className="w-[9.25rem]"
          />
          <span className="text-label-2" aria-hidden>
            –
          </span>
          <TimeField
            name={`hours.${day}.to`}
            defaultValue={initial?.close ?? "17:00"}
            label={`${label} closes`}
            hideLabel
            step={900}
            className="w-[9.25rem]"
            error={err}
          />
        </div>
      ) : (
        <span className="text-body text-label-2">Closed</span>
      )}
    </div>
  );
}

function PhoneFieldF({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const err = useFieldError(name);
  return (
    <PhoneField
      name={name}
      label={label}
      defaultValue={defaultValue}
      error={err}
    />
  );
}
