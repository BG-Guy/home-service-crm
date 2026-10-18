"use client";

import { useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { grantConsent, stopTexting } from "../actions";

/** S31 actions: one-tap stop texting; record verbal consent (customers.edit). */
export function ConsentActions({
  customerId,
  optedOut,
  canGrant,
}: {
  customerId: string;
  optedOut: boolean;
  canGrant: boolean;
}) {
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);

  const stop = async () => {
    const ok = await confirm({
      title: "Stop texting this customer?",
      message:
        "Automated and marketing texts stop right away. Email and calls still work. This is recorded in the consent log.",
      confirmLabel: "Stop texting",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await stopTexting({ customerId });
    setBusy(false);
    if (res.ok) toast({ title: "Texting stopped", tone: "success" });
    else toast({ title: "Couldn't save", message: res.error, tone: "error" });
  };

  const grant = async (purpose: "transactional" | "marketing") => {
    setBusy(true);
    const res = await grantConsent({
      customerId,
      channel: "sms",
      purpose,
      source: "verbal",
    });
    setBusy(false);
    setGrantOpen(false);
    if (res.ok)
      toast({
        title:
          purpose === "marketing"
            ? "Marketing consent recorded"
            : "Texting consent recorded",
        tone: "success",
      });
    else toast({ title: "Couldn't save", message: res.error, tone: "error" });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {!optedOut && (
        <Button variant="gray" size="sm" onClick={stop} loading={busy}>
          Customer asked us to stop texting
        </Button>
      )}
      {canGrant && (
        <Button
          variant="plain"
          size="sm"
          disabled={busy}
          onClick={() => setGrantOpen(true)}
        >
          Record consent
        </Button>
      )}
      <Sheet
        open={grantOpen}
        onOpenChange={setGrantOpen}
        title="Record consent"
        detents={["content"]}
      >
        <div className="pb-6">
          <ListSection footer="Only record consent the customer clearly gave you (by phone or in person). It's logged with your name and the time.">
            <ListRow
              title="OK to text about appointments"
              subtitle="Reminders, on-my-way, receipts"
              onClick={() => grant("transactional")}
            />
            <ListRow
              title="OK to send offers too"
              subtitle="Maintenance reminders and promotions"
              onClick={() => grant("marketing")}
            />
          </ListSection>
        </div>
      </Sheet>
      {dialog}
    </div>
  );
}
