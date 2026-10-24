"use client";

import { CreditCard, ReceiptText } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type {
  CollectPaymentButtonProps,
  RecordPaymentButtonProps,
} from "./contracts";

// Client UI slots produced by B4 (BUILD_PLAN §5.1). They take serializable props and
// call only this module's own actions. The buttons render with the page; their
// sheets (components/PaymentSheets.tsx, with the Sheet kit) are a lazy chunk loaded
// on hover/focus or the first tap, and the collect body is a second one.

const loadSheets = () => import("./components/PaymentSheets");
const CollectPaymentSheet = dynamic(
  () => loadSheets().then((m) => m.CollectPaymentSheet),
  { ssr: false },
);
const RecordPaymentSheet = dynamic(
  () => loadSheets().then((m) => m.RecordPaymentSheet),
  { ssr: false },
);
const prefetch = () => void loadSheets();

/** Open state that mounts the lazy sheet on first open and keeps it for the exit motion. */
function useLazySheet() {
  const [open, setOpenState] = useState(false);
  const [armed, setArmed] = useState(false);
  const setOpen = (v: boolean) => {
    if (v) setArmed(true);
    setOpenState(v);
  };
  return { open, armed, setOpen, show: () => setOpen(true) };
}

/** S19 — Collect-payment sheet (methods, tips, split payments, guards). */
export function CollectPaymentButton({
  jobId,
  invoiceId,
  label = "Collect payment",
  variant = "filled",
  size = "md",
  fullWidth,
  allowDeposit,
  defaultTarget,
  hidden,
}: CollectPaymentButtonProps) {
  const s = useLazySheet();
  return (
    <>
      {hidden ? null : (
        <Button
          variant={variant}
          size={size}
          fullWidth={fullWidth}
          icon={<CreditCard size={size === "lg" ? 20 : 18} />}
          onClick={s.show}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          aria-haspopup="dialog"
        >
          {label}
        </Button>
      )}
      {s.armed && (
        <CollectPaymentSheet
          open={s.open}
          onOpenChange={s.setOpen}
          jobId={jobId}
          invoiceId={invoiceId}
          allowDeposit={allowDeposit}
          defaultTarget={defaultTarget}
        />
      )}
    </>
  );
}

/** S20 — Pick an open invoice, then the collect sheet. */
export function RecordPaymentButton({
  customerId,
  invoiceId,
  size = "md",
}: RecordPaymentButtonProps) {
  const s = useLazySheet();
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        className="shrink-0"
        icon={<ReceiptText size={size === "sm" ? 16 : 18} />}
        onClick={s.show}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        aria-haspopup="dialog"
      >
        Record payment
      </Button>
      {s.armed && (
        <RecordPaymentSheet
          open={s.open}
          onOpenChange={s.setOpen}
          customerId={customerId}
          invoiceId={invoiceId}
        />
      )}
    </>
  );
}

export { ReceiptFlagButton } from "./components/ReceiptFlagButton";
