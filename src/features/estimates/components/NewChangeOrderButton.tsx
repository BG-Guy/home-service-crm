"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { createChangeOrder } from "../actions";

/** Start a change order for the job (reason first, then lines on its own screen). */
export function NewChangeOrderButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        icon={<Plus size={16} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Change order
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New change order"
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      >
        <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
          <TextArea
            label="What changed?"
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="e.g. Second spring is cracked too; replace both"
          />
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={reason.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await createChangeOrder({ jobId, reason });
                if (r.ok && r.data) {
                  setOpen(false);
                  router.push(`/estimates/co/${r.data.changeOrderId}`);
                } else if (!r.ok) toast({ title: r.error, tone: "error" });
              })
            }
          >
            Continue
          </Button>
        </div>
      </Sheet>
    </>
  );
}
