"use client";

import { Check, UserRound } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { Chip } from "@/ui/components/Chip";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { PhoneField } from "@/ui/components/PhoneField";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import { createLeadAndCustomer, lookupCaller } from "../../actions";
import type { CallerMatch } from "../../contracts";

// Step 1 of the call-to-booking flow (/leads/new): built for use while on the
// phone. Phone first (returning callers pop up as you type), then the address,
// the service as chips, notes, source and an optional quoted price.

export interface CallerDefaults {
  leadId: string | null;
  name: string;
  phone: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  serviceTypeId: string | null;
  service: string;
  notes: string;
  sourceId: string | null;
  priceCents: number | null;
  smsConsent: boolean;
}

// Custom fields live under "More details": their chunk loads when it opens.
const CustomFieldsFields = dynamic(
  () =>
    import("@/features/settings/slots.client").then(
      (m) => m.CustomFieldsFields,
    ),
  { ssr: false },
);

const digits = (s: string) => s.replace(/\D/g, "");

export function CallerForm({
  defaults,
  sources,
  services,
  zipHint,
  cityHint,
  consentText,
  customDefs,
  canSchedule,
}: {
  defaults: CallerDefaults;
  sources: { id: string; name: string }[];
  services: { id: string; name: string }[];
  zipHint: string | null;
  cityHint: string | null;
  consentText: string;
  customDefs: CustomFieldDef[];
  canSchedule: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const editing = !!defaults.leadId;
  const [phone, setPhone] = useState(defaults.phone);
  const [name, setName] = useState(defaults.name);
  const [street, setStreet] = useState(defaults.street);
  const [unit, setUnit] = useState(defaults.unit);
  const [city, setCity] = useState(defaults.city);
  const [state, setState] = useState(defaults.state);
  const [zip, setZip] = useState(defaults.zip);
  const [serviceId, setServiceId] = useState<string | null>(
    defaults.serviceTypeId ?? (defaults.service ? "other" : null),
  );
  const [priceCents, setPriceCents] = useState(defaults.priceCents);
  const [matches, setMatches] = useState<CallerMatch[]>([]);
  const [linked, setLinked] = useState<CallerMatch | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const [intent, setIntent] = useState<"schedule" | "lead">("schedule");
  const mustShowMore = customDefs.some((d) => d.required);
  const [moreOpen, setMoreOpen] = useState(mustShowMore);
  const err = (k: string) => errors[k];

  // Returning-caller lookup while the phone is typed (exact number, debounced).
  const lookupSeq = useRef(0);
  useEffect(() => {
    if (editing) return;
    const d = digits(phone);
    if (d.length < 10) {
      setMatches([]);
      return;
    }
    const seq = ++lookupSeq.current;
    const t = setTimeout(() => {
      lookupCaller(phone)
        .then((m) => {
          if (seq === lookupSeq.current) setMatches(m);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [phone, editing]);
  useEffect(() => {
    if (linked && !matches.some((m) => m.customerId === linked.customerId))
      setLinked(null);
  }, [matches, linked]);

  const applyMatch = (m: CallerMatch) => {
    setLinked(m);
    setName(m.name);
    if (m.address) {
      setStreet(m.address.street);
      setUnit(m.address.unit ?? "");
      setCity(m.address.city);
      setState(m.address.state);
      setZip(m.address.zip);
    }
  };

  const submit = (which: "schedule" | "lead") => {
    const form = formRef.current;
    if (!form) return;
    setIntent(which);
    const fd = new FormData(form);
    const custom: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("custom.") || typeof v !== "string") continue;
      const key = k.slice(7).replace(/\[\]$/, "");
      if (k.endsWith("[]"))
        custom[key] = [...((custom[key] as string[]) ?? []), v];
      else if (v !== "") custom[key] = v;
    }
    const text = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : "";
    };
    start(async () => {
      const r = await createLeadAndCustomer({
        intent: which,
        leadId: defaults.leadId ?? undefined,
        sourceId: text("sourceId"),
        name,
        phone,
        email: text("email"),
        street,
        unit,
        city,
        state,
        zip,
        serviceTypeId: serviceId && serviceId !== "other" ? serviceId : "",
        service: serviceId === "other" ? text("service") : "",
        priceCents: priceCents ?? undefined,
        notes: text("notes"),
        smsConsent: fd.get("smsConsent") === "on",
        ...(Object.keys(custom).length ? { custom } : {}),
        clientId: crypto.randomUUID(),
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? { _: [r.error] });
        toast.error(r.error);
        return;
      }
      setErrors({});
      const leadId = r.data?.leadId;
      if (!leadId) return;
      if (which === "schedule") {
        // Back from step 2 returns to this lead's values, not an empty form.
        window.history.replaceState(null, "", `/leads/new?leadId=${leadId}`);
        router.push(`/leads/new/schedule?leadId=${leadId}`, {
          transitionTypes: NAV_FORWARD,
        });
      } else {
        toast.success(
          r.data?.merged ? "Added to their open lead" : "Lead saved",
        );
        router.push(`/leads/${leadId}`, { transitionTypes: NAV_FORWARD });
      }
    });
  };

  const match = !editing && !linked ? matches[0] : null;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(canSchedule ? "schedule" : "lead");
      }}
      className="flex flex-col gap-[var(--section-gap)]"
    >
      <section aria-labelledby="caller-h" className="flex flex-col gap-3">
        <h2
          id="caller-h"
          className="px-1 text-subhead font-semibold text-label-2"
        >
          Caller
        </h2>
        <PhoneField
          label="Phone"
          name="phone"
          value={phone}
          onValueChange={setPhone}
          error={err("phone")}
          autoFocus={!editing}
          disabled={editing}
          hint={editing ? "Saved with the lead" : undefined}
        />
        {match && (
          <output className="list-card enter-rise flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_var(--tint-a),transparent)] text-accent-text"
            >
              <UserRound size={20} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-footnote text-label-2">
                Returning customer
              </span>
              <span className="truncate text-headline">
                {match.name}
                <span className="font-normal text-label-2">
                  {" · "}
                  {match.jobs} job{match.jobs === 1 ? "" : "s"}
                </span>
              </span>
            </span>
            <Button
              variant="tinted"
              size="sm"
              onClick={() => applyMatch(match)}
              aria-label={`Use ${match.name}'s details`}
            >
              Use
            </Button>
          </output>
        )}
        {linked && (
          <p className="flex items-center gap-2 px-1 text-footnote text-label-2">
            <Check aria-hidden size={16} className="text-success" />
            Linked to {linked.name}
            {linked.address ? "; their address is filled in" : ""}
          </p>
        )}
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          error={err("name")}
          maxLength={200}
        />
      </section>

      <section aria-labelledby="addr-h" className="flex flex-col gap-3">
        <h2
          id="addr-h"
          className="px-1 text-subhead font-semibold text-label-2"
        >
          Service address
        </h2>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
          <TextField
            label="Street"
            name="street"
            autoComplete="address-line1"
            placeholder="12 Oak St"
            value={street}
            onChange={(e) => setStreet(e.currentTarget.value)}
            error={err("street")}
            maxLength={200}
          />
          <TextField
            label="Unit"
            name="unit"
            autoComplete="address-line2"
            placeholder="Apt"
            value={unit}
            onChange={(e) => setUnit(e.currentTarget.value)}
            maxLength={40}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_72px_104px] gap-3">
          <TextField
            label="City"
            name="city"
            autoComplete="address-level2"
            placeholder={cityHint ?? "City"}
            value={city}
            onChange={(e) => setCity(e.currentTarget.value)}
            maxLength={80}
          />
          <TextField
            label="State"
            name="state"
            autoComplete="address-level1"
            value={state}
            onChange={(e) =>
              setState(e.currentTarget.value.toUpperCase().slice(0, 2))
            }
            maxLength={2}
          />
          <TextField
            label="ZIP"
            name="zip"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder={zipHint ?? "ZIP"}
            value={zip}
            onChange={(e) => setZip(e.currentTarget.value)}
            error={err("zip")}
            maxLength={10}
          />
        </div>
      </section>

      <section aria-labelledby="svc-h" className="flex flex-col gap-3">
        <h2 id="svc-h" className="px-1 text-subhead font-semibold text-label-2">
          What do they need?
        </h2>
        {/* biome-ignore lint/a11y/useSemanticElements: chip group */}
        <div
          role="group"
          aria-labelledby="svc-h"
          className="flex flex-wrap gap-2"
        >
          {services.map((s) => (
            <Chip
              key={s.id}
              selected={serviceId === s.id}
              onClick={() => setServiceId(serviceId === s.id ? null : s.id)}
            >
              {s.name}
            </Chip>
          ))}
          <Chip
            selected={serviceId === "other"}
            onClick={() => setServiceId(serviceId === "other" ? null : "other")}
          >
            Other
          </Chip>
        </div>
        {serviceId === "other" && (
          <TextField
            label="Describe it"
            name="service"
            placeholder="e.g. Garage door won't close"
            defaultValue={defaults.service}
            maxLength={120}
          />
        )}
        <TextArea
          label="Notes"
          name="notes"
          rows={3}
          maxLength={5000}
          defaultValue={defaults.notes}
          placeholder="Gate code, pets, what they told you"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Source"
          name="sourceId"
          required
          defaultValue={defaults.sourceId ?? ""}
          error={err("sourceId")}
          options={[
            { value: "", label: "Choose a source", disabled: true },
            ...sources.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <MoneyField
          label="Quoted price"
          placeholder="Optional"
          valueCents={priceCents}
          onChangeCents={setPriceCents}
          error={err("price") ?? err("priceCents")}
        />
      </section>

      <label className="list-card flex min-h-11 items-start gap-3 px-4 py-3 text-footnote text-label-2">
        <input
          type="checkbox"
          name="smsConsent"
          defaultChecked={defaults.smsConsent}
          disabled={editing}
          className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-subhead font-medium text-label">
            They agreed to texts (verbal)
          </span>
          Read this to them first: “{consentText}”
        </span>
      </label>

      {!editing && (
        <details
          className="group list-card px-4 py-1"
          open={moreOpen}
          onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-subhead font-medium text-label">
            More details
            <span
              aria-hidden
              className="ml-auto text-label-3 transition-transform group-open:rotate-90"
            >
              ›
            </span>
          </summary>
          <div className="flex flex-col gap-3 pb-4 pt-1">
            <TextField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              error={err("email")}
            />
            {moreOpen && customDefs.length > 0 && (
              <CustomFieldsFields defs={customDefs} values={{}} />
            )}
          </div>
        </details>
      )}

      {errors._ && (
        <p role="alert" className="px-1 text-footnote text-danger">
          {errors._[0]}
        </p>
      )}

      <BottomBar
        label="Save"
        className="[&_.bottom-bar-actions]:flex-1 [&_.bottom-bar-in]:pl-2.5"
        secondary={
          <Button
            variant="secondary"
            size="lg"
            className={cx(canSchedule ? "flex-1" : "hidden")}
            loading={pending && intent === "lead"}
            disabled={pending}
            onClick={() => submit("lead")}
          >
            Save lead only
          </Button>
        }
        action={
          canSchedule ? (
            <Button
              type="submit"
              size="lg"
              className="flex-[1.3]"
              loading={pending && intent === "schedule"}
              disabled={pending}
            >
              Save &amp; schedule
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="flex-1"
              loading={pending}
            >
              Save lead
            </Button>
          )
        }
      />
    </form>
  );
}
