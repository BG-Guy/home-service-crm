"use client";

import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { requestReview, reviewButtonState } from "./actions";
import type { RequestReviewButtonProps } from "./contracts";

// Client UI slots produced by B5 (BUILD_PLAN §5.1). Client slots take serializable
// props and call only the producer's own actions.

type ButtonState =
  | { visible: false }
  | {
      visible: true;
      jobId: string | null;
      eligible: boolean;
      reason: string | null;
      sentCount: number;
    };

/**
 * S37 — Request a review (office/admin with reviews.send_manual; never for techs).
 * Enforces the two-ask limit and eligibility on the server; renders nothing when the
 * viewer can't use it or the reviews flag is off.
 */
export function RequestReviewButton({
  jobId,
  customerId,
}: RequestReviewButtonProps) {
  const [st, setSt] = useState<ButtonState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, dialog] = useConfirm();

  useEffect(() => {
    let alive = true;
    reviewButtonState({ jobId, customerId }).then((res) => {
      if (alive)
        setSt(
          res.ok && res.data ? (res.data as ButtonState) : { visible: false },
        );
    });
    return () => {
      alive = false;
    };
  }, [jobId, customerId]);

  if (!st || !st.visible) return null;
  const label = st.sentCount > 0 ? "Ask again for a review" : "Request review";
  return (
    <>
      <Button
        variant="gray"
        size="sm"
        icon={<Star aria-hidden size={16} />}
        disabled={!st.eligible || busy || !st.jobId}
        loading={busy}
        title={st.reason ?? undefined}
        onClick={async () => {
          if (!st.jobId) return;
          const ok = await confirm({
            title: label,
            message:
              st.sentCount > 0
                ? "This is the second and last ask for this job."
                : "We'll text (or email) the customer a link to your Google reviews.",
            confirmLabel: "Send",
          });
          if (!ok) return;
          setBusy(true);
          const res = await requestReview({ jobId: st.jobId });
          setBusy(false);
          if (!res.ok) {
            toast({ title: "Not sent", message: res.error, tone: "error" });
            return;
          }
          toast({
            title:
              res.data?.status === "pending_tap"
                ? "Review request is in your outbox"
                : "Review request queued",
            tone: "success",
            action:
              res.data?.status === "pending_tap"
                ? {
                    label: "Open",
                    onPress: () => {
                      window.location.href = "/messages/outbox";
                    },
                  }
                : undefined,
          });
          setSt({
            ...st,
            eligible: st.sentCount + 1 < 2,
            sentCount: st.sentCount + 1,
          });
        }}
      >
        {label}
      </Button>
      {!st.eligible && st.reason && (
        <span className="sr-only">{st.reason}</span>
      )}
      {dialog}
    </>
  );
}
