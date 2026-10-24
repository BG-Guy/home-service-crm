"use client";

import { ChevronRight, PenLine, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { presentEstimate } from "@/features/estimates/actions";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { signJobCompletion } from "../actions";

// The money card's client pieces, one lazy island (lazy-islands.tsx
// LazyMoneyCardButton): the card itself is a server component; only these two
// buttons need the browser.

const loadSignature = () => import("@/features/signatures/slots.client");
const SignatureSheet = dynamic(
  () => loadSignature().then((m) => m.SignatureSheet),
  { ssr: false },
);
const warmSignature = () => void loadSignature().catch(() => {});

export type MoneyCardButtonProps =
  | { kind: "present"; estimateId: string; label: string }
  | {
      kind: "signoff";
      jobId: string;
      customerName: string;
      consentText: string;
      summaryLines: string[];
    };

export function MoneyCardButton(p: MoneyCardButtonProps) {
  return p.kind === "present" ? (
    <PresentButton estimateId={p.estimateId} label={p.label} />
  ) : (
    <SignOffButton
      jobId={p.jobId}
      customerName={p.customerName}
      consentText={p.consentText}
      summaryLines={p.summaryLines}
    />
  );
}

/**
 * "Present to Sophia": the customer's estimate full screen on this device
 * (present mode), the same action as the estimate builder's Present button.
 */
function PresentButton({
  estimateId,
  label,
}: {
  estimateId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      block
      loading={pending}
      icon={<Sparkles size={20} aria-hidden />}
      onClick={() =>
        start(async () => {
          const r = await presentEstimate({ estimateId });
          if (!r.ok) toast.error(r.error);
          else if (r.data) router.push(r.data.href);
        })
      }
    >
      {label}
    </Button>
  );
}

/**
 * "Get customer sign-off": the customer signs that the work is done, on this
 * device (the signature sheet loads on the first tap; signJobCompletion).
 */
function SignOffButton({
  jobId,
  customerName,
  consentText,
  summaryLines,
}: {
  jobId: string;
  customerName: string;
  consentText: string;
  summaryLines: string[];
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className="pressable flex min-h-11 w-full items-center gap-3 border-hairline border-t pt-3 text-left outline-offset-2"
        onPointerEnter={warmSignature}
        onTouchStart={warmSignature}
        onFocus={warmSignature}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{
            background:
              "color-mix(in srgb, var(--accent) var(--tint-a), transparent)",
            color: "var(--ink-accent)",
          }}
        >
          <PenLine size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-subhead font-semibold text-accent-text">
            Get customer sign-off
          </span>
          <span className="block text-footnote text-label-2">
            {customerName} signs that the work is done
          </span>
        </span>
        <ChevronRight size={18} aria-hidden className="shrink-0 text-label-3" />
      </button>
      {mounted && (
        <SignatureSheet
          open={open}
          onOpenChange={setOpen}
          title="Customer sign-off"
          docType="completion"
          consentText={consentText}
          summaryLines={summaryLines}
          signerNameDefault={customerName}
          action={signJobCompletion.bind(null, jobId)}
        />
      )}
    </>
  );
}
