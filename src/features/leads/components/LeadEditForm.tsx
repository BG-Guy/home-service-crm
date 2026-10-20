"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { updateLead } from "../actions";

import type { LeadEditable } from "./LeadEditSheet";

/** The edit-lead sheet itself; a lazy chunk of LeadEditSheet. */
export default function LeadEditForm({
  lead,
  sources,
  services,
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  lead: LeadEditable;
  sources: { id: string; name: string }[];
  services: { id: string; name: string }[];
}) {
  const [dirty, setDirty] = useState(false);
  const [serviceId, setServiceId] = useState(lead.serviceTypeId ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const formId = `lead-edit-${lead.id}`;

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("leadId", lead.id);
      const cents = fd.get("priceCents");
      fd.delete("priceCents");
      if (cents) fd.set("price", (Number(cents) / 100).toFixed(2));
      const r = await updateLead(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success("Lead updated");
      setDirty(false);
      setOpen(false);
    });

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Edit lead"
      dirty={dirty}
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
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
          error={errors.name}
        />
        <Select
          label="Source"
          name="sourceId"
          defaultValue={lead.sourceId ?? ""}
          options={[
            { value: "", label: "Unknown" },
            ...sources.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label="Service"
          name="serviceTypeId"
          value={serviceId}
          onChange={(e) => setServiceId(e.currentTarget.value)}
          options={[
            { value: "", label: "Other" },
            ...services.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        {!serviceId && (
          <TextField
            label="Describe the service"
            name="service"
            defaultValue={lead.service ?? ""}
          />
        )}
        <MoneyField
          label="Quoted price"
          name="priceCents"
          defaultCents={lead.quotedPriceCents}
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
