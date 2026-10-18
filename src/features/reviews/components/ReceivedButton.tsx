"use client";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { markReviewReceived } from "../actions";

/** Manual "review received" log (feeds review-bonus spiffs; never about sentiment). */
export function ReceivedButton({
  reviewRequestId,
}: {
  reviewRequestId: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="tinted"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const res = await markReviewReceived({ reviewRequestId });
        setBusy(false);
        if (res.ok) toast({ title: "Review logged", tone: "success" });
        else
          toast({
            title: "Couldn't log it",
            message: res.error,
            tone: "error",
          });
      }}
    >
      Got a review
    </Button>
  );
}
