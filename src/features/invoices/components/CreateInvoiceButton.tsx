"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { createInvoiceForJob } from "../actions";

/** Start the job's draft invoice (deposits already paid are applied). */
export function CreateInvoiceButton({
  jobId,
  open = false,
}: {
  jobId: string;
  /** Navigate to the invoice after creating it. */
  open?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="tinted"
      icon={<Plus size={18} aria-hidden />}
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await createInvoiceForJob({ jobId });
          if (!r.ok) toast({ title: r.error, tone: "error" });
          else if (open && r.data) router.push(`/invoices/${r.data.invoiceId}`);
        })
      }
    >
      Start invoice
    </Button>
  );
}
