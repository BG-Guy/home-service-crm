"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { CustomFieldsFields } from "@/features/settings/slots.client";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { PhoneField } from "@/ui/components/PhoneField";
import { toast } from "@/ui/components/Toast";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import { createLead } from "../actions";

const WINDOWS = [
  { value: "", label: "Any time" },
  { value: "morning", label: "Morning (8–12)" },
  { value: "afternoon", label: "Afternoon (12–5)" },
  { value: "evening", label: "Evening (5–8)" },
  { value: "asap", label: "ASAP / emergency" },
];

/** Manual lead entry (phone call, walk-in). "How did they hear about us?" is required. */
export function LeadForm({
  sources,
  services,
  defaultSourceId,
  consentText,
  customDefs,
}: {
  sources: { id: string; name: string }[];
  services: { id: string; name: string }[];
  defaultSourceId: string | null;
  consentText: string;
  customDefs: CustomFieldDef[];
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [serviceId, setServiceId] = useState("");
  const [pending, start] = useTransition();
  const err = (k: string) => errors[k];

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("clientId", crypto.randomUUID());
      const r = await createLead(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? { _: [r.error] });
        toast.error(r.error);
        return;
      }
      setErrors({});
      toast.success(r.data?.merged ? "Added to their open lead" : "Lead added");
      if (r.data?.leadId)
        router.push(`/leads/${r.data.leadId}`, {
          transitionTypes: NAV_FORWARD,
        });
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-[var(--section-gap)]"
    >
      <section className="flex flex-col gap-3">
        <Select
          label="How did they hear about us?"
          name="sourceId"
          required
          defaultValue={defaultSourceId ?? ""}
          error={err("sourceId")}
          options={[
            { value: "", label: "Choose a source", disabled: true },
            ...sources.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          error={err("name")}
          maxLength={200}
        />
        <PhoneField label="Phone" name="phone" error={err("phone")} />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={err("email")}
        />
        <TextField
          label="Service address"
          name="address"
          placeholder="12 Oak St, Austin, TX 78701"
          error={err("address")}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Select
          label="Service"
          name="serviceTypeId"
          value={serviceId}
          onChange={(e) => setServiceId(e.currentTarget.value)}
          options={[
            { value: "", label: "Other / describe below" },
            ...services.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        {!serviceId && (
          <TextField
            label="What do they need?"
            name="service"
            placeholder="e.g. Locked out of car"
            maxLength={120}
          />
        )}
        <MoneyField
          label="Quoted price"
          name="priceCents"
          placeholder="Optional"
          error={err("price")}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Preferred date"
            name="preferredDate"
            type="date"
            error={err("preferred_date") ?? err("preferredDate")}
          />
          <Select
            label="Time window"
            name="preferredWindow"
            defaultValue=""
            options={WINDOWS}
          />
        </div>
        <TextArea label="Notes" name="notes" rows={3} maxLength={5000} />
      </section>

      {customDefs.length > 0 && (
        <section className="flex flex-col gap-3">
          <CustomFieldsFields defs={customDefs} values={{}} />
        </section>
      )}

      <label className="list-card flex min-h-11 items-start gap-3 px-4 py-3 text-footnote text-label-2">
        <input
          type="checkbox"
          name="smsConsent"
          className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-subhead font-medium text-label">
            They agreed to texts (verbal)
          </span>
          Read this to them first: “{consentText}”
        </span>
      </label>

      {errors._ && (
        <p role="alert" className="px-1 text-footnote text-[var(--sys-red)]">
          {errors._[0]}
        </p>
      )}
      <Button
        type="submit"
        variant="filled"
        size="lg"
        fullWidth
        loading={pending}
      >
        Add lead
      </Button>
    </form>
  );
}
