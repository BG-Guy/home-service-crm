"use client";

import { Eye, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { presentEstimate } from "../actions";

/**
 * "Present to customer": opens the customer's own estimate page (/e/…?present=1)
 * full screen on this device, ready to hand over (present mode). The link is
 * minted or reused per estimate; nothing is sent to the customer, and nothing is
 * tracked as the customer's view. Part J renders it on the job page: the first
 * three props are stable; `variant` and `label` are optional additions.
 */
export function PresentEstimateButton({
  estimateId,
  disabled,
  size = "md",
  variant = "secondary",
  label,
}: {
  estimateId: string;
  disabled?: boolean;
  size?: "md" | "lg";
  /** `primary` for the one main button (the builder's bottom bar). */
  variant?: "primary" | "secondary" | "tinted";
  /** e.g. "Present to Sophia" (default "Present", "Present to customer" on wider screens). */
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      icon={<Sparkles size={18} aria-hidden />}
      loading={pending}
      disabled={disabled}
      aria-label={label ?? "Present to customer"}
      onClick={() =>
        start(async () => {
          const r = await presentEstimate({ estimateId });
          if (!r.ok) toast({ title: r.error, tone: "error" });
          else if (r.data) router.push(r.data.href);
        })
      }
    >
      {label ?? (
        <>
          Present<span className="max-sm:hidden"> to customer</span>
        </>
      )}
    </Button>
  );
}

/**
 * "Preview": the customer's page as they'd see it, in present mode with a banner
 * and Approve / Decline turned off. Nothing is tracked (Quote to Paid E4).
 */
export function PreviewEstimateButton({
  estimateId,
  disabled,
}: {
  estimateId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="plain"
      size="sm"
      icon={<Eye size={17} aria-hidden />}
      loading={pending}
      disabled={disabled}
      onClick={() =>
        start(async () => {
          const r = await presentEstimate({ estimateId, preview: true });
          if (!r.ok) toast({ title: r.error, tone: "error" });
          else if (r.data) router.push(r.data.href);
        })
      }
    >
      Preview
    </Button>
  );
}
