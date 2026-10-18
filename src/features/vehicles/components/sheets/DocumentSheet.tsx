"use client";

import { useActionState, useState } from "react";
import { Button } from "@/ui/components/Button";
import { DateField, Select, TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { addVehicleDocument } from "../../actions";
import type { SheetVehicle } from "./OdometerSheet";
import { DocumentPicker, type Evidence, fe, newId, SheetSave } from "./shared";

const KINDS = [
  { value: "registration", label: "Registration" },
  { value: "insurance", label: "Insurance card" },
  { value: "inspection", label: "State inspection" },
  { value: "lease", label: "Lease" },
  { value: "title", label: "Title" },
  { value: "other", label: "Other" },
] as const;

/** Vehicle document with expiry (reminders 30/14/3 days before). */
export function DocumentSheet({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: SheetVehicle;
}) {
  const [clientId, setClientId] = useState(newId);
  const [kind, setKind] =
    useState<(typeof KINDS)[number]["value"]>("registration");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<Evidence | null>(null);
  const needsExpiry = ["registration", "insurance", "inspection"].includes(
    kind,
  );
  const formId = `doc-${clientId}`;

  const [state, run, pending] = useActionState(async () => {
    const r = await addVehicleDocument({
      vehicleId: vehicle.id,
      kind,
      mediaId: file?.mediaIds[0] ?? null,
      expiresOn: expiresOn || null,
      notes: notes || null,
      clientId,
    });
    if (r.ok) {
      toast({
        title:
          r.data?.status === "approved"
            ? "Document saved"
            : "Document sent for review",
        tone: r.data?.status === "approved" ? "success" : "default",
      });
      onOpenChange(false);
      setClientId(newId());
      setExpiresOn("");
      setNotes("");
      setFile(null);
    }
    return r;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add document"
      dirty={!!file || expiresOn !== ""}
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave form={formId} pending={pending} disabled={!file}>
          Save document
        </SheetSave>
      }
    >
      <form id={formId} action={run} className="flex flex-col gap-4 pb-4 pt-1">
        <p className="text-subhead text-label-2">{vehicle.nickname}</p>
        <Select
          label="Document"
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as typeof kind)}
          options={KINDS}
        />
        <DateField
          label={needsExpiry ? "Expires" : "Expires (optional)"}
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.currentTarget.value)}
          error={fe(errors, "expiresOn")}
          hint={
            needsExpiry
              ? "You'll be reminded 30, 14 and 3 days before."
              : undefined
          }
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">File</span>
          <DocumentPicker
            entityType="document"
            entityId={clientId}
            onChange={setFile}
          />
          {fe(errors, "mediaId") && (
            <p role="alert" className="text-footnote text-danger">
              {fe(errors, "mediaId")}
            </p>
          )}
        </div>
        <TextArea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
        {state && !state.ok && !errors && (
          <p role="alert" className="text-footnote text-danger">
            {state.error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
