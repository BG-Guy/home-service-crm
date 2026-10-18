"use client";

import { Phone } from "lucide-react";
import { useState } from "react";
import { CallOutcomeSheet } from "@/features/customers/components/CallOutcomeSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { logLeadCall, startLeadCall } from "../actions";

/**
 * Claim + call: `tel:` opens the dialer, then the outcome sheet logs the call.
 * "No answer" drafts a follow-up text and a +15 min retry task (server side).
 */
export function LeadCallButton({
  leadId,
  variant = "tinted",
  size = "sm",
  label = "Call",
  className,
}: {
  leadId: string;
  variant?: "tinted" | "filled" | "gray";
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  const start = async () => {
    setBusy(true);
    const r = await startLeadCall({ leadId });
    setBusy(false);
    if (!r.ok || !r.data) {
      toast.error(r.ok ? "Couldn't start the call" : r.error);
      return;
    }
    if (
      r.data.doNotContact &&
      !(await confirm({
        title: "Do not contact",
        message: "This customer asked not to be contacted. Call anyway?",
        confirmLabel: "Call",
      }))
    )
      return;
    window.location.href = r.data.tel;
    setTimeout(() => setOpen(true), 600);
  };

  return (
    <>
      {confirmEl}
      <Button
        variant={variant}
        size={size}
        icon={<Phone size={16} aria-hidden />}
        onClick={start}
        loading={busy}
        className={className}
      >
        {label}
      </Button>
      <CallOutcomeSheet
        open={open}
        onOpenChange={setOpen}
        footnote="No answer or busy creates a call-back task in 15 minutes and drafts a text."
        onSave={async ({ outcome, notes }) => {
          const res = await logLeadCall({
            leadId,
            outcome,
            notes,
            clientId: crypto.randomUUID(),
          });
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(
            res.data?.retryTaskId
              ? res.data.textQueued
                ? "Logged · retry task + text drafted"
                : "Logged · retry in 15 min"
              : "Call logged",
          );
          return true;
        }}
      />
    </>
  );
}
