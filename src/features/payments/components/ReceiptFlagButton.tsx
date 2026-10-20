"use client";

import { Flag } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type { ReceiptFlagButtonProps } from "../contracts";

// Own module so the public receipt (/i) doesn't load the staff payment slots; the
// sheet (with the Sheet kit) is a lazy chunk loaded on hover/focus or first tap.
const load = () => import("./PaymentSheets");
const ReceiptFlagSheet = dynamic(() => load().then((m) => m.ReceiptFlagSheet), {
  ssr: false,
});
const prefetch = () => void load();

/** S28 — "Wrong amount? / I didn't pay this" on the public receipt. */
export function ReceiptFlagButton({
  token,
  paymentId,
}: ReceiptFlagButtonProps) {
  const [open, setOpenState] = useState(false);
  const [armed, setArmed] = useState(false);
  const setOpen = (v: boolean) => {
    if (v) setArmed(true);
    setOpenState(v);
  };
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <output className="block text-center text-subhead text-label-2">
        Thanks, we'll call you shortly to sort it out.
      </output>
    );
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        icon={<Flag size={16} />}
        onClick={() => setOpen(true)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        aria-haspopup="dialog"
      >
        Wrong amount? I didn't pay this
      </Button>
      {armed && (
        <ReceiptFlagSheet
          open={open}
          onOpenChange={setOpen}
          token={token}
          paymentId={paymentId}
          onSent={() => setSent(true)}
        />
      )}
    </>
  );
}
