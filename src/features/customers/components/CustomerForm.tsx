"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { CustomFieldsFields } from "@/features/settings/slots.client";
import { AddressAutocomplete } from "@/ui/components/AddressAutocomplete";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { PhoneField } from "@/ui/components/PhoneField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { phoneDigits } from "@/ui/format/phone";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import {
  checkCustomerDuplicates,
  createCustomer,
  updateCustomer,
} from "../actions";
import type {
  CustomerEditable,
  CustomerType,
  DuplicateCandidate,
} from "../contracts";

const TYPES: { value: CustomerType; label: string }[] = [
  { value: "residential", label: "Home" },
  { value: "commercial", label: "Business" },
  { value: "property_manager", label: "Prop. mgr" },
  { value: "home_warranty", label: "Warranty" },
];

const CHANNEL_OPTIONS = [
  { value: "sms", label: "Text message" },
  { value: "call", label: "Phone call" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
];

export interface CustomerFormProps {
  mode: "create" | "edit";
  initial?: CustomerEditable;
  customDefs: CustomFieldDef[];
  propertyDefs?: CustomFieldDef[];
  leadSources?: { id: string; name: string }[];
  consentText?: string;
  /** Pre-filled state for the service address (the company's state). */
  defaultState?: string | null;
  /** Called after a successful save (edit sheet closes itself). */
  onSaved?: (id: string) => void;
  /** Render without the outer submit button (sheet supplies its own). */
  formId?: string;
}

/**
 * Create/edit customer form. Create mode adds the service address, the "How did
 * you hear about us?" source, verbal SMS consent and the duplicate prompt.
 */
export function CustomerForm({
  mode,
  initial,
  customDefs,
  propertyDefs = [],
  leadSources = [],
  consentText,
  defaultState,
  onSaved,
  formId,
}: CustomerFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<CustomerType>(
    initial?.type ?? "residential",
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [dups, setDups] = useState<DuplicateCandidate[]>([]);
  const [force, setForce] = useState(false);
  const [pending, start] = useTransition();
  const business = type !== "residential";

  const probe = async () => {
    if (mode !== "create" || !formRef.current) return;
    const fd = new FormData(formRef.current);
    const phone = String(fd.get("phone") ?? "");
    const email = String(fd.get("email") ?? "");
    const street = String(fd.get("address.street") ?? "");
    const zip = String(fd.get("address.zip") ?? "");
    if (
      phoneDigits(phone).length < 10 &&
      !email.includes("@") &&
      !(street && zip)
    )
      return;
    const found = await checkCustomerDuplicates({
      phone,
      email,
      street,
      zip,
    }).catch(() => []);
    setDups(found);
  };

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("type", type);
      if (mode === "edit" && initial) {
        fd.set("id", initial.id);
        const r = await updateCustomer(fd);
        if (!r.ok) {
          setErrors(r.fieldErrors ?? { _: [r.error] });
          toast.error(r.error);
          return;
        }
        setErrors({});
        toast.success("Customer saved");
        onSaved?.(initial.id);
        return;
      }
      if (force) fd.set("force", "on");
      const r = await createCustomer(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? { _: [r.error] });
        toast.error(r.error);
        return;
      }
      setErrors({});
      if (r.data?.duplicates.length) {
        setDups(r.data.duplicates);
        setForce(true);
        toast.warning("Possible duplicate", {
          message: "Use the existing customer, or tap “Create anyway”.",
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (r.data?.customerId) {
        toast.success("Customer added");
        onSaved?.(r.data.customerId);
        router.push(`/customers/${r.data.customerId}`, {
          transitionTypes: NAV_FORWARD,
        });
      }
    });

  const err = (k: string) => errors[k];

  return (
    <form
      id={formId}
      ref={formRef}
      // onSubmit, not `action`: React resets uncontrolled fields after a form
      // action resolves, which wiped everything typed on a validation error (T2-10).
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-[var(--section-gap)]"
    >
      {dups.length > 0 && (
        <div className="flex flex-col gap-2">
          <Banner tone="warning" title="This might be a duplicate">
            A customer with the same phone, email or address already exists.
          </Banner>
          <ListSection>
            {dups.map((d) => (
              <ListRow
                key={d.id}
                leading={<Avatar name={d.displayName} seed={d.id} size={34} />}
                title={d.displayName}
                subtitle={[
                  d.reason === "address" ? "Same address" : `Same ${d.reason}`,
                  d.phoneDisplay,
                  d.addressShort,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                href={`/customers/${d.id}`}
              />
            ))}
          </ListSection>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <SegmentedControl
          label="Customer type"
          segments={TYPES}
          value={type}
          onChange={setType}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="First name"
            name="firstName"
            autoComplete="given-name"
            defaultValue={initial?.firstName ?? ""}
            error={err("firstName")}
          />
          <TextField
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            defaultValue={initial?.lastName ?? ""}
            error={err("lastName")}
          />
        </div>
        {(business || initial?.companyName) && (
          <TextField
            label="Company"
            name="companyName"
            autoComplete="organization"
            defaultValue={initial?.companyName ?? ""}
            error={err("companyName")}
          />
        )}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: focus-out from the phone input triggers the duplicate probe */}
        <div onBlur={probe}>
          <PhoneField
            label="Mobile phone"
            name="phone"
            defaultValue={initial?.phone ?? ""}
            error={err("phone")}
          />
        </div>
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={initial?.email ?? ""}
          error={err("email")}
          onBlur={probe}
        />
        {mode === "edit" && (
          <PhoneField
            label="Other phone"
            name="phoneAlt"
            defaultValue={initial?.phoneAlt ?? ""}
            error={err("phoneAlt")}
          />
        )}
        <Select
          label="Prefers"
          name="preferredChannel"
          defaultValue={initial?.preferredChannel ?? "sms"}
          options={CHANNEL_OPTIONS}
        />
      </section>

      {mode === "create" && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-footnote uppercase text-label-2">
            Service address
          </h2>
          <AddressAutocomplete
            label="Street"
            name="address.street"
            error={err("address.street")}
            onBlur={probe}
            fill={{
              city: "address.city",
              state: "address.state",
              zip: "address.zip",
            }}
            focusAfter="address.unit"
          />
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <TextField
              label="City"
              name="address.city"
              autoComplete="address-level2"
              error={err("address.city")}
            />
            <TextField
              label="Unit"
              name="address.unit"
              autoComplete="address-line2"
            />
          </div>
          <div className="grid grid-cols-[88px_1fr] gap-3">
            <TextField
              label="State"
              name="address.state"
              maxLength={2}
              autoComplete="address-level1"
              autoCapitalize="characters"
              defaultValue={defaultState ?? ""}
              style={{ textTransform: "uppercase" }}
              error={err("address.state")}
            />
            <TextField
              label="ZIP"
              name="address.zip"
              inputMode="numeric"
              autoComplete="postal-code"
              error={err("address.zip")}
              onBlur={probe}
            />
          </div>
          <TextArea
            label="Access notes"
            name="address.accessNotes"
            rows={2}
            placeholder="Side gate, dog in yard, park on street…"
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Gate / door code"
              name="address.gateCode"
              autoComplete="off"
              hint="Encrypted; shown to techs only during the job."
            />
            <TextField label="Pets" name="address.pets" />
          </div>
          {propertyDefs.length > 0 && (
            <CustomFieldsFields
              defs={propertyDefs}
              values={{}}
              namePrefix="address.custom"
            />
          )}
        </section>
      )}

      {customDefs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-footnote uppercase text-label-2">Details</h2>
          <CustomFieldsFields
            defs={customDefs}
            values={initial?.custom ?? {}}
          />
        </section>
      )}

      {mode === "create" && leadSources.length > 0 && (
        <Select
          label="How did they hear about us?"
          name="leadSourceId"
          placeholder="Not sure"
          options={leadSources.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}

      <TextArea
        label="Notes"
        name="notes"
        rows={3}
        defaultValue={initial?.notes ?? ""}
        placeholder="Anything the team should know"
      />

      {mode === "create" && (
        <ListSection
          footer={
            consentText
              ? `Only if the customer said yes out loud. Recorded as verbal consent: “${consentText}”`
              : "Only if the customer said yes out loud."
          }
        >
          <ToggleRow title="Customer agreed to texts" name="smsConsent" />
        </ListSection>
      )}

      {errors._ && (
        <p role="alert" className="text-footnote text-danger">
          {errors._.join(" ")}
        </p>
      )}

      {!formId && (
        <Button type="submit" size="lg" fullWidth loading={pending}>
          {mode === "edit" ? "Save" : force ? "Create anyway" : "Add customer"}
        </Button>
      )}
    </form>
  );
}
