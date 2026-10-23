"use client";

import { Phone } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { startLeadCall } from "../actions";
import { CallOutcomeFlow } from "./CallOutcomeFlow";
import { useLeadEnv } from "./lead-env";
import { startPendingCall } from "./pending-call";

const warmSheet = () =>
  void import("@/features/customers/components/CallOutcomeSheet");

/**
 * Claim + call: `tel:` opens the dialer, then the outcome sheet logs the call.
 * The call stays "pending" on this device until its outcome is saved, so a Skip
 * or a reload asks again (PendingCallPrompt).
 */
export function LeadCallButton({
  leadId,
  name,
  variant = "tinted",
  size = "sm",
  label = "Call",
  className,
  render,
}: {
  leadId: string;
  /** Shown in "How did the call with … go?". */
  name: string;
  variant?: "tinted" | "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
  /** Custom trigger (a round action, an icon button); gets the click handler and busy state. */
  render?: (p: { onClick: () => void; busy: boolean }) => ReactNode;
}) {
  const env = useLeadEnv();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  const start = async () => {
    warmSheet();
    setBusy(true);
    const r = await startLeadCall({ leadId });
    setBusy(false);
    if (!r.ok || !r.data) {
      env.notify({
        title: r.ok ? "Couldn't start the call" : r.error,
        tone: "error",
      });
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
    startPendingCall(leadId, name);
    window.location.href = r.data.tel;
    setArmed(true);
    setTimeout(() => setOpen(true), 600);
  };

  return (
    <>
      {confirmEl}
      {render ? (
        render({ onClick: start, busy })
      ) : (
        <Button
          variant={variant}
          size={size}
          icon={<Phone size={size === "sm" ? 16 : 18} aria-hidden />}
          onClick={start}
          loading={busy}
          className={className}
        >
          {label}
        </Button>
      )}
      {armed && (
        <CallOutcomeFlow
          leadId={leadId}
          name={name}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
