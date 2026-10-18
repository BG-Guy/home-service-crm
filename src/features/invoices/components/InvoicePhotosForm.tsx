"use client";

import { useState, useTransition } from "react";
import { PhotoPicker } from "@/features/media/slots.client";
import { Button } from "@/ui/components/Button";
import { ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { setInvoicePhotos } from "../actions";

// Before/after photos on the invoice (M08): the per-invoice toggle plus an ordered
// selection through B4's PhotoPicker (S25). An empty selection lets the embedding
// cascade pick (starred, then the latest 2 before + 2 after).

export function InvoicePhotosForm({
  invoiceId,
  jobId,
  showPhotos,
  selected,
  locked,
}: {
  invoiceId: string;
  jobId: string;
  showPhotos: boolean;
  selected: string[];
  /** Issued invoices: newly chosen photos become evidence-locked. */
  locked: boolean;
}) {
  const [on, setOn] = useState(showPhotos);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await setInvoicePhotos(fd);
          if (r.ok) {
            toast({ title: "Photos updated", tone: "success" });
          } else toast({ title: r.error, tone: "error" });
        });
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <ListSection
        header="Photos on invoice"
        footer={
          locked
            ? "Photos printed on an issued invoice are kept as evidence and can't be deleted."
            : "Leave the selection empty to use starred photos, else the latest 2 before + 2 after."
        }
      >
        <ToggleRow
          title="Show before/after photos"
          name="showPhotos"
          checked={on}
          onChange={(e) => setOn(e.currentTarget.checked)}
        />
        {on ? (
          <div className="px-4 py-3">
            <PhotoPicker
              jobId={jobId}
              name="photoMediaIds"
              selected={selected}
              max={8}
              tags={["before", "after", "problem", "during"]}
            />
          </div>
        ) : null}
      </ListSection>
      <div className="mt-2 flex justify-end px-1">
        <Button type="submit" size="sm" variant="tinted" loading={pending}>
          Save photos
        </Button>
      </div>
    </form>
  );
}
