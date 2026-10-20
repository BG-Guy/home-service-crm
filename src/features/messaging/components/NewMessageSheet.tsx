"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CustomerPicker } from "@/features/customers/slots.client";
import { Button } from "@/ui/components/Button";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";

// The composer loads only when the sheet opens (keeps /messages light).
const MessageComposer = dynamic(
  () => import("../slots.client").then((m) => m.MessageComposer),
  { ssr: false, loading: () => <Skeleton height={180} rounded="card" /> },
);

/** "New message" sheet: pick a customer (B1 S3), then compose. */
export default function NewMessageSheet({
  open,
  onOpenChange: setOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="New message"
      detents={["large"]}
      onClosed={() => setCustomerId(null)}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-8">
        <CustomerPicker
          name="to"
          allowCreate={false}
          onChange={(v) => setCustomerId(v.customerId)}
        />
        {customerId ? (
          <MessageComposer key={customerId} customerId={customerId} autoFocus />
        ) : (
          <p className="px-1 text-subhead text-label-2">
            Choose who to message.
          </p>
        )}
      </div>
    </Sheet>
  );
}
