"use client";

import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import { confirmJobManual } from "../../actions";

/** "Mark confirmed" for the Unconfirmed-tomorrow list (customer replied by phone). */
export function ConfirmJobButton({ jobId }: { jobId: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done)
    return (
      <span className="shrink-0 px-2 text-footnote text-[var(--sys-green)]">
        Confirmed
      </span>
    );
  return (
    <Button
      size="sm"
      variant="gray"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await confirmJobManual({ jobId });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          haptic();
          setDone(true);
        })
      }
    >
      Confirm
    </Button>
  );
}
