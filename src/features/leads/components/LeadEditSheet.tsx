"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { loadLeadEditOptions, updateLead } from "../actions";
import type { LeadBoxData, LeadCardData } from "../contracts";
import { useLeadEnv } from "./lead-env";

type Options = Awaited<ReturnType<typeof loadLeadEditOptions>>;

/**
 * Edit lead (a lazy chunk): the contact details (phone, email, address: the
 * build SPEC fix) and the request (service, price, preferred day, notes,
 * source). Sources and services load when it opens.
 */
export default function LeadEditSheet({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadBoxData & Partial<LeadCardData>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const env = useLeadEnv();
  const [opts, setOpts] = useState<Options | null>(null);
  const [dirty, setDirty] = useState(false);
  const [serviceId, setServiceId] = useState(lead.serviceTypeId ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const formId = `lead-edit-${lead.id}`;
  const a = lead.address;

  useEffect(() => {
    if (!open || opts) return;
    let live = true;
    loadLeadEditOptions()
      .then((o) => live && setOpts(o))
      .catch(() => live && setOpts({ sources: [], services: [] }));
    return () => {
      live = false;
    };
  }, [open, opts]);

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("leadId", lead.id);
      const cents = fd.get("priceCents");
      fd.delete("priceCents");
      if (cents) fd.set("price", (Number(cents) / 100).toFixed(2));
      const r = await updateLead(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        env.notify({ title: r.error, tone: "error" });
        return;
      }
      setErrors({});
      setDirty(false);
      onOpenChange(false);
      const fixed = r.data?.customerFields ?? [];
      env.notify({
        title: fixed.length
          ? `Lead updated. Also fixed on the customer: ${fixed.join(" and ")}`
          : "Lead updated",
        tone: "success",
      });
      env.changed(lead.id);
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit lead"
      dirty={dirty}
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          type="submit"
          form={formId}
          loading={pending}
        >
          Save
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        onChange={() => setDirty(true)}
        className="flex flex-col gap-3 pb-6"
      >
        <TextField
          label="Name"
          name="name"
          defaultValue={lead.name}
          autoComplete="off"
          error={errors.name}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={lead.phone ?? ""}
            autoComplete="off"
            error={errors.phone}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            defaultValue={lead.email ?? ""}
            autoComplete="off"
            error={errors.email}
          />
        </div>
        <TextField
          label="Street"
          name="street"
          defaultValue={a?.street ?? ""}
          autoComplete="off"
          error={errors.street}
        />
        <div className="grid grid-cols-[1fr_88px] gap-3">
          <TextField
            label="City"
            name="city"
            defaultValue={a?.city ?? lead.city ?? ""}
            autoComplete="off"
          />
          <TextField
            label="Unit"
            name="unit"
            defaultValue={a?.unit ?? ""}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="State"
            name="state"
            defaultValue={a?.state ?? ""}
            maxLength={2}
            autoComplete="off"
          />
          <TextField
            label="ZIP"
            name="zip"
            inputMode="numeric"
            defaultValue={a?.zip ?? lead.zip ?? ""}
            autoComplete="off"
            error={errors.zip}
          />
        </div>
        {lead.customerId && (
          <p className="-mt-1 text-footnote text-label-2">
            A fixed phone or email also fixes the customer record when it still
            has the old one.
          </p>
        )}
        <Select
          label="Source"
          name="sourceId"
          defaultValue={lead.sourceId ?? ""}
          key={`src-${opts ? 1 : 0}`}
          options={[
            { value: "", label: opts ? "Unknown" : "Loading…" },
            ...(opts?.sources ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            })),
          ]}
        />
        <Select
          label="Service"
          name="serviceTypeId"
          value={serviceId}
          onChange={(e) => setServiceId(e.currentTarget.value)}
          options={[
            { value: "", label: "Other" },
            ...(opts?.services ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            })),
          ]}
        />
        {!serviceId && (
          <TextField
            label="Describe the service"
            name="service"
            defaultValue={lead.serviceTypeId ? "" : (lead.serviceName ?? "")}
          />
        )}
        <MoneyField
          label="Quoted price"
          name="priceCents"
          defaultCents={lead.quoteCents}
          placeholder="Optional"
          error={errors.price}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Preferred date"
            name="preferredDate"
            type="date"
            defaultValue={lead.preferredDate ?? ""}
            error={errors.preferredDate}
          />
          <TextField
            label="Time window"
            name="preferredWindow"
            defaultValue={lead.preferredWindow ?? ""}
            placeholder="morning"
          />
        </div>
        <TextArea
          label="Notes"
          name="notes"
          rows={4}
          defaultValue={lead.notes ?? ""}
        />
      </form>
    </Sheet>
  );
}
