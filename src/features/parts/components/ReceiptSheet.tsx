"use client";

import { Camera, Check, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { newId } from "@/lib/ids";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { DateField, Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  fe,
  submitOffline,
  toastQueued,
} from "../../payroll/components/submit";

const CATEGORIES = [
  { value: "part", label: "Part for a job" },
  { value: "fuel", label: "Fuel" },
  { value: "vehicle", label: "Vehicle supplies" },
  { value: "tool", label: "Tool" },
  { value: "supplies", label: "Shop supplies" },
  { value: "other", label: "Other" },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "New receipt" (/parts?new=receipt): tech-paid or company-card, job or non-job. Offline-capable. */
export function NewReceiptButton({
  defaultOpen = false,
  trigger = true,
  jobs,
  vehicles,
}: {
  defaultOpen?: boolean;
  /**
   * false = no button of its own: the sheet opens from the header "+" menu
   * ("Upload receipt" → ?new=receipt), so the header has one "+" (QA T4-11).
   */
  trigger?: boolean;
  jobs: { id: string; label: string }[];
  vehicles: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(defaultOpen);
  const wantsNew = params.get("new") === "receipt";
  useEffect(() => {
    if (wantsNew) setOpen(true);
  }, [wantsNew]);
  const [clientId, setClientId] = useState(newId);
  const [paidBy, setPaidBy] = useState<"tech" | "company_card">("tech");
  const [category, setCategory] = useState("part");
  const [jobId, setJobId] = useState("");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [vendor, setVendor] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(today);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<{
    clientId: string;
    mediaId?: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);

  const close = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("new")) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(next.size ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    }
  };
  const reset = () => {
    setClientId(newId());
    setVendor("");
    setTotalCents(null);
    setNotes("");
    setReceipt(null);
    setErrors(undefined);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await submitOffline<{ status: string }>("parts.submitReceipt", {
      paidBy,
      category,
      jobId: category === "part" && jobId ? jobId : null,
      vehicleId:
        (category === "fuel" || category === "vehicle") && vehicleId
          ? vehicleId
          : null,
      vendor: vendor || null,
      purchasedOn,
      totalCents: totalCents ?? 0,
      receiptMediaId: receipt?.mediaId ?? null,
      receiptClientId: receipt?.clientId ?? null,
      notes: notes || null,
      clientId,
    });
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    if (r.queued) toastQueued("Receipt");
    else
      toast({
        title:
          r.data?.status === "approved"
            ? "Receipt approved"
            : "Receipt submitted",
        message:
          paidBy === "company_card"
            ? "Thanks: it's matched against the card statement."
            : r.data?.status === "approved"
              ? "The reimbursement is on your next statement."
              : "An admin will review it shortly.",
        tone: "success",
      });
    close(false);
    reset();
  };

  const formId = `receipt-${clientId}`;
  return (
    <>
      {trigger && (
        <Button
          size="sm"
          variant="tinted"
          icon={<Plus size={17} aria-hidden />}
          onClick={() => setOpen(true)}
        >
          Receipt
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={close}
        title="New receipt"
        detents={["large"]}
        dirty={totalCents != null || !!receipt}
        leading={
          <Button variant="plain" size="sm" onClick={() => close(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            type="submit"
            form={formId}
            size="lg"
            fullWidth
            loading={pending}
            disabled={!totalCents}
          >
            Submit receipt
          </Button>
        }
      >
        <form
          id={formId}
          onSubmit={submit}
          className="flex flex-col gap-4 pb-6 pt-1"
        >
          <SegmentedControl
            label="Who paid"
            value={paidBy}
            onChange={setPaidBy}
            segments={[
              { value: "tech", label: "I paid" },
              { value: "company_card", label: "Company card" },
            ]}
          />
          <CameraButton
            kind="receipt"
            tag="receipt"
            label={receipt ? "Retake photo" : "Photo of receipt"}
            multiple={false}
            variant="filled"
            fullWidth
            icon={
              receipt?.mediaId ? (
                <Check size={18} aria-hidden />
              ) : (
                <Camera size={18} aria-hidden />
              )
            }
            onQueued={(r) =>
              setReceipt({ clientId: r.clientId, mediaId: r.mediaId })
            }
            onUploaded={(r) =>
              setReceipt({ clientId: r.clientId, mediaId: r.mediaId })
            }
            onError={(err) =>
              toast({
                title: "Photo failed",
                message: err.message,
                tone: "error",
              })
            }
          />
          {fe(errors, "receiptMediaId") && (
            <p role="alert" className="text-footnote text-danger">
              {fe(errors, "receiptMediaId")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              label="Total"
              valueCents={totalCents}
              onChangeCents={setTotalCents}
              error={fe(errors, "totalCents")}
            />
            <DateField
              label="Date"
              value={purchasedOn}
              onChange={(e) => setPurchasedOn(e.currentTarget.value)}
            />
          </div>
          <TextField
            label="Store"
            placeholder="e.g. Home Depot"
            value={vendor}
            onChange={(e) => setVendor(e.currentTarget.value)}
          />
          <Select
            label="What it was for"
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value)}
            options={CATEGORIES}
          />
          {category === "part" && (
            <Select
              label="Job"
              value={jobId}
              onChange={(e) => setJobId(e.currentTarget.value)}
              options={[
                { value: "", label: "Not for a job" },
                ...jobs.map((j) => ({ value: j.id, label: j.label })),
              ]}
              hint="Parts for a job are deducted from that job's commission base."
            />
          )}
          {(category === "fuel" || category === "vehicle") &&
            vehicles.length > 0 && (
              <Select
                label="Vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.currentTarget.value)}
                options={vehicles.map((v) => ({ value: v.id, label: v.label }))}
              />
            )}
          <TextArea
            label="Note"
            placeholder="Optional"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            rows={2}
          />
          {error && !errors && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
        </form>
      </Sheet>
    </>
  );
}
