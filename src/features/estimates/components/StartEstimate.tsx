"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { newId } from "@/lib/ids";
import { Spinner } from "@/ui/components/Spinner";
import { createEstimate } from "../actions";

// /estimates/new?jobId=… (Quote to Paid E2): from a job there is nothing to ask,
// so the draft starts at once ("Starting the estimate") and the URL becomes the
// builder. On an error the usual form shows instead (its own chunk).

const NewEstimateForm = dynamic(() =>
  import("./NewEstimateForm").then((m) => m.NewEstimateForm),
);

export function StartEstimateFromJob({
  jobId,
  customerId,
  propertyId,
  title,
}: {
  jobId: string;
  customerId: string;
  propertyId?: string;
  title?: string;
}) {
  const router = useRouter();
  // One clientId per visit: a second effect run (dev, a remount) gets the first
  // result back (action() receipts) instead of a second draft.
  const [clientId] = useState(newId);
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createEstimate({
      customer: { customerId, propertyId: propertyId ?? null },
      jobId,
      title,
      clientId,
    })
      .then((r) => {
        if (r.ok && r.data) router.replace(`/estimates/${r.data.estimateId}`);
        else setError(r.ok ? "Couldn't start the estimate." : r.error);
      })
      .catch(() =>
        setError("Couldn't start the estimate. Check your connection."),
      );
  }, [clientId, customerId, jobId, propertyId, router, title]);
  if (error)
    return (
      <div className="flex flex-col gap-4">
        <p
          role="alert"
          className="rounded-tile bg-fill-2 px-4 py-3 text-subhead text-danger"
        >
          {error} You can start it here instead.
        </p>
        <NewEstimateForm
          jobId={jobId}
          defaultCustomerId={customerId}
          defaultPropertyId={propertyId}
          defaultTitle={title}
          lockCustomer
        />
      </div>
    );
  return (
    <output className="flex flex-col items-center gap-3 py-16 text-center">
      <Spinner size={28} />
      <span className="text-headline text-label-2">Starting the estimate</span>
    </output>
  );
}
