"use client";

import { Check, ClipboardList, UserRound } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { JobTypePicker } from "@/features/jobs/components/JobTypePicker";
import {
  type JobTypeRow,
  type JobTypeValue,
  OTHER_JOB,
  serviceTypeFor,
  valueFromType,
} from "@/features/jobs/components/job-type-choice";
import type { JobKind } from "@/features/jobs/kinds";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { formatRelative } from "@/lib/time";
import { BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { PhoneField } from "@/ui/components/PhoneField";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import { createLeadAndCustomer, lookupCaller } from "../../actions";
import type { CallerLookup, CallerMatch, LeadPriority } from "../../contracts";
import { BookingSteps } from "./BookingSteps";
import { useKeepFocusVisible } from "./keep-focus-visible";
import { UrgencyFields } from "./UrgencyFields";

// Who (and What) of the booking flow (/leads/new), built for use while on the
// phone and laid out to fit the first phone screen: phone and name, then source,
// quoted price and the text consent, the address, and the job type tiles. Returning
// callers pop up as you type; when they already have an open lead the office
// decides to update it or start a new one. Urgency and after-hours carry into the
// job at booking.

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
  kind: JobKind | null;
  service: string;
  notes: string;
  sourceId: string | null;
  priceCents: number | null;
  smsConsent: boolean;
  priority: LeadPriority;
  afterHours: boolean;
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
const AFTER_HOURS_RE = /after[\s-]?hours/i;

type Choice = { mode: "update"; leadId: string } | { mode: "new" } | null;

const statusWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CallerForm({
  defaults,
  sources,
  types,
  zipHint,
  cityHint,
  consentText,
  customDefs,
  canSchedule,
}: {
  defaults: CallerDefaults;
  sources: { id: string; name: string }[];
  /** Live job types (`listServiceTypeOptions()`). */
  types: JobTypeRow[];
  zipHint: string | null;
  cityHint: string | null;
  consentText: string;
  customDefs: CustomFieldDef[];
  canSchedule: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const choiceRef = useRef<HTMLDivElement>(null);
  useKeepFocusVisible(formRef);
  const editing = !!defaults.leadId;
  const [phone, setPhone] = useState(defaults.phone);
  const [name, setName] = useState(defaults.name);
  const [street, setStreet] = useState(defaults.street);
  const [unit, setUnit] = useState(defaults.unit);
  const [city, setCity] = useState(defaults.city);
  const [state, setState] = useState(defaults.state);
  const [zip, setZip] = useState(defaults.zip);
  const [type, setType] = useState<JobTypeValue>(() =>
    valueFromType(
      types,
      defaults.serviceTypeId,
      defaults.kind,
      defaults.service,
    ),
  );
  const [priority, setPriority] = useState<LeadPriority>(defaults.priority);
  const [afterHours, setAfterHours] = useState(defaults.afterHours);
  const [priceCents, setPriceCents] = useState(defaults.priceCents);
  const [lookup, setLookup] = useState<CallerLookup>({
    matches: [],
    openLeads: [],
  });
  const [linked, setLinked] = useState<CallerMatch | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
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
    if (digits(phone).length < 10) {
      setLookup({ matches: [], openLeads: [] });
      return;
    }
    const seq = ++lookupSeq.current;
    const t = setTimeout(() => {
      lookupCaller(phone)
        .then((r) => {
          if (seq === lookupSeq.current) setLookup(r);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [phone, editing]);
  useEffect(() => {
    if (
      linked &&
      !lookup.matches.some((m) => m.customerId === linked.customerId)
    )
      setLinked(null);
    if (
      choice?.mode === "update" &&
      !lookup.openLeads.some((o) => o.id === choice.leadId)
    )
      setChoice(null);
  }, [lookup, linked, choice]);

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

  const pickType = (v: JobTypeValue) => {
    setType(v);
    // "After-hours lockout" and the like turn the after-hours switch on.
    const job = types.find((t) => t.id === v.job);
    if (job && AFTER_HOURS_RE.test(job.name)) setAfterHours(true);
  };

  const whoDone =
    (digits(phone).length >= 10 || name.trim().length > 0) &&
    street.trim().length > 0 &&
    zip.trim().length > 0;

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
    const payload = {
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
      kind: type.kind ?? undefined,
      serviceTypeId: serviceTypeFor(types, type) ?? "",
      service: type.job === OTHER_JOB ? text("service") : "",
      priority,
      afterHours,
      priceCents: priceCents ?? undefined,
      notes: text("notes"),
      smsConsent: fd.get("smsConsent") === "on",
      ...(Object.keys(custom).length ? { custom } : {}),
      // Repeat caller (contract 3.2): the office's answer to "Update their open
      // lead or start a new one?".
      ...(choice?.mode === "update"
        ? { mergeIntoLeadId: choice.leadId }
        : choice?.mode === "new"
          ? { forceNew: true as const }
          : {}),
      clientId: crypto.randomUUID(),
    };
    start(async () => {
      const r = await createLeadAndCustomer(payload);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? { _: [r.error] });
        toast.error(r.error);
        return;
      }
      setErrors({});
      const data = r.data;
      if (data?.needsChoice) {
        // They already have an open lead: nothing was saved; ask first.
        setLookup((l) => ({ ...l, openLeads: data.openLeads ?? l.openLeads }));
        toast.warning("They already have an open lead", {
          message: "Update it or start a new one, then save again.",
        });
        requestAnimationFrame(() =>
          choiceRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        );
        return;
      }
      const leadId = data?.leadId;
      if (!leadId) return;
      if (which === "schedule") {
        // Back from When returns to this lead's values, not an empty form.
        window.history.replaceState(null, "", `/leads/new?leadId=${leadId}`);
        router.push(`/leads/new/schedule?leadId=${leadId}&from=call`, {
          transitionTypes: NAV_FORWARD,
        });
      } else {
        toast.success(
          data?.merged || choice?.mode === "update"
            ? "Their open lead is updated"
            : "Lead saved",
        );
        router.push(`/leads/${leadId}`, { transitionTypes: NAV_FORWARD });
      }
    });
  };

  const match = !editing && !linked ? lookup.matches[0] : null;
  const openLeads = editing ? [] : lookup.openLeads.slice(0, 3);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(canSchedule ? "schedule" : "lead");
      }}
      className="flex flex-col gap-4"
    >
      {canSchedule && <BookingSteps current={whoDone ? 2 : 1} />}

      <div className="grid gap-3 min-[360px]:grid-cols-2">
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
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          error={err("name")}
          maxLength={200}
        />
      </div>

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
        <p className="-mt-1 flex items-center gap-2 px-1 text-footnote text-label-2">
          <Check aria-hidden size={16} className="text-success" />
          Linked to {linked.name}
          {linked.address ? "; their address is filled in" : ""}
        </p>
      )}

      {openLeads.length > 0 && (
        <div
          ref={choiceRef}
          className="list-card enter-rise flex flex-col gap-3 px-4 py-3.5"
        >
          <p className="flex items-center gap-2 text-headline">
            <ClipboardList
              aria-hidden
              size={18}
              className="shrink-0 text-accent-text"
            />
            Update their open lead or start a new one?
          </p>
          <div
            role="radiogroup"
            aria-label="Their open lead"
            className="flex flex-col gap-2"
          >
            {openLeads.map((o) => (
              <ChoiceRow
                key={o.id}
                on={choice?.mode === "update" && choice.leadId === o.id}
                onPick={() => setChoice({ mode: "update", leadId: o.id })}
                title={
                  o.service
                    ? `Update their ${o.service} lead`
                    : "Update their open lead"
                }
                sub={[
                  statusWord(o.status),
                  formatRelative(o.createdAt),
                  o.address,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
            <ChoiceRow
              on={choice?.mode === "new"}
              onPick={() => setChoice({ mode: "new" })}
              title="Start a new lead"
              sub="Keep the open one as it is"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
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
      </div>

      {/* ⚖️ Verbal SMS consent: the script is read to them before the switch is set. */}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant */}
      <label className="list-card grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="text-subhead font-semibold text-label">
          They agreed to texts (verbal)
        </span>
        <Toggle
          name="smsConsent"
          defaultChecked={defaults.smsConsent}
          disabled={editing}
          className="shrink-0"
        />
        <span className="col-span-2 text-caption text-label-2">
          Read this to them first: “{consentText}”
        </span>
      </label>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-3">
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
        <div className="grid grid-cols-[minmax(0,1fr)_64px_96px] gap-3">
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
      </div>

      <JobTypePicker
        variant="tiles"
        types={types}
        value={type}
        onChange={pickType}
        error={err("serviceTypeId")?.[0] ?? err("kind")?.[0]}
      />
      {type.job === OTHER_JOB && (
        <TextField
          label="Describe it"
          name="service"
          placeholder="e.g. Garage door won't close"
          defaultValue={defaults.service}
          maxLength={120}
        />
      )}

      <UrgencyFields
        priority={priority}
        onPriority={setPriority}
        afterHours={afterHours}
        onAfterHours={setAfterHours}
      />

      <TextArea
        label="Notes"
        name="notes"
        rows={2}
        maxLength={5000}
        defaultValue={defaults.notes}
        placeholder="Gate code, pets, what they told you"
        hint={canSchedule ? "The tech sees these on the job." : undefined}
      />

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
              Save &amp; book
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

function ChoiceRow({
  on,
  onPick,
  title,
  sub,
}: {
  on: boolean;
  onPick: () => void;
  title: string;
  sub: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: list-row radio
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cx(
        "pressable flex min-h-[52px] w-full items-center gap-3 rounded-tile px-3 py-2 text-left transition-shadow duration-[var(--dur-quick)]",
        on ? "ring-2 ring-inset ring-accent" : "bg-fill-2",
      )}
      style={
        on
          ? {
              backgroundColor:
                "color-mix(in srgb, var(--accent) 8%, var(--card))",
            }
          : undefined
      }
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-subhead font-semibold text-label">
          {title}
        </span>
        <span className="truncate text-footnote text-label-2">{sub}</span>
      </span>
      <span
        aria-hidden
        className={cx(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          on
            ? "bg-accent-fill text-on-accent"
            : "shadow-[inset_0_0_0_1.5px_var(--label-3)]",
        )}
      >
        {on && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}
