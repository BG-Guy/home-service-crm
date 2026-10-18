"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CustomerPicker } from "@/features/customers/slots.client";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { ListGroup, ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { createEstimate } from "../actions";

// /estimates/new: pick the customer (S3) and an optional title, then jump into the
// builder. Job and lead context arrive as hidden fields.

export function NewEstimateForm({
  jobId,
  leadId,
  defaultCustomerId,
  defaultPropertyId,
  defaultTitle,
  lockCustomer,
}: {
  jobId?: string;
  leadId?: string;
  defaultCustomerId?: string;
  defaultPropertyId?: string;
  defaultTitle?: string;
  /** From a job: the customer is fixed. */
  lockCustomer?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [hasCustomer, setHasCustomer] = useState(!!defaultCustomerId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await createEstimate(fd);
          if (r.ok && r.data) {
            toast({
              title: `Estimate ${r.data.number} started`,
              tone: "success",
            });
            router.replace(`/estimates/${r.data.estimateId}`);
          } else if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            toast({ title: r.error, tone: "error" });
          }
        });
      }}
    >
      {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      <ListGroup>
        <ListSection
          header="Customer"
          footer={
            lockCustomer
              ? "This estimate belongs to the job's customer and service address."
              : undefined
          }
        >
          {lockCustomer && defaultCustomerId ? (
            <>
              <input
                type="hidden"
                name="customer.customerId"
                value={defaultCustomerId}
              />
              <input
                type="hidden"
                name="customer.propertyId"
                value={defaultPropertyId ?? ""}
              />
              <p className="px-4 py-3 text-body">From the job</p>
            </>
          ) : (
            <div className="px-4 py-3">
              <CustomerPicker
                name="customer"
                defaultCustomerId={defaultCustomerId}
                defaultPropertyId={defaultPropertyId}
                onChange={(v) => setHasCustomer(!!v.customerId)}
              />
              {errors["customer.customerId"]?.[0] ? (
                <p role="alert" className="pt-2 text-footnote text-danger">
                  Pick a customer.
                </p>
              ) : null}
            </div>
          )}
        </ListSection>
        <ListSection header="Estimate">
          <div className="px-4 py-3">
            <TextField
              label="Title"
              name="title"
              defaultValue={defaultTitle}
              placeholder="e.g. Garage door spring replacement"
              maxLength={200}
              error={errors.title?.[0]}
            />
          </div>
        </ListSection>
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!hasCustomer}
        >
          Start estimate
        </Button>
      </ListGroup>
    </form>
  );
}
