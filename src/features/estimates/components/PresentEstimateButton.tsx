"use client";

import { Presentation } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { presentEstimate } from "../actions";

/**
 * "Present to customer": opens the customer's own estimate page (/e/…?present=1)
 * full screen on this device, ready to hand over (present mode). The link is
 * minted or reused per estimate; nothing is sent to the customer.
 */
export function PresentEstimateButton({
  estimateId,
  disabled,
  size = "md",
}: {
  estimateId: string;
  disabled?: boolean;
  size?: "md" | "lg";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size={size}
      icon={<Presentation size={18} aria-hidden />}
      loading={pending}
      disabled={disabled}
      aria-label="Present to customer"
      onClick={() =>
        start(async () => {
          const r = await presentEstimate({ estimateId });
          if (!r.ok) toast({ title: r.error, tone: "error" });
          else if (r.data) router.push(r.data.href);
        })
      }
    >
      Present<span className="max-sm:hidden"> to customer</span>
    </Button>
  );
}
