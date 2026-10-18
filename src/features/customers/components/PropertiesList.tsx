"use client";

import { KeyRound, MapPin, Plus, Star } from "lucide-react";
import { useState, useTransition } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { CustomFieldsFields } from "@/features/settings/slots.client";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { PhoneField } from "@/ui/components/PhoneField";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { deleteProperty, saveProperty } from "../actions";
import type { PropertyView } from "../contracts";

const PROPERTY_TYPES = [
  { value: "house", label: "House" },
  { value: "condo", label: "Condo / townhome" },
  { value: "apartment", label: "Apartment" },
  { value: "commercial", label: "Commercial" },
  { value: "other", label: "Other" },
];

/** Service addresses with add/edit sheet (gate code encrypted at rest). */
export function PropertiesList({
  customerId,
  properties,
  canAdd,
  canEdit,
  defs,
}: {
  customerId: string;
  properties: PropertyView[];
  canAdd: boolean;
  canEdit: boolean;
  defs: CustomFieldDef[];
}) {
  const [editing, setEditing] = useState<PropertyView | "new" | null>(null);
  return (
    <>
      <ListSection
        header={
          properties.length > 1
            ? `Service addresses (${properties.length})`
            : "Service address"
        }
        footer={
          properties.some((p) => p.geocodeStatus === "failed")
            ? "We couldn't place one address on the map — check the street and ZIP."
            : undefined
        }
      >
        {properties.map((p) => (
          <ListRow
            key={p.id}
            icon={<MapPin size={17} />}
            iconTone={p.isPrimary ? "red" : "gray"}
            title={
              <span className="flex items-center gap-1.5">
                <span className="truncate">
                  {p.label ?? p.addressLine.split(",")[0]}
                </span>
                {p.isPrimary && properties.length > 1 && (
                  <Star
                    size={13}
                    className="shrink-0 fill-current text-warning"
                    aria-label="Primary"
                  />
                )}
                {p.hasGateCode && (
                  <KeyRound
                    size={13}
                    className="shrink-0 text-label-3"
                    aria-label="Has gate code"
                  />
                )}
              </span>
            }
            subtitle={
              p.label
                ? p.addressLine
                : p.addressLine.split(",").slice(1).join(",").trim()
            }
            onClick={canEdit ? () => setEditing(p) : undefined}
            accessory={canEdit ? "chevron" : "none"}
          />
        ))}
        {canAdd ? (
          <ListRow
            icon={<Plus size={17} />}
            iconStyle="tinted"
            title={<span className="text-accent-text">Add address</span>}
            onClick={() => setEditing("new")}
          />
        ) : null}
        {properties.length === 0 && !canAdd ? (
          <ListRow
            title={<span className="text-label-2">No service address yet</span>}
          />
        ) : null}
      </ListSection>
      <PropertySheet
        customerId={customerId}
        property={editing}
        onClose={() => setEditing(null)}
        defs={defs}
        canDelete={canEdit && properties.length > 0}
      />
    </>
  );
}

function PropertySheet({
  customerId,
  property,
  onClose,
  defs,
  canDelete,
}: {
  customerId: string;
  property: PropertyView | "new" | null;
  onClose: () => void;
  defs: CustomFieldDef[];
  canDelete: boolean;
}) {
  const p = property && property !== "new" ? property : null;
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [gateTouched, setGateTouched] = useState(false);
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const formId = "property-form";

  const submit = (fd: FormData) =>
    start(async () => {
      fd.set("customerId", customerId);
      if (p) fd.set("id", p.id);
      if (p && !gateTouched) fd.set("keepGateCode", "on");
      const r = await saveProperty(fd);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? { _: [r.error] });
        return;
      }
      setErrors({});
      toast.success(p ? "Address saved" : "Address added");
      onClose();
    });

  const remove = async () => {
    if (!p) return;
    if (
      !(await confirm({
        title: "Remove this address?",
        message:
          "Past jobs keep their address. You can't remove an address with open jobs.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    const r = await deleteProperty({ customerId, propertyId: p.id });
    if (r.ok) {
      toast.success("Address removed");
      onClose();
    } else toast.error(r.error);
  };

  return (
    <Sheet
      open={property != null}
      onOpenChange={(o) => !o && onClose()}
      title={p ? "Edit address" : "New address"}
      detents={["large"]}
      onClosed={() => {
        setErrors({});
        setGateTouched(false);
      }}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          type="submit"
          form={formId}
          loading={pending}
          className="font-semibold"
        >
          Save
        </Button>
      }
    >
      {confirmEl}
      <form
        id={formId}
        key={p?.id ?? "new"}
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 pb-8"
      >
        <TextField
          label="Label"
          name="label"
          placeholder="Home, Rental #2…"
          defaultValue={p?.label ?? ""}
        />
        <TextField
          label="Street"
          name="street"
          autoComplete="address-line1"
          defaultValue={p?.street ?? ""}
          error={errors.street}
        />
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <TextField
            label="City"
            name="city"
            autoComplete="address-level2"
            defaultValue={p?.city ?? ""}
            error={errors.city}
          />
          <TextField label="Unit" name="unit" defaultValue={p?.unit ?? ""} />
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-3">
          <TextField
            label="State"
            name="state"
            maxLength={2}
            className="uppercase"
            defaultValue={p?.state ?? ""}
            error={errors.state}
          />
          <TextField
            label="ZIP"
            name="zip"
            inputMode="numeric"
            defaultValue={p?.zip ?? ""}
            error={errors.zip}
          />
        </div>
        <Select
          label="Property type"
          name="propertyType"
          placeholder="—"
          defaultValue={p?.propertyType ?? ""}
          options={PROPERTY_TYPES}
        />
        <TextArea
          label="Access notes"
          name="accessNotes"
          rows={2}
          defaultValue={p?.accessNotes ?? ""}
        />
        <TextField
          label="Gate / door code"
          name="gateCode"
          autoComplete="off"
          defaultValue={p?.gateCode ?? ""}
          placeholder={p?.hasGateCode && !p.gateCode ? "•••• (unchanged)" : ""}
          onChange={() => setGateTouched(true)}
          hint="Encrypted at rest. Techs see it only during the job window."
        />
        <TextField label="Pets" name="pets" defaultValue={p?.pets ?? ""} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Site contact"
            name="siteContactName"
            defaultValue={p?.siteContactName ?? ""}
          />
          <PhoneField
            label="Site phone"
            name="siteContactPhone"
            defaultValue={p?.siteContactPhone ?? ""}
            error={errors.siteContactPhone}
          />
        </div>
        {defs.length > 0 && (
          <CustomFieldsFields defs={defs} values={p?.custom ?? {}} />
        )}
        <ListSection>
          <ToggleRow
            title="Primary address"
            name="isPrimary"
            defaultChecked={p?.isPrimary ?? false}
          />
        </ListSection>
        {p && p.geocodeStatus !== "ok" && p.geocodeStatus !== "manual" && (
          <Pill tone="orange" size="sm" className="self-start">
            {p.geocodeStatus === "failed"
              ? "Not found on the map"
              : "Locating on the map…"}
          </Pill>
        )}
        {errors._ && (
          <p className="text-footnote text-danger">{errors._.join(" ")}</p>
        )}
        {p && canDelete && (
          <Button variant="gray" className="mt-2 text-danger" onClick={remove}>
            Remove address
          </Button>
        )}
      </form>
    </Sheet>
  );
}
